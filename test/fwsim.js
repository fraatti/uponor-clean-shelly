// Firmware simulator: produces a 1 Hz power trace from the Uponor Clean 1 control-unit logic
// (pseudocode extracted from the firmware). Scenario hooks decide level-switch inputs.
'use strict';

const PW = { off: 0.0, idle: 3.9, valve: 16.4, dose: 33.0, comp: 43.0, aer: 56.0, boost: 64.8 };
const FW = {
  PRE_AERATION: 600, AERATION: 5400, CHEM_FILLING: 90, DOSING: 10, MIXING: 120, SEDIMENT_1: 2700, SLUDGE_RETURN: 120,
  SEDIMENT_2: 900, PUMP_OUT: 780, PUMP_IN_MAX: 1020, PINMIX_ON: 5, PINMIX_OFF: 120,
  WAIT_2: 1080, SLUDGE_2: 60, AERATION_2: 1800, PUMP_IN_2: 600, HOLIDAY_AFTER: 256200,
  WAIT_3A: 3000, AERATION_3: 600, PUMP_IN_3: 600, WAIT_3B: 6000, SLUDGE_3: 60,
};

class Cut extends Error {}

/* sc = {
     t0, durationS,
     startCycle: 'waiting' | 'cleaning',
     tripAt(ctx, n) -> seconds into pump-in when the start level is reached, or null.  ctx: 'post' | 'wait' | 'holiday', n = pump-in index
     highWaterAtStart(n) -> bool (cleaning phase 1), highWaterCutAt(n) -> seconds into aeration or null,
     highWaterInWaiting(k) -> bool, outletBlocked(batch) -> bool,
     powerCuts: [{at: ms, dur: s}], bootGapS, testAt: [ms]
   } */
function simulate(sc) {
  const ev = [];
  let t = sc.t0;
  const tEnd = sc.t0 + sc.durationS * 1000;
  let seed = sc.seed || 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const cuts = (sc.powerCuts || []).slice().sort((a, b) => a.at - b.at);
  const tests = (sc.testAt || []).slice().sort((a, b) => a - b);
  const pauses = (sc.pauses || []).slice().sort((a, b) => a.at - b.at);   // stop from the radio panel: {at, dur}
  const marks = [];
  const gt = [];   // ground truth: {t, cyc, ph} at the start of each firmware phase (the self-test dip)
  const doses = [];
  let pumpIns = 0, batches = 0, cleanings = 0, waitLoops = 0;
  let lastP = null;

  function sample(p) {
    const v = p === 0 ? 0 : Math.round((p + (rnd() - 0.5) * 0.6) * 10) / 10;
    if (lastP === null || Math.abs(v - lastP) >= 0.1) { ev.push({ t, p: v }); lastP = v; }
  }
  function emit(kind, dur) {
    for (let i = 0; i < dur; i++) {
      if (t >= tEnd) throw new Cut('end');
      if (cuts.length && t >= cuts[0].at) throw new Cut('power');
      if (tests.length && t >= tests[0]) throw new Cut('test');
      if (pauses.length && t >= pauses[0].at) doPause();
      sample(PW[kind]); t += 1000;
    }
  }
  const label = (cyc, ph) => { const l = gt[gt.length - 1]; if (!l || l.cyc !== cyc || l.ph !== ph) gt.push({ t, cyc, ph }); };
  function phase(kind, dur, cyc, ph) { if (ph) label(cyc, ph); if (ph === 'dosing') doses.push(t); emit('idle', 1); emit(kind, dur - 1 > 0 ? dur - 1 : 0); }
  const mark = (s) => marks.push({ t, s });
  // the outputs go off and the interrupted phase continues with its remaining time (assumed)
  function doPause() {
    const p = pauses.shift(); const prev = gt[gt.length - 1];
    mark('pause ' + p.dur + ' s'); gt.push({ t, cyc: 'paused', ph: 'paused' });
    for (let k = 0; k < p.dur; k++) { if (t >= tEnd) throw new Cut('end'); sample(PW.idle); t += 1000; }
    mark('pause ends'); gt.push({ t, cyc: prev.cyc, ph: prev.ph });
  }

  function pumpIn(max, ctx) {
    const n = ++pumpIns; const trip = sc.tripAt ? sc.tripAt(ctx, n) : null;
    label(ctx === 'post' ? 'cleaning' : ctx === 'wait' ? 'waiting' : 'holiday', 'pump_in');
    mark('pump-in ' + ctx + (trip != null ? ' trip@' + trip : ''));
    emit('idle', 1);
    let s = 0;
    while (s < max) {
      for (let i = 0; i < FW.PINMIX_ON && s < max; i++, s++) { if (trip != null && s >= trip) return true; emit('boost', 1); }
      for (let i = 0; i < FW.PINMIX_OFF && s < max; i++, s++) { if (trip != null && s >= trip) return true; emit('comp', 1); }
    }
    return trip != null && trip <= max;
  }

  function cleaning(hwForced) {
    const n = ++cleanings; mark('cleaning cycle #' + n);
    let fromChem = hwForced || (sc.highWaterAtStart && sc.highWaterAtStart(n));
    if (!fromChem) {
      const cut = sc.highWaterCutAt ? sc.highWaterCutAt(n) : null;
      phase('aer', Math.min(FW.PRE_AERATION, cut != null ? cut : 1e9), 'cleaning', 'pre_aeration');
      if (cut != null && cut <= FW.PRE_AERATION) { mark('high water cut aeration'); }
      else {
        const rest = cut != null ? cut - FW.PRE_AERATION : FW.AERATION;
        phase('aer', rest, 'cleaning', 'aeration'); if (cut != null) mark('high water cut aeration');
      }
    } else mark('high water at start: skip aeration');
    for (;;) {
      phase('valve', FW.CHEM_FILLING, 'cleaning', 'chem_filling'); phase('dose', FW.DOSING, 'cleaning', 'dosing'); phase('aer', FW.MIXING, 'cleaning', 'mixing');
      phase('idle', FW.SEDIMENT_1, 'cleaning', 'sedimentation_1'); phase('comp', FW.SLUDGE_RETURN, 'cleaning', 'sludge_removal'); phase('idle', FW.SEDIMENT_2, 'cleaning', 'sedimentation_2');
      mark('pump-out'); phase('comp', FW.PUMP_OUT, 'cleaning', 'pump_out'); batches++; mark('batch +1 = ' + batches);
      if (sc.outletBlocked && sc.outletBlocked(batches)) { mark('outlet blocked: start level still on'); emit('idle', 1); continue; }
      break;
    }
    if (pumpIn(FW.PUMP_IN_MAX, 'post')) return 'cleaning';
    emit('idle', 1);
    return 'waiting';
  }
  function waiting() {
    const start = t; mark('waiting cycle');
    for (;;) {
      const k = ++waitLoops;
      phase('idle', FW.WAIT_2, 'waiting', 'waiting'); phase('comp', FW.SLUDGE_2, 'waiting', 'sludge_removal');
      if (sc.highWaterInWaiting && sc.highWaterInWaiting(k)) { mark('high water in waiting check'); return 'cleaning-hw'; }
      phase('aer', FW.AERATION_2, 'waiting', 'aeration');
      if (pumpIn(FW.PUMP_IN_2, 'wait')) return 'cleaning';
      if ((t - start) / 1000 >= FW.HOLIDAY_AFTER) return 'holiday';
    }
  }
  function holiday() {
    mark('holiday cycle');
    for (;;) {
      phase('idle', FW.WAIT_3A, 'holiday', 'waiting'); phase('aer', FW.AERATION_3, 'holiday', 'aeration');
      if (pumpIn(FW.PUMP_IN_3, 'holiday')) return 'cleaning';
      phase('idle', FW.WAIT_3B, 'holiday', 'waiting'); phase('comp', FW.SLUDGE_3, 'holiday', 'sludge_removal');
    }
  }
  function testCycle() {
    mark('test cycle');
    phase('comp', 20, 'test', 'test_comp'); phase('comp', 20); phase('comp', 5); phase('valve', 90, 'test', 'chem_filling'); phase('dose', 10, 'test', 'dosing'); phase('aer', 30, 'test', 'aeration');
    return 'waiting';
  }

  let state = sc.startCycle || 'waiting';
  for (;;) {
    try {
      if (state === 'cleaning') state = cleaning();
      else if (state === 'cleaning-hw') state = cleaning(true);
      else if (state === 'waiting') state = waiting();
      else if (state === 'holiday') state = holiday();
      else if (state === 'test') state = testCycle();
    } catch (e) {
      if (!(e instanceof Cut)) throw e;
      if (e.message === 'end') break;
      if (e.message === 'test') { tests.shift(); state = 'test'; continue; }
      const c = cuts.shift(); mark('power cut ' + c.dur + ' s'); label('off', 'off');
      const until = t + c.dur * 1000; while (t < until && t < tEnd) { sample(PW.off); t += 1000; }
      mark('power back: boot'); label('boot', 'boot');
      const g = sc.bootGapS != null ? sc.bootGapS : 6; for (let i = 0; i < g && t < tEnd; i++) { sample(PW.idle); t += 1000; }
      state = 'cleaning';
    }
  }
  return { events: ev, marks, batches, tEnd, gt, doses };
}

module.exports = { simulate, FW, PW };
