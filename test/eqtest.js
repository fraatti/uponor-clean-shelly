// The compact Shelly version must produce exactly the same outputs as the commented version.
'use strict';
const fs = require('fs'); const H = require('./harness'); const F = require('./fwsim');
const A = fs.readFileSync(process.argv[2], 'utf8'), B = fs.readFileSync(process.argv[3], 'utf8');
const W = ['U', 'F', 'A', 'C', 'S', 'R', 'D', 'W'];
let ok = true;
const sets = ['history__uponor_2_.csv', 'history__23_simu.csv', 'history__24_.csv', 'history__26_.csv', 'history__28_.csv', 'history__9_.csv', 'history__11_.csv'];
for (const f of sets) {
  const csv = H.loadCsv('data/' + f); const feed = H.feedFromCsv(csv);
  const o = { events: feed.events, enumOptions: W, reboots: (csv['button.uponor_clean_1_restart'] || []).map((r) => r.t) };
  const a = H.runScript(Object.assign({ code: A }, o)), b = H.runScript(Object.assign({ code: B }, o));
  const same = JSON.stringify([a.status, a.msg, a.batch, a.prints]) === JSON.stringify([b.status, b.msg, b.batch, b.prints]);
  if (!same) ok = false; console.log((same ? 'same ' : 'DIFF ') + f);
}
const T0 = Date.parse('2026-11-01T00:00:00Z');
const sim = F.simulate({ t0: T0, durationS: 90 * 3600, startCycle: 'cleaning', seed: 3, tripAt: (c, n) => (n % 9 === 4 ? 260 : c === 'holiday' && n > 80 ? 100 : null),
  highWaterAtStart: (n) => n === 2, outletBlocked: (b) => b === 3, powerCuts: [{ at: T0 + 20 * 3600e3, dur: 400 }] });
const o = { events: sim.events, t0: T0 - 60e3, t1: sim.tEnd, enumOptions: W, kvs: { puhdistamo_batch_count: '5', puhdistamo_process_message: '"Last: 31.10.2026 20:00:00"' } };
const a = H.runScript(Object.assign({ code: A }, o)), b = H.runScript(Object.assign({ code: B }, o));
const same = JSON.stringify([a.status, a.msg, a.batch, a.prints]) === JSON.stringify([b.status, b.msg, b.batch, b.prints]);
if (!same) ok = false; console.log((same ? 'same ' : 'DIFF ') + 'synthetic 90 h mixed scenario');
console.log(ok ? 'IDENTICAL on all' : 'DIFFERENCES FOUND');
