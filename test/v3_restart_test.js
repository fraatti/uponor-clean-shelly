// v3 over restarts and short power cuts: a script stop or Shelly reboot (update) in the middle of
// a phase, a clock that is not set yet after the reboot, power cuts of the plant only (the Shelly
// stays on) and at the moment a batch or a dose is counted, warnings over a restart, the clock
// jitter of the next pump-out time. Each case was a bug in 3.0.2 (found by a review, 22.11.2026).
//   node test/v3_restart_test.js [-v]
// V3_FILE=shelly/v3/uponor_clean_v3_shelly.js runs the compact version.
'use strict';
const L = require('./v3ext');
const { T0, H } = L;

const verbose = process.argv.includes('-v');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const rel = (t) => Math.round((t - T0) / 1000);

// cleaning base trace (power-up at T0): aeration ends at +6000 s, dosing +6090..6100 s, sedimentation I
// ends at +8920 s, pump-out +9940 s, batch at +10720 s, the next cleaning cycle at about +11030 s
const PO = T0 + 9940e3, DOSE = T0 + 6090e3, SED1_END = T0 + 8920e3;

function run(base, simExtra, ctl, durS) {
  const sim = L.simFor(base, simExtra, durS || 8 * 3600);
  const r = L.runExt(L.runOpts(base, sim, ctl));
  if (r.uncaught.length) console.log('  uncaught: ' + r.uncaught[0].s);
  return { sim, r };
}
function counts(sim, r) {
  return {
    bSim: sim.marks.filter((m) => /batch \+1/.test(m.s)).length,
    bScr: r.events.filter((e) => e.type === 'batch' && !e.user).length,
    dSim: sim.doses.filter((t) => t > T0 + 120e3).length,
    dScr: r.events.filter((e) => e.type === 'chemical' && !e.user).length,
  };
}
// script phase at t
const phaseAt = (r, t) => { let v = null; for (const c of r.changes) if (c.role === 'phase' && c.t <= t) v = c.value; return v; };
const warnOn = (r, key, from) => r.events.filter((e) => e.type === 'warning' && e.key === key && e.on && e.t >= (from || 0));
// a phase of the simulator truth: [start, end] of the n-th phase matching cyc/ph
function gtPhase(sim, cyc, ph, n) {
  const gt = sim.gt;
  let k = 0;
  for (let i = 0; i + 1 < gt.length; i++) if (gt[i].cyc === cyc && gt[i].ph === ph && k++ === (n || 0)) return [gt[i].t, gt[i + 1].t];
  return null;
}
function show(r, from, to) {
  if (!verbose) return;
  console.log('    phases: ' + r.changes.filter((c) => c.role === 'phase' && c.t >= from && c.t <= to).map((c) => rel(c.t) + ' ' + c.value).join(', '));
  console.log('    log: ' + r.logs.filter((l) => l.t >= from && l.t <= to).map((l) => rel(l.t) + ' ' + l.s.replace('[uc] ', '')).join(' | '));
}

// 1. a batch whose moment (pump-out +780 s) falls in a script stop or a reboot
{
  const cases = [
    ['script stopped 120 s from pump-out +700 s', {}, { scriptStops: [{ at: PO + 700e3, durMs: 120e3 }] }],
    ['Shelly software reboot at pump-out +772 s', {}, { swReboots: [{ at: PO + 772e3, offMs: 8000, rr: 3 }] }],
    ['script stopped 240 s from pump-out +650 s, start level 40 s into the pump-in', { tripAt: (c, n) => (n === 1 ? 40 : null) },
      { scriptStops: [{ at: PO + 650e3, durMs: 240e3 }] }],
  ];
  for (const [name, sx, ctl] of cases) {
    const { sim, r } = run('cleaning', sx, ctl);
    const c = counts(sim, r);
    const back = (ctl.scriptStops ? ctl.scriptStops[0].at + ctl.scriptStops[0].durMs : ctl.swReboots[0].at + 11e3);
    const ev = r.events.filter((e) => e.type === 'batch' && !e.user)[0];
    const fwBatch = sim.marks.find((m) => /batch \+1/.test(m.s)).t;
    const ph = phaseAt(r, back + 30e3), truth = sim.gt.filter((g) => g.t <= back + 30e3).pop().ph;
    show(r, PO, back + 600e3);
    check(c.bScr === c.bSim && ev && Math.abs(ev.ts * 1000 - fwBatch) <= 3000 && ph === truth,
      `${name}: batches ${c.bScr}/${c.bSim}, batch time ${ev ? Math.round((ev.ts * 1000 - fwBatch) / 1000) : '-'} s from the firmware, 30 s after: ${ph} (truth ${truth})`);
  }
}

// 2. a script stop over the 120 s sludge removal (sedimentation I -> II)
for (const [from, dur] of [[-30, 200], [-60, 300], [-300, 600]]) {
  const { sim, r } = run('cleaning', {}, { scriptStops: [{ at: SED1_END + from * 1000, durMs: dur * 1000 }] }, 6 * 3600);
  const c = counts(sim, r);
  const back = SED1_END + (from + dur) * 1000;
  show(r, SED1_END - 600e3, back + 1200e3);
  check(c.bScr === c.bSim && phaseAt(r, back + 30e3) === 'sedimentation_2',
    `script stopped ${dur} s from sedimentation I end ${from} s: ${phaseAt(r, back + 30e3)} after, batches ${c.bScr}/${c.bSim}`);
}

// 3. a dose whose moment falls in a stop or reboot (the restart is in the mixing or later)
{
  const cases = [
    ['script stopped 200 s from aeration end -30 s (restart in the mixing)', { scriptStops: [{ at: T0 + 5970e3, durMs: 200e3 }] }],
    ['script stopped 600 s from aeration end -60 s (restart in sedimentation I)', { scriptStops: [{ at: T0 + 5940e3, durMs: 600e3 }] }],
    ['Shelly software reboot at chemical filling +80 s', { swReboots: [{ at: T0 + 6080e3, offMs: 8000, rr: 3 }] }],
    ['Shelly software reboot at dosing +2 s', { swReboots: [{ at: DOSE + 2e3, offMs: 8000, rr: 3 }] }],
    ['Shelly software reboot at dosing +8 s', { swReboots: [{ at: DOSE + 8e3, offMs: 8000, rr: 3 }] }],
  ];
  for (const [name, ctl] of cases) {
    const { sim, r } = run('cleaning', {}, ctl);
    const c = counts(sim, r);
    const paused = warnOn(r, 'paused');
    show(r, T0 + 5900e3, T0 + 7000e3);
    check(c.dScr === c.dSim && paused.length === 0, `${name}: doses ${c.dScr}/${c.dSim}, paused warnings ${paused.length}`);
  }
}

// 4. a restart across the end of a pump-in (cleaning, waiting and holiday cycles)
for (const [base, cyc] of [['cleaning', 'cleaning'], ['waiting', 'waiting'], ['holiday', 'holiday']]) {
  const sim0 = L.simFor(base, {}, 14 * 3600);
  const p = gtPhase(sim0, cyc, 'pump_in', cyc === 'cleaning' ? 0 : 1);
  for (const [kind, ctl] of [['software reboot', { swReboots: [{ at: p[1] - 14e3, offMs: 8000, rr: 3 }] }], ['script stopped 2 min', { scriptStops: [{ at: p[1] - 14e3, durMs: 120e3 }] }]]) {
    const back = ctl.swReboots ? p[1] - 3e3 : p[1] + 106e3;
    const { sim, r } = run(base, {}, ctl, 14 * 3600);
    const ev = L.evaluate(sim, r, back, Math.min(sim.tEnd, back + 4 * H), {});
    show(r, p[0], back + 900e3);
    check(ev.maxUnkRunS <= 60 && ev.missB === 0 && ev.extraB === 0, `${cyc} pump-in end, ${kind}: longest unknown ${ev.maxUnkRunS} s, phases right ${ev.pct.toFixed(1)} %`);
  }
}

// 5. a Shelly reboot with the clock not set for 60 s: the stored phase waits for the clock
for (const [name, at] of [['aeration', T0 + 3000e3], ['sedimentation I', T0 + 7500e3], ['pump-out +765 s', PO + 765e3]]) {
  const { sim, r } = run('cleaning', {}, { swReboots: [{ at, offMs: 8000, rr: 3 }], unsyncS: 60 });
  const ev = L.evaluate(sim, r, at + 11e3, Math.min(sim.tEnd, at + 4 * H), { dosesFrom: T0 + 120e3 });
  const c = counts(sim, r);
  show(r, at - 60e3, at + 600e3);
  check(ev.maxUnkRunS <= 90 && c.bScr === c.bSim && ev.etaNullS <= 120, `reboot in ${name}, clock unset 60 s: longest unknown ${ev.maxUnkRunS} s, batches ${c.bScr}/${c.bSim}, next pump-out missing ${ev.etaNullS} s`);
}

// 6. power cuts of the plant only (the Shelly stays on), also too short to be seen as 0 W
{
  const sim0 = L.simFor('waiting', {}, 14 * 3600);
  const wt = gtPhase(sim0, 'waiting', 'waiting', 1);
  const cases = [
    ['cleaning', 'aeration', T0 + 3000e3, 2], ['cleaning', 'aeration', T0 + 3000e3, 5], ['cleaning', 'sedimentation I', T0 + 7500e3, 2],
    ['cleaning', 'pump-out +765 s', PO + 765e3, 2], ['cleaning', 'pump-out +776 s', PO + 776e3, 3], ['waiting', 'waiting', wt[0] + 380e3, 2],
    ['waiting', 'waiting, no 0 W reading', wt[0] + 380e3, 0], ['cleaning', 'sedimentation II, no 0 W reading', T0 + 9500e3, 0],
  ];
  for (const [base, name, at, dur] of cases) {
    const { sim, r } = run(base, { powerCuts: [{ at, dur }] }, {}, 14 * 3600);
    const back = sim.marks.find((m) => /power back/.test(m.s)).t;
    const ev = L.evaluate(sim, r, back, Math.min(sim.tEnd, back + 4 * H), { dosesFrom: T0 + 120e3 });
    show(r, at - 60e3, back + 900e3);
    check(ev.recovS !== null && ev.recovS <= 60 && ev.missB === 0 && ev.extraB === 0 && ev.etaMaxErrAfterRecov <= 60,
      `plant only ${dur} s cut in ${base} / ${name}: back in sync in ${ev.recovS} s, batches missed ${ev.missB} extra ${ev.extraB}, next pump-out off by ${ev.etaMaxErrAfterRecov} s`);
  }
}

// 7. a cut in the first seconds of the mixing does not lose the dose
for (const off of [13, 15, 17]) {
  const sim = L.simFor('cleaning', { powerCuts: [{ at: DOSE + off * 1000, dur: 30 }] }, 8 * 3600);
  const offM = sim.marks.find((m) => /power cut/.test(m.s)), onM = sim.marks.find((m) => /power back/.test(m.s));
  const r = L.runExt(L.runOpts('cleaning', sim, { shellyCuts: [{ off: offM.t, on: onM.t }] }));
  const c = counts(sim, r);
  check(c.dScr === c.dSim, `power cut (Shelly too) at dosing +${off} s: doses ${c.dScr}/${c.dSim}`);
}

// 8. warnings: outlet blocked ends with the pump-in, no compressor warning when the power returns
//    after 5 h, no false pause in the holiday Waiting II after a reboot with the clock not set,
//    a warning on at a restart gets its "off" event
{
  const sim = L.F.simulate({ t0: T0, seed: 11, durationS: 30 * 3600, startCycle: 'cleaning', tripAt: () => null, outletBlocked: (b) => b === 1 });
  const r = L.runExt(L.runOpts('cleaning', sim, {}));
  const ev = r.events.filter((e) => e.type === 'warning' && e.key === 'outlet_blocked');
  const wait = sim.marks.find((m) => /waiting cycle/.test(m.s)).t;
  check(ev.length === 2 && ev[0].on && !ev[1].on && ev[1].t <= wait, `outlet blocked: ${ev.map((e) => (e.on ? 'on ' : 'off ') + rel(e.t)).join(', ')} (waiting cycle at ${rel(wait)})`);
}
{
  const { r } = run('cleaning', { powerCuts: [{ at: T0 + 3 * H, dur: 5 * 3600 }] }, {}, 12 * 3600);
  check(warnOn(r, 'compressor_idle').length === 0, 'plant off 5 h (Shelly on): no "compressor not running" when the power returns');
}
{
  // holiday base: Waiting II from about +13000 s; reboot in it with the clock unset
  const sim0 = L.simFor('holiday', {}, 14 * 3600);
  const w2 = gtPhase(sim0, 'holiday', 'waiting', 1);
  const { r } = run('holiday', {}, { swReboots: [{ at: w2[0] + 1200e3, offMs: 8000, rr: 3 }], unsyncS: 60 }, 14 * 3600);
  const p = warnOn(r, 'paused', w2[0]);
  check(p.length === 0, `reboot in the holiday Waiting II, clock unset 60 s: paused warnings ${p.length}`);
}
{
  // a 2 h stop from the panel in sedimentation I ("paused" on), a script restart during it
  const { r } = run('cleaning', { pauses: [{ at: T0 + 6300e3, dur: 7200 }] }, { scriptStops: [{ at: T0 + 6300e3 + 5000e3, durMs: 60e3 }] }, 8 * 3600);
  const ev = r.events.filter((e) => e.type === 'warning' && e.key === 'paused');
  const last = ev[ev.length - 1];
  check(ev.length >= 2 && last && !last.on, 'paused on at a script restart: ' + ev.map((e) => (e.on ? 'on ' : 'off ') + rel(e.t)).join(', '));
}

// 9. a batch counted before the clock is set gets its time when the clock is set; "since" is kept
//    over a reboot
{
  const sim = L.simFor('cleaning', { powerCuts: [{ at: T0 + 7500e3, dur: 30 }] }, 10 * 3600);
  const offM = sim.marks.find((m) => /power cut/.test(m.s)), onM = sim.marks.find((m) => /power back/.test(m.s));
  const r = L.runExt(L.runOpts('cleaning', sim, { shellyCuts: [{ off: offM.t, on: onM.t }], unsyncS: 3 * 3600, sampleMs: 600e3 }));
  const batch = r.events.find((e) => e.type === 'batch' && !e.user);
  const after = batch && r.states.find((s) => s.s.time_synced && s.t > batch.t);
  const fwBatch = sim.marks.find((m) => /batch \+1/.test(m.s)).t;
  check(batch && batch.ts === null && after && Math.abs(after.s.last_pumpout * 1000 - fwBatch) <= 3000,
    `batch with the clock unset: event time ${batch && batch.ts}, last pump-out after the clock is set ${after ? Math.round((after.s.last_pumpout * 1000 - fwBatch) / 1000) + ' s from the firmware' : '-'}`);
}
{
  const at = T0 + 2 * H;
  const { r } = run('cleaning', {}, { swReboots: [{ at, offMs: 8000, rr: 3 }], sampleMs: 30e3 }, 4 * 3600);
  const before = r.states.filter((x) => x.t < at).pop(), after = r.states.find((x) => x.t > at + 20e3);
  check(after && after.s.since === before.s.since, `since over a reboot: ${before.s.since} -> ${after && after.s.since}`);
}

// 10. the next pump-out time is not rewritten for a second of clock jitter (drift 20 ppm, timer latency)
{
  const sim = L.simFor('waiting', {}, 26 * 3600);
  const r = L.runExt(Object.assign(L.runOpts('waiting', sim, {}), { driftPpm: 20, jitterMs: 20, seed: 7 }));
  const tl = L.timeline(r.changes, 'next_pumpout').filter((c) => c.t > T0 + 2 * H);
  let small = 0;
  for (let i = 1; i < tl.length; i++) if (tl[i].v && tl[i - 1].v && Math.abs(Date.parse(tl[i].v) - Date.parse(tl[i - 1].v)) <= 2000) small++;
  check(small === 0, `next pump-out over 24 h with clock drift and timer latency: ${tl.length} writes, ${small} of them 1-2 s changes`);
}

console.log(fails ? '\n' + fails + ' failed' : '\nall restart checks passed');
process.exit(fails ? 1 : 0);
