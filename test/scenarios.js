// Synthetic firmware scenarios: run v2.3 and v2.4 on traces generated from the firmware logic and check expectations.
'use strict';
const fs = require('fs');
const H = require('./harness');
const F = require('./fwsim');
const V23 = fs.readFileSync('puhdistamo_skripti_v2_3.js', 'utf8');
const V24 = fs.readFileSync(process.argv[2] || 'puhdistamo_skripti_v2_4.js', 'utf8');
const W = ['U', 'F', 'A', 'C', 'S', 'R', 'D', 'W'];
const T0 = Date.parse('2026-11-01T00:00:00Z');
const H_ = 3600e3;
const fmt = (t) => new Date(t).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
const LAST = '"Last: 31.10.2026 20:00:00"';
const kvsRecent = { puhdistamo_batch_count: '100', puhdistamo_process_message: LAST };

const SC = [
  { name: 'Normal trips after 1-5 pulses + trip during post-pump-out fill', durationS: 30 * 3600,
    tripAt: (c, n) => ({ 2: 130, 5: 260, 8: 390, 11: 515, 14: 40 })[n] ?? (c === 'post' && n === 3 ? 900 : null),
    expect: { batchesFromSim: true, earlyEtaAll: true, warnings: 0, holiday: 0, waiting: true } },
  { name: 'High water at cycle start (aeration skipped)', durationS: 12 * 3600,
    tripAt: (c, n) => (n === 2 || n === 6 ? 200 : null), highWaterAtStart: (n) => n === 1,
    expect: { batchesFromSim: true, warningsMatch: /high water/, warnCleared: true, holiday: 0 } },
  { name: 'High water cuts batch aeration at 40 min', durationS: 8 * 3600,
    tripAt: (c, n) => (n === 2 ? 200 : null), highWaterCutAt: (n) => (n === 1 ? 2400 : null),
    expect: { batchesFromSim: true, warningsMatch: /high water/, holiday: 0 } },
  { name: 'Outlet blocked twice after pump-out', durationS: 14 * 3600,
    tripAt: (c, n) => (n === 2 ? 200 : null), outletBlocked: (b) => b <= 2,
    expect: { batchesFromSim: true, warningsMatch: /outlet blocked/, warnCleared: true, holiday: 0 } },
  { name: 'Power cut 10 min in waiting cycle (Shelly stays on)', durationS: 10 * 3600,
    tripAt: () => null, powerCuts: [{ at: T0 + 1.3 * H_, dur: 600 }],
    expect: { batchesFromSim: true, restartEta: true, warnings: 0, holiday: 0 } },
  { name: 'Power cut during sedimentation, Shelly reboots too', durationS: 12 * 3600,
    tripAt: (c, n) => (n === 2 ? 200 : null), powerCuts: [{ at: T0 + 3.4 * H_, dur: 300 }], rebootAtPowerBack: true,
    expect: { batchesFromSim: true, restartEta: true, warnings: 0, holiday: 0 } },
  { name: 'Holiday automation after 71 h without start level, then trip', durationS: 80 * 3600, startCycle: 'cleaning',
    tripAt: (c, n) => (c === 'holiday' && n >= 75 ? 300 : null),
    expect: { batchesFromSim: true, holidayAfterStartMin: 25, warnings: 0, earlyEtaAll: true } },
  { name: 'Shelly reboot in the middle of batch aeration (no power cut)', durationS: 8 * 3600,
    tripAt: (c, n) => (n === 2 ? 200 : null), reboots: [T0 + 2.5 * H_],
    expect: { batchesFromSim: true, noRestartEta: true, warnings: 0, holiday: 0 } },
  { name: 'High water in waiting-cycle check', durationS: 8 * 3600,
    tripAt: () => null, highWaterInWaiting: (k) => k === 2,
    expect: { batchesFromSim: true, warningsMatch: /high water/, holiday: 0 } },
  { name: 'Test button (test cycle) during waiting', durationS: 4 * 3600,
    tripAt: () => null, testAt: [T0 + 0.25 * H_],
    expect: { batchesFromSim: true, info: true } },
];

let fails = 0;
for (const S of SC) {
  const sim = F.simulate(Object.assign({ t0: T0, seed: 11 }, S));
  const powerBack = sim.marks.filter((m) => /power back/.test(m.s)).map((m) => m.t);
  const reboots = (S.reboots || []).concat(S.rebootAtPowerBack ? powerBack : []);
  const run = (code) => H.runScript({ code, events: sim.events, t0: T0 - 60e3, t1: sim.tEnd, kvs: kvsRecent, enumOptions: W, reboots });
  const a = run(V23), b = run(V24);
  const nb = (l) => +JSON.parse(l.kvs.puhdistamo_batch_count) - 100;
  const problems = [];
  const cleanings = sim.marks.filter((m) => /cleaning cycle/.test(m.s));
  // early ETA: an ETA within 60 s after each cleaning-cycle start (trip) or within 33 min after a restart
  const etaStarts = b.prints.filter((p) => /ETA set: .*source=(fill -> aeration|restart)/.test(p.s));
  const eta23 = a.prints.filter((p) => /ETA set: .*peaks/.test(p.s));
  const etaFor = (log, re, c, win) => log.prints.find((p) => re.test(p.s) && p.t >= c.t && p.t <= c.t + win);
  const warns = b.prints.filter((p) => /PROCESS WARNING: Warning/.test(p.s));
  const cleared = b.prints.filter((p) => /PROCESS WARNING: cleared/.test(p.s));
  const hol = b.prints.filter((p) => /MAINTENANCE MODE ON/.test(p.s));
  const hol23 = a.prints.filter((p) => /MAINTENANCE MODE ON/.test(p.s));
  const E = S.expect;
  if (E.batchesFromSim && nb(b) !== sim.batches) problems.push(`batches ${nb(b)} != firmware ${sim.batches}`);
  const info = []; if (nb(a) !== sim.batches) info.push(`v2.3 counted ${nb(a)} of ${sim.batches} batches`);
  if (E.earlyEtaAll) for (const c of cleanings.filter((c) => c.t > T0 + 60e3)) { const ok = etaFor(b, /ETA set: .*fill -> aeration/, c, 60e3); if (!ok && c.t < sim.tEnd - 120e3) problems.push('no early ETA for ' + fmt(c.t)); }
  if (E.restartEta && !etaStarts.some((p) => /restart/.test(p.s))) problems.push('no restart ETA');
  if (E.noRestartEta && etaStarts.some((p) => /restart/.test(p.s))) problems.push('false restart ETA');
  if (E.warnings === 0 && warns.length) problems.push('unexpected warnings: ' + warns.map((w) => w.s).join('; '));
  if (E.warningsMatch && !warns.some((w) => E.warningsMatch.test(w.s))) problems.push('expected warning missing');
  if (E.warnCleared && !cleared.length) problems.push('warning not cleared');
  if (E.holiday === 0 && hol.length) problems.push('unexpected holiday: ' + hol.map((h) => fmt(h.t)).join(','));
  if (E.holidayAfterStartMin) {
    const hs = sim.marks.find((m) => /holiday cycle/.test(m.s));
    if (!hs) problems.push('firmware never entered holiday');
    else if (!hol.length) problems.push('holiday not detected');
    else { const d = (hol[0].t - hs.t) / 60e3; if (d < 0 || d > E.holidayAfterStartMin) problems.push(`holiday detected ${d.toFixed(0)} min after start`); }
  }
  // pump-out segment lengths
  const dl = H.segments(b.status, Infinity).filter((g) => g.v === 'D' && g.t1 !== Infinity).map((g) => Math.round((g.t1 - g.t0) / 1000));
  if (dl.some((x) => x < 770 || x > 800)) problems.push('pump-out lengths ' + dl.join(','));
  // ETA accuracy: the latest ETA before each firmware pump-out must hit it within 60 s
  const outs = sim.marks.filter((m) => /pump-out/.test(m.s));
  const allEta = b.prints.filter((p) => /ETA set/.test(p.s));
  const errs = outs.map((o) => { const p = allEta.filter((e) => e.t < o.t).pop(); if (!p) return null; const m = /ETA set: (\d+)/.exec(p.s); return Math.round((p.t + (+m[1]) * 1000 - o.t) / 1000); }).filter((x) => x !== null);
  if (errs.some((e) => Math.abs(e) > 60)) problems.push('ETA errors ' + errs.join(','));
  const early = cleanings.map((c) => etaFor(b, /ETA set: .*(fill -> aeration|restart)/, c, 33 * 60e3)).filter(Boolean).length;
  const ok = problems.length === 0; if (!ok) fails++;
  const wcount = b.status.filter((r) => r.v === 'W').length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${S.name}`);
  console.log(`      firmware batches ${sim.batches}, v2.3 ${nb(a)}, v2.4 ${nb(b)} | cleaning cycles ${cleanings.length}: early ETA v2.3 ${eta23.length}, v2.4 ${early} | last-ETA error s: ${errs.join(',') || '-'} | W periods ${wcount}`);
  for (const i of info) console.log('      note: ' + i);
  console.log(`      holiday v2.3 ${hol23.map((h) => fmt(h.t)).join(',') || '-'} v2.4 ${hol.map((h) => fmt(h.t)).join(',') || '-'} | warnings: ${warns.map((w) => w.s.replace('PROCESS WARNING: ', '')).join('; ') || '-'}`);
  if (E.info) { for (const [n, l] of [['v2.3', a], ['v2.4', b]]) { const msgs = l.msg.map((m) => fmt(m.t) + ' ' + m.v).filter((x, i, arr) => !/Pump out in/.test(x) || i === 0 || !/Pump out in/.test(arr[i - 1])); console.log(`      ${n} messages: ` + msgs.join(' / ')); } }
  for (const p of problems) console.log('      !! ' + p);
}
console.log(fails ? `\n${fails} scenario(s) failed` : '\nall scenarios passed');
