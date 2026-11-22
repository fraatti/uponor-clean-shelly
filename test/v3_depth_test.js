// The deepest call chain of the v3 script at any function entry. The device stops a script when a
// native call is made 11 functions deep ("Too much recursion", firmware 2.2.0); every native counts,
// also push, JSON.stringify and Math. The device mock checks the depth only at the Shelly API calls,
// so here every function body gets a probe that counts the script frames on the stack: a function
// that runs at depth d makes its native calls at depth d. Limit 8 (a margin of 2 to the device).
//   node test/v3_depth_test.js [limit]
// V3_FILE=shelly/v3/uponor_clean_v3_shelly.js checks the compact version.
'use strict';
const fs = require('fs');
const L = require('./v3ext');
const { Device } = require('./shelly_device_mock.js');
const { T0, H } = L;
const LIMIT = Number(process.argv[2] || 8);

const src = fs.readFileSync(L.V3_PATH, 'utf8');
let nProbes = 0;
const code = 'function __d() { __host(); }\n' +
  src.replace(/function\s*(\w*)\s*\(([^)]*)\)\s*\{/g, (m) => { nProbes++; return m + ' __d();'; });
const chains = new Map();
let maxD = 0;
const probe = () => {
  // frames of the script, without the probe itself
  const frames = new Error().stack.split('\n').filter((l) => l.includes('uponor_clean_v3:')).slice(1);
  const chain = frames.map((l) => l.trim().split(' ')[1]).reverse().join(' > ');
  const e = chains.get(chain) || { d: frames.length, n: 0 };
  e.n++;
  chains.set(chain, e);
  maxD = Math.max(maxD, frames.length);
};
const orig = Device.prototype.makeApi;
Device.prototype.makeApi = function (sid) { const api = orig.call(this, sid); api.__host = probe; return api; };

const PO = T0 + 9940e3;
const shellyCuts = (sim) => sim.marks.filter((m) => /power cut/.test(m.s)).map((m, i) => ({ off: m.t, on: sim.marks.filter((x) => /power back/.test(x.s))[i].t }));
const runs = [
  ['cleaning, outlet blocked, high water, trips', 'cleaning', { durationS: 30 * 3600, tripAt: (c, n) => (n === 2 ? 200 : n === 6 ? 0 : null), outletBlocked: (b) => b === 2, highWaterAtStart: (n) => n === 3 }, {}],
  ['holiday after 71 h, then a trip', 'cleaning', { durationS: 80 * 3600, tripAt: (c, n) => (c === 'holiday' && n >= 75 ? 300 : null) }, {}],
  ['power cuts with the Shelly, a plant-only cut, reboots, script stops, user edits', 'cleaning',
    { durationS: 24 * 3600, tripAt: (c, n) => (n === 2 ? 100 : null), powerCuts: [{ at: T0 + 3 * H, dur: 30 }, { at: T0 + 10 * H, dur: 600 }, { at: T0 + 12 * H, dur: 2 }], pauses: [{ at: T0 + 15 * H, dur: 3600 }] },
    { cutsWithShelly: [0], swReboots: [{ at: T0 + 5 * H, offMs: 8000, rr: 3 }, { at: T0 + 20 * H + 100e3, offMs: 8000, rr: 3 }],
      scriptStops: [{ at: T0 + 7 * H, durMs: 60e3 }, { at: T0 + 2.76 * H, durMs: 200e3 }],
      userSets: [{ at: T0 + 120e3, role: 'chemical', value: 0.5 }, { at: T0 + 4 * H, role: 'sludge', value: 805 }, { at: T0 + 6 * H, role: 'sludge', value: 0 }, { at: T0 + 8 * H, role: 'batches', value: 5 }] }],
  ['test cycle and a plant restart in the pump-out', 'waiting', { durationS: 12 * 3600, tripAt: () => null, testAt: [T0 + 1.5 * H], powerCuts: [{ at: T0 + 2 * H, dur: 20 }] }, {}],
  ['reboot at pump-out +765 s, clock unset 60 s, start level at once, sludge 799', 'cleaning', { durationS: 4 * 3600, tripAt: (c, n) => (n === 1 ? 0 : null) },
    { kvs: { uc_sludge: '{"n":799,"reset":null}' }, swReboots: [{ at: PO + 765e3, offMs: 8000, rr: 3 }], unsyncS: 60 }],
  ['script stopped over the pump-out end and the start level (resumed in pre-aeration)', 'cleaning', { durationS: 6 * 3600, tripAt: (c, n) => (n === 1 ? 40 : null) },
    { scriptStops: [{ at: PO + 650e3, durMs: 240e3 }] }],
  ['script stopped over the dosing (resumed in the mixing)', 'cleaning', { durationS: 3 * 3600 }, { scriptStops: [{ at: T0 + 5970e3, durMs: 200e3 }] }],
];
for (const [name, base, sc, ctl] of runs) {
  const sim = L.F.simulate(Object.assign({ t0: T0, seed: 5 }, L.BASES[base], sc));
  const o = Object.assign(L.runOpts(base, sim, {}), ctl, { code });
  o.kvs = Object.assign({}, L.KVS, ctl.kvs || {});
  if (ctl.cutsWithShelly) o.shellyCuts = shellyCuts(sim).filter((c, i) => ctl.cutsWithShelly.includes(i));
  const r = L.runExt(o);
  console.log(`${name}: uncaught ${r.uncaught.length}${r.uncaught.length ? ' ' + r.uncaught[0].s.slice(0, 200) : ''}`);
  if (r.uncaught.length) maxD = Infinity;
}
console.log(`\nprobes: ${nProbes} functions; deepest function entry: ${maxD} frames (limit ${LIMIT})`);
for (const [chain, e] of [...chains.entries()].sort((a, b) => b[1].d - a[1].d).slice(0, 5)) console.log(`  ${e.d}  x${e.n}  ${chain}`);
const ok = maxD <= LIMIT;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
