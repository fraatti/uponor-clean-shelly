// Minute records like the Shelly's EM1Data from a firmware simulation (test/fwsim.js): minimum and
// maximum power and the energy in steps of 0.2072 Wh, at a given voltage.
'use strict';
const EQ = 0.2072;

function minutes(sim, t0, t1, U = 237) {
  const raw = (p) => (p > 10 ? (p - 4) / ((230 / U) * (230 / U)) + 4 : p);   // the simulator's levels are at 230 V
  const ev = sim.events, out = [];
  let i = 0, p = 0, cum = 0, tPrev = t0;   // cum: Wh since t0
  const cumAt = []; // cumulative energy at each minute boundary
  for (let t = t0; t <= t1; t += 60e3) {
    let mn = Infinity, mx = -Infinity;
    const end = t + 60e3;
    // power at the minute start
    while (i < ev.length && ev[i].t <= t) { cum += raw(p) * (ev[i].t - tPrev) / 3600e3; tPrev = ev[i].t; p = ev[i].p; i++; }
    mn = Math.min(mn, raw(p)); mx = Math.max(mx, raw(p));
    let j = i;
    let c2 = cum, tp = tPrev, pp = p;
    while (j < ev.length && ev[j].t < end) { c2 += raw(pp) * (ev[j].t - tp) / 3600e3; tp = ev[j].t; pp = ev[j].p; mn = Math.min(mn, raw(pp)); mx = Math.max(mx, raw(pp)); j++; }
    c2 += raw(pp) * (end - tp) / 3600e3;
    cumAt.push(c2);
    out.push({ ts: t / 1000, p: 60, mn: Math.round(mn * 10) / 10, mx: Math.round(mx * 10) / 10, u: U, cEnd: c2 });
  }
  // the energy counter counts whole steps
  let prevQ = 0;
  for (const r of out) { const q = Math.floor(r.cEnd / EQ) * EQ; r.e = Math.round((q - prevQ) * 1e4) / 1e4; prevQ = q; delete r.cEnd; }
  return out;
}

module.exports = { minutes };
