// v3 acceptance on firmware-simulated traces: phases against the simulator's ground truth,
// batches, pump-out estimate, warnings, holiday, chemical and the restart/reboot handling.
// Usage: node v3_scenarios.js [-v] [scenario name filter]
'use strict';
const F = require('./fwsim');
const R = require('./v3run');
const fs = require('fs');

const T0 = Date.parse('2026-11-01T00:00:00Z');
const H_ = 3600e3;
const verbose = process.argv.includes('-v');
const filter = process.argv.slice(2).filter((a) => a !== '-v')[0];
const fmt = (t) => new Date(t).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
const KVS = { uc_batch: JSON.stringify({ n: 100, ts: Date.parse('2026-10-31T20:00:00Z') / 1000 }) };
const tripsNormal = (c, n) => ({ 2: 130, 5: 260, 8: 390, 11: 515, 14: 40 })[n] ?? (c === 'post' && n === 3 ? 900 : null);

/* sc: fwsim scenario + { powerUp (script starts with the plant), shellyWithCut, swReboots, expect } */
const SC = [
  { name: 'Normal cycles, trips after 1-5 pulses', durationS: 30 * 3600, startCycle: 'cleaning', powerUp: true, tripAt: tripsNormal,
    expect: { warnings: [] } },
  { name: 'High water at cycle start (aeration skipped)', durationS: 12 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (n === 2 || n === 6 ? 200 : null), highWaterAtStart: (n) => n === 2,
    expect: { warnings: ['high_water'], cleared: ['high_water'] } },
  { name: 'High water cuts aeration at 40 min', durationS: 8 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (n === 2 ? 200 : null), highWaterCutAt: (n) => (n === 1 ? 2400 : null),
    expect: { warnings: ['high_water'], cleared: ['high_water'], earlyEtaFrom: 3 * H_ } },
  { name: 'Outlet blocked twice after pump-out', durationS: 14 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (n === 2 ? 200 : null), outletBlocked: (b) => b <= 2,
    expect: { warnings: ['outlet_blocked'], cleared: ['outlet_blocked'] } },
  { name: 'Plant supply cut 10 min after the Shelly (service), waiting cycle', durationS: 10 * 3600,
    tripAt: () => null, powerCuts: [{ at: T0 + 1.3 * H_, dur: 600 }],
    expect: { warnings: ['no_power'], cleared: ['no_power'], restarts: 1, warmupMs: 1.2 * H_ } },
  { name: 'Power cut 5 min during sedimentation, Shelly loses power too', durationS: 12 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (n === 2 ? 200 : null), powerCuts: [{ at: T0 + 2.0 * H_, dur: 300 }], shellyWithCut: true,
    expect: { warnings: [], restarts: 1 } },
  { name: 'Holiday cycle after 71 h without start level, then trip', durationS: 80 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (c === 'holiday' && n >= 75 ? 300 : null),
    expect: { warnings: [], holidayWithinMin: 5 } },
  { name: 'Shelly software reboot during aeration (plant keeps running)', durationS: 8 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => (n === 2 ? 200 : null), swReboots: [T0 + 1.2 * H_],
    expect: { warnings: [], restarts: 0 } },
  { name: 'Shelly software reboot during pump-out', durationS: 6 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: () => null, swReboots: [T0 + 9950e3 + 400e3],
    expect: { warnings: [], restarts: 0 } },
  { name: 'High water in waiting-cycle check', durationS: 8 * 3600,
    tripAt: () => null, highWaterInWaiting: (k) => k === 2,
    expect: { warnings: ['high_water'], cleared: ['high_water'], warmupMs: 1.2 * H_ } },
  { name: 'Test cycle (Test button) during waiting', durationS: 4 * 3600,
    tripAt: () => null, testAt: [T0 + 1.5 * H_ + 300e3],
    expect: { warnings: [], warmupMs: 1.2 * H_ } },
  { name: 'Radio panel stop 2 h during aeration', durationS: 8 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: () => null, pauses: [{ at: T0 + 0.5 * H_, dur: 7200 }],
    expect: { warnings: ['paused'], cleared: ['paused'] } },
  { name: 'Radio panel stop 2 h during sedimentation I', durationS: 8 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: () => null, pauses: [{ at: T0 + 6300e3, dur: 7200 }],
    expect: { warnings: ['paused'], cleared: ['paused'] } },
  { name: 'Radio panel stop 2 h during pump-out', durationS: 8 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: () => null, pauses: [{ at: T0 + 9950e3 + 300e3, dur: 7200 }],
    expect: { warnings: ['paused'], cleared: ['paused'] } },
  { name: 'First start in the middle of a waiting cycle (no stored phase)', durationS: 10 * 3600,
    tripAt: (c, n) => (n === 4 ? 300 : null),
    expect: { warnings: [], warmupMs: 1.2 * H_ } },
  { name: 'Week of normal use (seeded trips)', durationS: 7 * 24 * 3600, startCycle: 'cleaning', powerUp: true,
    tripAt: (c, n) => ((n * 7919) % 11 < 4 ? 60 + ((n * 37) % 500) : null),
    expect: { warnings: [] } },
];

let fails = 0;
const summary = [];
for (const S of SC) {
  if (filter && !S.name.toLowerCase().includes(filter.toLowerCase())) continue;
  const sim = F.simulate(Object.assign({ t0: T0, seed: 11 }, S));
  const E = S.expect;
  const shellyCuts = [];
  if (S.shellyWithCut) {
    const offs = sim.marks.filter((m) => /power cut/.test(m.s)), ons = sim.marks.filter((m) => /power back/.test(m.s));
    offs.forEach((m, i) => shellyCuts.push({ off: m.t, on: ons[i].t }));
  }
  const t0 = S.powerUp ? T0 - 2000 : T0 - 60e3;
  const chemSetAt = T0 + 120e3;
  const run = R.runV3({
    events: sim.events, t0, t1: sim.tEnd, kvs: KVS, uptimeAtStartS: S.powerUp ? 1 : 86400, resetReason: S.powerUp ? 1 : 3,
    shellyCuts, swReboots: S.swReboots, userSets: [{ at: chemSetAt, role: 'chemical', value: 20 }], verbose,
  });
  const problems = [];
  if (run.uncaught.length) problems.push('uncaught: ' + run.uncaught.map((u) => u.s).join(' | '));

  // phases
  const acc = R.phaseAccuracy(run, sim.gt, T0 + (E.warmupMs || 0), sim.tEnd);
  if (acc.pct < 99) problems.push(`phase accuracy ${acc.pct.toFixed(2)} %`);

  // batches: count and time (the firmware counts 780 s after the pump-out start)
  const bEv = run.events.filter((e) => e.type === 'batch' && !e.user);
  const bSim = sim.marks.filter((m) => /batch \+1/.test(m.s)).map((m) => m.t / 1000);
  if (bEv.length !== bSim.length) problems.push(`batches ${bEv.length} != firmware ${bSim.length}`);
  const bErr = bEv.map((e, i) => (bSim[i] === undefined ? null : e.ts - bSim[i]));
  if (bErr.some((d) => d === null || Math.abs(d) > 10)) problems.push('batch times off by ' + bErr.join(','));
  const lastB = JSON.parse(run.kvs.get('uc_batch')).n;
  if (lastB !== 100 + bSim.length) problems.push('KVS batch count ' + lastB);

  // pump-out estimate: the last estimate before each pump-out, and every estimate made after
  // the cycle start (from `earlyEtaFrom` in scenarios where high water cuts the aeration)
  // (estimates made during a radio-panel stop cannot know about it and are left out)
  const outs = sim.marks.filter((m) => m.s === 'pump-out').map((m) => m.t + 1000);
  const pz = sim.marks.filter((m) => /^pause \d/.test(m.s)).map((m, i) => [m.t, sim.marks.filter((x) => x.s === 'pause ends')[i].t + 300e3]);
  const cutsAt = sim.marks.filter((m) => /power cut/.test(m.s)).map((m) => m.t);
  const finalErr = [], allErr = [];
  outs.forEach((o, i) => {
    const prev = i ? outs[i - 1] + 10e3 : 0;   // the start is seen after the debounce
    const before = run.states.filter((x) => x.t < o && x.t > prev && x.s.eta !== null && x.s.cycle === 'cleaning');
    if (!before.length) return;
    finalErr.push(before[before.length - 1].s.eta - o / 1000);
    for (const x of before) {
      if (E.earlyEtaFrom && x.t < T0 + E.earlyEtaFrom) continue;
      if (pz.some(([a, b]) => x.t <= b && a <= o)) continue;
      if (cutsAt.some((c) => c >= x.t && c <= o)) continue;
      if (process.env.ETADBG && Math.abs(x.s.eta - o / 1000) > 60) console.log('ETADBG', fmt(x.t), x.s.cycle, x.s.phase, fmt(x.s.eta * 1000), fmt(o));
      allErr.push(x.s.eta - o / 1000);
    }
  });
  const maxAbs = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  if (maxAbs(finalErr) > 60) problems.push('final ETA errors ' + finalErr.join(','));
  if (maxAbs(allErr) > 60) problems.push('ETA error up to ' + maxAbs(allErr) + ' s');

  // warnings
  const wEv = run.events.filter((e) => e.type === 'warning');
  const raised = [...new Set(wEv.filter((e) => e.on).map((e) => e.key))];
  const unexpected = raised.filter((k) => !E.warnings.includes(k));
  if (unexpected.length) problems.push('unexpected warnings: ' + unexpected.join(','));
  for (const k of E.warnings) if (!raised.includes(k)) problems.push('missing warning ' + k);
  for (const k of E.cleared || []) { const last = wEv.filter((e) => e.key === k).pop(); if (last && last.on) problems.push('warning not cleared: ' + k); }

  // restarts after power cuts
  const restarts = run.events.filter((e) => e.type === 'start' && e.reason === 'power_cut' && e.t > T0 + 60e3).length;
  if (E.restarts !== undefined && restarts !== E.restarts) problems.push(`restarts ${restarts} != ${E.restarts}`);

  // holiday
  let holInfo = '';
  const hs = sim.marks.find((m) => /holiday cycle/.test(m.s));
  const hc = R.timeline(run.changes, 'cycle').find((c) => c.v === 'holiday');
  if (E.holidayWithinMin) {
    const since = run.states.map((x) => x.s.holiday_since).find((x) => x);
    if (!hs) problems.push('firmware never entered holiday');
    else if (!hc || !since) problems.push('holiday not detected');
    else {
      const d1 = (hc.t - hs.t) / 60e3, d2 = (since * 1000 - hs.t) / 60e3;
      holInfo = `holiday shown ${d1.toFixed(1)} min, since ${d2.toFixed(1)} min from firmware`;
      if (Math.abs(d1) > E.holidayWithinMin || Math.abs(d2) > E.holidayWithinMin) problems.push(holInfo);
    }
  } else if (hc && !hs) problems.push('unexpected holiday at ' + fmt(hc.t));

  // chemical: 20 l set by the user, 0.04 l per dose after that
  const doses = sim.doses.filter((t) => t > chemSetAt).length;
  const chem = run.changes.filter((c) => c.role === 'chemical').pop();
  const expChem = Math.round((20 - 0.04 * doses) * 100) / 100;
  if (!chem || Math.abs(chem.value - expChem) > 0.001) problems.push(`chemical ${chem && chem.value} != ${expChem}`);

  const ok = !problems.length; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${S.name}`);
  console.log(`      phases ${acc.pct.toFixed(2)} % of ${acc.n} s | batches ${bEv.length}/${bSim.length} (dt ${[...new Set(bErr)].join(',')}) | ETA final ${finalErr.map((x) => Math.round(x)).join(',') || '-'} max ${Math.round(maxAbs(allErr))} s | warnings ${raised.join(',') || '-'}${holInfo ? ' | ' + holInfo : ''}`);
  if (!ok || verbose) for (const [k, n] of acc.confusion.slice(0, 6)) console.log(`        ${n} s  ${k}`);
  for (const p of problems) console.log('      !! ' + p);
  summary.push({ name: S.name, ok, acc: acc.pct, batches: bEv.length });
}
console.log(fails ? `\n${fails} scenario(s) failed` : '\nall scenarios passed');
process.exitCode = fails ? 1 : 0;
