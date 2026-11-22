// The app's history merge (app/uponor-clean-app.html, picture section) driven like a browser would:
// state reads every 6 s while connected, the script's state from the firmware simulator's true
// phases, and the Shelly's minute records (test/em1_minutes.js). Checks the counted-back counters,
// resets and edits made while the browser was away, the warnings between visits and the size of
// the stored history.
//   node test/app_history_test.js
// The code is taken from the HTML between "const HE = {" and "// power a minute (normalised", so
// those two lines must stay; it runs with a fake clock and a fake localStorage.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./fwsim');
const { minutes } = require('./em1_minutes');
const ucHistory = require('../app/history_from_power');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'uponor-clean-app.html'), 'utf8');
const A = html.indexOf('const HE = {'), B = html.indexOf('// power a minute (normalised');
if (A < 0 || B < 0) throw new Error('the history code markers are missing in the app');
const CODE = html.slice(A, B);

function make() {
  const clock = { now: Date.UTC(2026, 10, 10, 12) };
  const ls = new Map(), timers = [];
  class FakeDate extends Date { static now() { return clock.now; } }
  const S = { host: '192.168.0.102', recs: new Map(), lastTs: null, state: null, doseL: 0.04 };
  const ctx = { S, console, Math, JSON, String, Number, Array, Object, Infinity, isFinite, parseFloat, isNaN, Set, Map, Date: FakeDate,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, window: { ucHistory } };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\n;this.api = { histLoad, histSeen, histFromState, histView, get H() { return H; } };', ctx);
  return Object.assign(ctx.api, { S, clock, ls, flush: () => { while (timers.length) timers.shift()(); } });
}
// the script's state at any time from the simulator's true phases
function truth(sim, o = {}) {
  const gt = sim.gt.filter((g) => g.ph !== 'boot');
  const pumpOuts = gt.filter((g) => g.ph === 'pump_out').map((g) => g.t);
  const doseEnds = sim.doses.map((t) => t + 10e3);
  const at = (t) => { let g = null; for (const x of gt) if (x.t <= t) g = x; else break; return g; };
  const stateAt = (t) => {
    const g = at(t), counted = pumpOuts.filter((p) => p + 780e3 <= t);
    let chem = o.chem0 ?? 10; for (const d of doseEnds) if (d <= t) chem = Math.max(0, Math.round((chem - 0.04) * 100) / 100);
    return { phase: g ? g.ph : 'unknown', cycle: g ? g.cyc : 'unknown', since: g ? Math.round(g.t / 1000) : null,
      batches: (o.batches0 ?? 500) + counted.length, last_pumpout: counted.length ? Math.round((counted[counted.length - 1] + 780e3) / 1000) : null,
      chemical: { l: chem }, sludge: { n: (o.sludge0 ?? 100) + counted.length, reset: null }, warnings: [], eta: null };
  };
  return { pumpOuts, doseEnds, stateAt, at };
}
function connect(h, tr, a, b, edit) {
  for (let t = a; t <= b; t += 6e3) { h.clock.now = t; const s = tr.stateAt(t); if (edit) edit(s, t); h.S.state = s; h.histFromState(s); h.histSeen(s); }
}
function loadMinutes(h, sim, T0, now) {
  const last = Math.floor(now / 60e3) * 60e3 - 60e3;
  h.S.recs.clear();
  for (const r of minutes(sim, Math.max(T0, last - 7 * 86400e3 + 60e3), last)) h.S.recs.set(r.ts, { e: r.e, mx: r.mx, mn: r.mn, u: r.u, p: r.p });
  h.S.lastTs = last / 1000;
}
const valAt = (series, t) => { let v = null; for (const [x, y] of series) if (x <= t) v = y; else break; return v; };

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const T0 = Date.UTC(2026, 10, 1);
const tripAt = (c, n) => ((n * 7919) % 11 < 4 ? 60 + ((n * 37) % 500) : null);
const sim = F.simulate({ t0: T0, seed: 5, durationS: 7 * 86400, startCycle: 'cleaning', tripAt });

// 1. connecting at any time of a day: the counters counted back over the 2-day gap match the script
{
  const tr = truth(sim), first = [T0 + 10 * 3600e3, T0 + 10.5 * 3600e3];
  let cases = 0, bad = 0;
  for (let c = T0 + 60 * 3600e3; c < T0 + 84 * 3600e3; c += 9.7 * 60e3) {
    const h = make(); h.clock.now = first[0]; h.histLoad();
    connect(h, tr, first[0], first[1]); connect(h, tr, c, c + 60e3);
    loadMinutes(h, sim, T0, c + 60e3);
    const v = h.histView();
    cases++;
    for (let t = first[1] + 20 * 60e3; t < c - 20 * 60e3; t += 300e3) {
      if (tr.pumpOuts.some((p) => Math.abs(p + 780e3 - t) < 120e3) || tr.doseEnds.some((d) => Math.abs(d - t) < 120e3)) continue;
      const s = tr.stateAt(t);
      if (String(s.sludge.n) !== valAt(v.sludge, t) || String(s.batches) !== valAt(v.batch_counter, t) || Math.abs(s.chemical.l - parseFloat(valAt(v.chemical, t))) > 0.005) { bad++; break; }
    }
  }
  check(bad === 0, 'counters over a 2-day gap right at ' + (cases - bad) + ' of ' + cases + ' connection times');
}
// 2. the batch counter set to 0 two days ago: the history never goes below 0
{
  const now = T0 + 7 * 86400e3 - 600e3, base = truth(sim, { batches0: 0 }).stateAt(T0 + 5 * 86400e3).batches;
  const tr = truth(sim, { batches0: -base });
  const h = make(); h.clock.now = now - 120e3; h.histLoad(); connect(h, tr, now - 120e3, now); loadMinutes(h, sim, T0, now);
  const v = h.histView(), low = Math.min(...v.batch_counter.map((x) => +x[1]));
  check(low >= 0, 'batch counter reset while away: lowest value ' + low + ', now ' + v.batch_counter[v.batch_counter.length - 1][1]);
}
// 3. the sludge counter emptied (set to 0) while away: the drop is at the script's reset time
{
  const tr = truth(sim, { sludge0: 790 }), span1 = [T0 + 20 * 3600e3, T0 + 20.5 * 3600e3], c = T0 + 80 * 3600e3, reset = T0 + 50 * 3600e3;
  const after = tr.pumpOuts.filter((p) => p + 780e3 > reset && p + 780e3 <= c).length;
  const h = make(); h.clock.now = span1[0]; h.histLoad();
  connect(h, tr, span1[0], span1[1]);
  connect(h, tr, c, c + 60e3, (s) => { s.sludge = { n: after, reset: reset / 1000 }; });
  loadMinutes(h, sim, T0, c + 60e3);
  const v = h.histView(), before = valAt(v.sludge, reset - 3600e3), want = 790 + tr.pumpOuts.filter((p) => p + 780e3 <= reset - 3600e3).length;
  check(before === String(want) && valAt(v.sludge, reset + 1e3) === '0', 'sludge emptied while away: ' + before + ' an hour before (truth ' + want + '), ' + valAt(v.sludge, reset + 1e3) + ' after');
}
// 4. a warning seen on the last visit is not carried over the time away
{
  const tr = truth(sim), h = make(), t1 = T0 + 30 * 3600e3, t2 = T0 + 78 * 3600e3;
  h.clock.now = t1; h.histLoad();
  connect(h, tr, t1, t1 + 600e3, (s) => { s.warnings = ['high_water']; });
  connect(h, tr, t2, t2 + 60e3);
  loadMinutes(h, sim, T0, t2 + 60e3);
  const v = h.histView();
  check(valAt(v.warning, t1 + 300e3) === 'high_water' && valAt(v.warning, t1 + 24 * 3600e3) === 'unknown' && valAt(v.warning, t2 + 30e3) === 'none',
    'warnings: seen, unknown while away, none now');
}
// 5. a day connected while the script's next pump-out time moves by a second between reads
{
  const tr = truth(sim), h = make(), t1 = T0 + 30 * 3600e3;
  h.clock.now = t1; h.histLoad();
  let k = 0;
  connect(h, tr, t1, t1 + 86400e3, (s, t) => { const g = tr.pumpOuts.find((p) => p > t); s.eta = g ? Math.round(g / 1000) - ((k++ * 7) % 5 === 0 ? 1 : 0) : null; });
  h.flush();
  const st = JSON.parse(h.ls.get('uc_app_hist:192.168.0.102'));
  check(st.s.next_pumpout.length < 40 && st.seen.length === 1, 'a day connected: ' + st.s.next_pumpout.length + ' next pump-out values, ' + st.seen.length + ' span, ' + Math.round(JSON.stringify(st).length / 1024) + ' kB stored');
}
// 6. connecting just after a phase change (the newest minute is not on the Shelly yet): no phase
//    from the last visit days ago shows up in between
{
  const tr = truth(sim), h = make(), t1 = T0 + 20 * 3600e3;
  h.clock.now = t1; h.histLoad();
  connect(h, tr, t1, t1 + 1800e3, (s) => { s.phase = 'waiting'; s.cycle = 'holiday'; });
  const ch = sim.gt.find((g) => g.t > T0 + 70 * 3600e3 && g.t % 60e3 > 25e3 && g.t % 60e3 < 35e3 && g.cyc !== 'holiday');
  connect(h, tr, ch.t + 20e3, ch.t + 20e3);
  loadMinutes(h, sim, T0, ch.t + 20e3);
  const v = h.histView(), seen = new Set();
  for (let t = ch.t - 40 * 60e3; t <= ch.t + 20e3; t += 5e3) seen.add(valAt(v.phase, t) + '/' + valAt(v.cycle, t));
  check(![...seen].some((x) => /holiday/.test(x)), 'connected 20 s after a phase change, the last 40 min: ' + [...seen].join(', '));
}
console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
