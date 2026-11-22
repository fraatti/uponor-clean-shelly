// The readable v3 source and the compact Shelly version behave the same on the v3 device mock:
// every component write, event, log line, state read and the final KVS must be identical.
// (eqtest.js uses the v2 harness and does not run v3.)
//   node test/eqtest_v3.js [--real]      --real: also the recorded data in test/data/
'use strict';
const fs = require('fs');
const L = require('./v3ext');
const B = L;
const H_ = require('./harness.js');
const { T0, H } = L;
const A = fs.readFileSync(L.REPO + '/shelly/v3/uponor_clean_v3.js', 'utf8');
const C = fs.readFileSync(L.REPO + '/shelly/v3/uponor_clean_v3_shelly.js', 'utf8');

function digest(run) {
  return JSON.stringify({ c: run.changes, e: run.events, l: run.logs.map((x) => [x.t, x.s]), k: [...run.kvs.entries()].sort(), s: run.states });
}
let ok = true;
function cmp(name, opts) {
  const a = L.runExt(Object.assign({}, opts, { code: A }));
  const c = L.runExt(Object.assign({}, opts, { code: C }));
  const same = digest(a) === digest(c);
  if (!same) ok = false;
  console.log(`${same ? 'same' : 'DIFF'}  ${name}  (${a.changes.length} writes, ${a.events.length} events, ${a.logs.length} log lines, uncaught ${a.uncaught.length}/${c.uncaught.length})`);
}
const sc = [
  ['normal + holiday + outlet blocked + high water', { startCycle: 'cleaning', durationS: 90 * 3600, seed: 3, tripAt: (c, n) => (n % 9 === 4 ? 260 : c === 'holiday' && n > 80 ? 100 : null),
    highWaterAtStart: (n) => n === 2, outletBlocked: (b) => b === 3, powerCuts: [{ at: T0 + 20 * H, dur: 400 }], testAt: [T0 + 40 * H], pauses: [{ at: T0 + 30 * H, dur: 3000 }] }, { withShelly: [0] }],
  ['power cuts with the Shelly, reboots, script stops, user edits, unsynced clock', { startCycle: 'cleaning', durationS: 30 * 3600, seed: 9, tripAt: (c, n) => (n === 3 ? 50 : null),
    powerCuts: [{ at: T0 + 2 * H, dur: 5 }, { at: T0 + 9 * H, dur: 3600 }] },
  { withShelly: [0, 1], unsyncS: 200, swReboots: [{ at: T0 + 5 * H, offMs: 8000, rr: 3 }], scriptStops: [{ at: T0 + 15 * H, durMs: 300e3 }],
    userSets: [{ at: T0 + 120e3, role: 'chemical', value: 1 }, { at: T0 + 3 * H, role: 'sludge', value: 900 }, { at: T0 + 4 * H, role: 'sludge', value: 0 }, { at: T0 + 6 * H, role: 'batches', value: 7 }] }],
];
for (const [name, s, x] of sc) {
  const sim = L.F.simulate(Object.assign({ t0: T0 }, s));
  const o = B.runOpts('cleaning', sim, Object.assign({}, x));
  if (x.withShelly) {
    const off = sim.marks.filter((m) => /power cut/.test(m.s)), on = sim.marks.filter((m) => /power back/.test(m.s));
    o.shellyCuts = x.withShelly.map((i) => ({ off: off[i].t, on: on[i].t }));
  }
  cmp(name, o);
}
if (process.argv.includes('--real')) {
  for (const f of ['history__uponor_2_.csv', 'history__23_simu.csv', 'history__24_.csv', 'history__26_.csv', 'history__28_.csv', 'history__9_.csv', 'history__11_.csv']) {
    const csv = H_.loadCsv(L.REPO + '/test/data/' + f);
    const feed = H_.feedFromCsv(csv);
    const t0 = feed.events[0].t, t1 = feed.events[feed.events.length - 1].t + 1000;
    cmp('real data ' + f, { events: feed.events, t0, t1, voltage: 230, tzOffsetMin: 180, kvs: { uc_sludge: '{"n":300,"reset":null}' }, uptimeAtStartS: 86400, resetReason: 3 });
  }
}
console.log(ok ? 'IDENTICAL' : 'DIFFERENCES FOUND');
process.exit(ok ? 0 : 1);
