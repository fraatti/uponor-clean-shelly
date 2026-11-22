/* Uponor Clean I: the phases of the past days from the Shelly's minute power data (EM1Data).
   github.com/fraatti/uponor-clean-shelly – put into the app by app/tools/build_app.js.

   The Shelly stores one record a minute: the energy, the minimum and the maximum power and the
   voltage. The control unit runs fixed phases with known power levels (normalised to 230 V):
   idle ~4 W, chemical filling ~16 W, dosing ~33 W, the compressor for pump-in, pump-out and
   sludge removal ~43 W (pump-in with a 5 s mixing pulse of ~65 W every 2 min), aeration ~57 W.
   Each minute gets a level class, runs of the same class are joined, and the runs are read with
   the firmware's phase order and durations:
     cleaning: pre-aeration 10 min + aeration 90 min (A), chemical filling 90 s + dosing 10 s (V),
               mixing 2 min (A), sedimentation I 45 min (I), sludge removal 2 min (C),
               sedimentation II 15 min (I), pump-out 13 min (C), pump-in up to 17 min (C + pulses)
     waiting:  waiting 18 min (I), sludge removal 1 min (C), aeration 30 min (A), pump-in up to 10 min
     holiday:  waiting 50 min, aeration 10 min, pump-in up to 10 min, waiting 100 min, sludge 1 min
   The result is approximate: minutes hide short events, and the boundaries are estimated from
   the minute's energy (about ±15 s) or from the firmware durations. */
(function (root) {
  'use strict';
  const LV = { I: 4, V: 20, C: 43, A: 57 };
  const norm = (p, u) => (p > 10 && u > 50 ? (p - 4) * (230 / u) * (230 / u) + 4 : p);
  const cls = (w) => (w < 10 ? 'I' : w < 35 ? 'V' : w < 50 ? 'C' : 'A');

  // one minute: its class, the share of that class and the other class in the minute
  function minute(r) {
    const u = r.u || 230, mn = norm(r.mn, u), mx = norm(r.mx, u), av = norm(r.e * 3600 / (r.p || 60), u);
    if (mx < 1) return { c: 'O', share: 1 };                       // no power at all
    let lo = cls(mn), hi = cls(mx), pulse = false;
    // the pump-in mixing pulse (~65 W) is above aeration (~57 W): it belongs to the compressor level
    if (mx >= 62 && lo !== 'A') { hi = 'C'; pulse = true; }
    if (lo === hi) return { c: lo, share: 1, pulse };
    const span = mx - mn;
    const f = span > 1 ? Math.min(1, Math.max(0, (av - mn) / span)) : 1;   // share of the high level
    return f >= 0.5 ? { c: hi, share: f, other: lo, pulse } : { c: lo, share: 1 - f, other: hi, pulse };
  }

  // runs of the same class; boundaries inside the minute from the energy share
  function runs(recs) {
    const out = [];
    let prev = null;
    for (const r of recs) {
      const m = minute(r), t = r.ts * 1000, p = (r.p || 60) * 1000;
      if (prev && t - prev.tEnd > p / 2) {                           // missing minutes: the Shelly was off
        out.push({ c: 'X', t0: prev.tEnd, t1: t, pulse: false, firstPulse: null });
        prev = null;
      }
      const last = out[out.length - 1];
      if (last && last.c === m.c && prev) { last.t1 = t + p; if (m.pulse && last.firstPulse === null) last.firstPulse = t; last.pulse = last.pulse || m.pulse; }
      else {
        let b = t;
        if (prev && m.other === prev.c) b = t + p * (1 - m.share);           // the previous class first in this minute
        else if (prev && prev.other === m.c) b = prev.t + p * prev.share;     // this class already at the end of the previous minute
        if (last) last.t1 = b;
        out.push({ c: m.c, t0: b, t1: t + p, pulse: !!m.pulse, firstPulse: m.pulse ? t : null });
      }
      prev = Object.assign({ t, tEnd: t + p }, m);
    }
    return out.filter((x) => x.t1 > x.t0);
  }

  // Firmware durations (s) from the start of the pump-out backwards: the cleaning cycle's fixed part.
  const BACK = [[900, 0, 'sedimentation_2'], [1020, 900, 'sludge_removal'], [3720, 1020, 'sedimentation_1'],
    [3840, 3720, 'mixing'], [3850, 3840, 'dosing'], [3940, 3850, 'chem_filling']];
  const PUMP_OUT = 780, PRE = 600, AERATION = 5400;
  // the waiting cycle from the start of its wait; the holiday cycle from the start of its first wait
  const WAIT = [[0, 1080, 'waiting'], [1080, 1140, 'sludge_removal'], [1140, 2940, 'aeration']];
  const HOL_A = [[0, 3000, 'waiting'], [3000, 3600, 'aeration']], HOL_B = [[0, 6000, 'waiting'], [6000, 6060, 'sludge_removal']];

  // reads the runs as firmware phases; returns [{t (ms), ph, cyc}] at each phase start
  function phases(rs) {
    // 1. each run on its own, read as the waiting cycle (or the pump-out with its pump-in)
    const base = [], cleanA = [];
    const add = (arr, t0, t1, ph, cyc) => { if (t1 > t0) arr.push({ t0, t1, ph, cyc }); };
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i], d = (r.t1 - r.t0) / 1000, prev = base[base.length - 1];
      const hol = prev && prev.cyc === 'holiday';
      if (r.c === 'X') add(base, r.t0, r.t1, 'unavailable', 'unknown');
      else if (r.c === 'O') add(base, r.t0, r.t1, 'off', 'unknown');
      else if (r.c === 'A' && ((prev && prev.ph === 'pump_in') || d > 35 * 60)) {
        // high water ended the pump-in, or longer than any waiting or holiday aeration (30 min):
        // a cleaning cycle, which starts with pre-aeration
        cleanA.push(r);
        add(base, r.t0, Math.min(r.t1, r.t0 + PRE * 1e3), 'pre_aeration', 'cleaning');
        add(base, r.t0 + PRE * 1e3, r.t1, 'aeration', 'cleaning');
      } else if (r.c === 'A') {
        const afterLongWait = prev && prev.ph === 'waiting' && prev.t1 - prev.t0 >= 40 * 60e3;
        add(base, r.t0, r.t1, 'aeration', d < 18 * 60 && (afterLongWait || hol) ? 'holiday' : 'waiting');
      } else if (r.c === 'V') add(base, r.t0, r.t1, 'chem_filling', 'cleaning');
      else if (r.c === 'C') {
        const plain = r.pulse ? (r.firstPulse - r.t0) / 1000 : d;      // compressor time before the first mixing pulse
        if (plain >= 8 * 60) {                                         // pump-out (13 min), then maybe pump-in
          const pe = Math.min(r.t1, r.t0 + PUMP_OUT * 1e3);
          add(base, r.t0, pe, 'pump_out', 'cleaning');
          add(base, pe, r.t1, 'pump_in', 'cleaning');
        } else if (r.pulse) add(base, r.t0, r.t1, 'pump_in', prev && prev.ph === 'pump_out' ? 'cleaning' : hol ? 'holiday' : 'waiting');
        else if (d <= 4 * 60) add(base, r.t0, r.t1, 'sludge_removal', hol ? 'holiday' : 'waiting');
        else add(base, r.t0, r.t1, 'pump_in', hol ? 'holiday' : 'waiting');
      } else add(base, r.t0, r.t1, 'waiting', d >= 40 * 60 || (hol && d >= 25 * 60) ? 'holiday' : 'waiting');
    }
    // 2. the cleaning cycle backwards from each pump-out start (the firmware durations are exact)
    const over = [];
    const end = rs.length ? rs[rs.length - 1].t1 : 0;
    // the share of idle time in [t0, t1], or 1 when less than 5 minutes of it has data
    const idleShare = (t0, t1) => {
      t1 = Math.min(t1, end); if (t1 - t0 < 5 * 60e3) return 1;
      let s = 0; for (const r of rs) if (r.c === 'I') s += Math.max(0, Math.min(t1, r.t1) - Math.max(t0, r.t0));
      return s / (t1 - t0);
    };
    // the fixed part of a cleaning cycle whose pump-out starts (or would start) at po, up to the end of the data
    const cleaning = (po) => {
      if (idleShare(po - 3720e3, po - 1020e3) < 0.8 || idleShare(po - 900e3, po) < 0.8) return false;   // not a full cleaning cycle
      for (const [a, z, ph] of BACK) add(over, po - a * 1e3, Math.min(po - z * 1e3, end), ph, 'cleaning');
      const chem = po - 3940e3;
      // the aeration before: the aeration run that ends near the chemical filling
      const ar = rs.filter((r) => r.c === 'A' && r.t0 < chem && r.t1 > chem - 5 * 60e3).pop();
      if (ar) {
        // a full aeration is exactly 100 min; a shorter one was cut by high water
        const st = chem - ar.t0 >= (PRE + AERATION - 120) * 1e3 ? chem - (PRE + AERATION) * 1e3 : ar.t0;
        add(over, st, Math.min(chem, st + PRE * 1e3), 'pre_aeration', 'cleaning');
        add(over, st + PRE * 1e3, chem, 'aeration', 'cleaning');
      }
      return true;
    };
    for (const b of base) if (b.ph === 'pump_out') cleaning(b.t0);
    // a cleaning cycle still running when the data ends (no pump-out yet): forward from its chemical
    // filling, which starts when the cleaning aeration ends (the filling itself is often hidden in
    // minutes that also hold the end of the aeration and the start of the mixing)
    const covered0 = (t) => over.some((v) => v.t0 <= t && t < v.t1);
    const forward = (chem) => {
      const po = chem + 3940e3;
      if (!cleaning(po)) return;
      // a pump-out that has started but is still too short to be told from a pump-in
      const c = rs.find((r) => r.c === 'C' && Math.abs(r.t0 - po) < 3 * 60e3);
      if (c) { const pe = Math.min(c.t1, po + PUMP_OUT * 1e3); add(over, po, pe, 'pump_out', 'cleaning'); add(over, pe, c.t1, 'pump_in', 'cleaning'); }
    };
    for (const r of cleanA) {
      const nx = rs[rs.indexOf(r) + 1];
      if (!nx || nx.c === 'C' || nx.c === 'X' || nx.c === 'O' || covered0(r.t1 + 1)) continue;
      forward(r.t1);
    }
    for (const b of base) if (b.ph === 'chem_filling' && !covered0(b.t0 + 1)) forward(b.t0);
    // the waiting and holiday cycles forward from the start of each wait (the durations are exact)
    const runAt = (t, c) => rs.find((r) => r.c === c && r.t0 <= t && r.t1 > t);
    const covered = (t) => over.some((v) => v.t0 <= t && t < v.t1);
    for (const b of base) {
      if (b.ph !== 'waiting' || covered(b.t0 + 1)) continue;
      const w0 = b.t0, d = (b.t1 - b.t0) / 1000;
      let plan = null, cyc = 'waiting', tail = 0;
      if (d >= 15 * 60 && d <= 21 * 60 && runAt(w0 + 1800e3, 'A')) { plan = WAIT; tail = 2940; }
      else if (d >= 45 * 60 && d <= 55 * 60 && runAt(w0 + 3300e3, 'A')) { plan = HOL_A; cyc = 'holiday'; tail = 3600; }
      else if (d >= 95 * 60 && d <= 105 * 60) { plan = HOL_B; cyc = 'holiday'; }
      if (!plan) continue;
      for (const [a, z, ph] of plan) add(over, w0 + a * 1e3, w0 + z * 1e3, ph, cyc);
      if (tail) {
        // the pump-in that follows the aeration, up to the next wait or cleaning
        const pin = rs.find((r) => r.c === 'C' && Math.abs(r.t0 - (w0 + tail * 1e3)) < 3 * 60e3);
        if (pin) add(over, w0 + tail * 1e3, pin.t1, 'pump_in', cyc);
      }
    }
    // 3. the cleaning cycle over the single runs
    const cuts = [...new Set(base.concat(over).flatMap((x) => [x.t0, x.t1]))].sort((x, y) => x - y);
    const segs = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const m = (cuts[i] + cuts[i + 1]) / 2;
      const x = over.find((v) => v.t0 <= m && m < v.t1) || base.find((v) => v.t0 <= m && m < v.t1);
      if (!x) continue;
      const l = segs[segs.length - 1];
      if (l && l.ph === x.ph && l.cyc === x.cyc) continue;
      segs.push({ t: Math.round(cuts[i]), ph: x.ph, cyc: x.cyc });
    }
    return segs;
  }

  // recs: EM1Data minute records [{ts (s), p (s), e (Wh), mn, mx, u}], any order
  function reconstruct(recs) {
    const rs = runs(recs.slice().sort((a, b) => a.ts - b.ts));
    const segs = phases(rs);
    const pumpOuts = [];
    for (let i = 0; i < segs.length; i++) if (segs[i].ph === 'pump_out') pumpOuts.push(Math.min(segs[i].t + 780e3, i + 1 < segs.length ? segs[i + 1].t : Infinity));
    return { segs, pumpOuts, runs: rs };
  }

  const api = { reconstruct, minute, runs, phases, norm };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ucHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
