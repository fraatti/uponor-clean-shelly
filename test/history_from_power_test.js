// The phase reconstruction from minute power data (app/history_from_power.js) against the firmware
// simulator's ground truth. Minute records are made like the Shelly's EM1Data: minimum and maximum
// power, energy in steps of 0.2072 Wh, at 237 V.
//   node test/history_from_power_test.js [--days 7] [--verbose]
'use strict';
const F = require('./fwsim');
const H = require('../app/history_from_power');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 7));
const VERBOSE = process.argv.includes('--verbose');
const { minutes } = require('./em1_minutes');

function compare(segs, gt, from, to) {
  const at = (arr, key, t) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? arr[r][key] : null; };
  let n = 0, okPh = 0, okCy = 0; const per = {};
  for (let t = from; t < to; t += 5e3) {
    const g = at(gt, 'ph', t), gc = at(gt, 'cyc', t), s = at(segs, 'ph', t), sc = at(segs, 'cyc', t);
    if (!g || g === 'boot' || g === 'off' || g === 'paused') continue;
    n++; const ok = g === s; if (ok) okPh++; if (gc === sc) okCy++;
    per[g] = per[g] || [0, 0]; per[g][0]++; if (ok) per[g][1]++;
  }
  const pct = (a, b) => Math.round(a / b * 1000) / 10;
  return { phase: pct(okPh, n), cycle: pct(okCy, n), per: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, pct(v[1], v[0])])) };
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const scenarios = [
  { name: 'normal use', sc: { tripAt: (c, n) => ((n * 7919) % 11 < 4 ? 60 + ((n * 37) % 500) : null) } },
  { name: 'busy (a batch after each pump-in)', sc: { tripAt: (c, n) => ((n * 13) % 5 < 3 ? 30 + ((n * 53) % 400) : null) } },
  { name: 'quiet (holiday programme)', sc: { tripAt: (c, n) => (n > 2 ? null : 200) }, days: 5 },
  { name: 'power cut and outlet blocked', sc: { tripAt: (c, n) => ((n * 7919) % 11 < 4 ? 120 : null), powerCuts: [{ at: T0 + 30 * 3600e3, dur: 1800 }], outletBlocked: (b) => b === 3 } },
];
for (const s of scenarios) {
  const days = s.days || DAYS;
  const sim = F.simulate(Object.assign({ t0: T0, seed: 5, durationS: days * 86400, startCycle: 'cleaning' }, s.sc));
  const recs = minutes(sim, T0, T0 + days * 86400e3 - 60e3);
  const res = H.reconstruct(recs);
  const cmp = compare(res.segs, sim.gt, T0 + 3 * 3600e3, T0 + days * 86400e3 - 3600e3);
  const batchesGt = sim.gt.filter((g) => g.ph === 'pump_out' && g.t > T0 + 3 * 3600e3 && g.t < T0 + days * 86400e3 - 3600e3).length;
  const batchesR = res.segs.filter((g) => g.ph === 'pump_out' && g.t > T0 + 3 * 3600e3 && g.t < T0 + days * 86400e3 - 3600e3).length;
  console.log(s.name + ': phase ' + cmp.phase + ' %, cycle ' + cmp.cycle + ' %, pump-outs ' + batchesR + '/' + batchesGt);
  if (VERBOSE) console.log('  ', JSON.stringify(cmp.per));
  check(cmp.phase >= 95, s.name + ': phases right ' + cmp.phase + ' % of the time (>= 95)');
  check(cmp.cycle >= 95, s.name + ': cycles right ' + cmp.cycle + ' % of the time (>= 95)');
  check(batchesR === batchesGt, s.name + ': pump-outs ' + batchesR + ' = ' + batchesGt);
}
// The data can end at any moment, also in a cleaning cycle that has no pump-out yet (the app reads the
// past when it connects). Cut the data every 7 minutes over a day and compare the last 3 hours.
{
  const sim = F.simulate({ t0: T0, seed: 5, durationS: 3 * 86400, startCycle: 'cleaning', tripAt: scenarios[0].sc.tripAt });
  const all = minutes(sim, T0, T0 + 3 * 86400e3 - 60e3);
  const at = (arr, t) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? arr[r] : null; };
  let n = 0, falseHol = 0, worst = 100;
  for (let cut = T0 + 40 * 3600e3; cut < T0 + 64 * 3600e3; cut += 7 * 60e3) {
    const segs = H.reconstruct(all.filter((r) => r.ts * 1000 < cut)).segs;
    let k = 0, ok = 0, hol = false;
    for (let t = cut - 3 * 3600e3; t < cut - 60e3; t += 10e3) {
      const g = at(sim.gt, t), s = at(segs, t);
      if (!g || g.ph === 'boot') continue;
      k++; if (s && s.ph === g.ph && s.cyc === g.cyc) ok++;
      if (s && s.cyc === 'holiday' && g.cyc !== 'holiday') hol = true;
    }
    n++; if (hol) falseHol++; worst = Math.min(worst, ok / k * 100);
  }
  check(falseHol === 0, 'data cut at ' + n + ' moments: no holiday programme that did not happen (' + falseHol + ')');
  check(worst >= 90, 'data cut at ' + n + ' moments: the last 3 h right at least ' + worst.toFixed(1) + ' % of the time (>= 90)');
}
console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
