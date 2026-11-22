// Extended v3 runner for the restart and power-cut tests (v3_restart_test.js, v3_sweep.js,
// eqtest_v3.js, v3_depth_test.js): the device mock with a clock that is not set for a while after
// a boot (or is wrong), unix clock drift against the uptime, timer latency, Shelly power cuts,
// software reboots and script stops; and a comparison of a run with the simulator's true phases.
// V3_FILE selects the script (default: the readable source).
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const { Device } = require('./shelly_device_mock.js');
const F = require('./fwsim.js');
const V3_PATH = process.env.V3_FILE ? path.resolve(process.env.V3_FILE) : REPO + '/shelly/v3/uponor_clean_v3.js';

// Device with: clock unsynced (or wrong) for N s after each boot, unix clock drift against uptime,
// timer latency jitter, and synthetic change records when a boot resets non-persisted values.
class ExtDevice extends Device {
  constructor(o) {
    super(o);
    this.unsyncS = o.unsyncS || 0;           // after each power-on / reboot
    this.wrongClockS = o.wrongClockS;        // undefined: null while unsynced; number: unixtime offset while unsynced
    this.syncAt = null;
    this.driftPpm = o.driftPpm || 0;
    this.jitterMs = o.jitterMs || 0;
    this.tRef = o.startMs;
    this.seed = o.seed || 12345;
    this.ntpStepEveryS = o.ntpStepEveryS || 0;  // NTP steps the clock back to true time every N s
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }
  unix() {
    if (this.syncAt !== null && this.t < this.syncAt) return this.wrongClockS === undefined ? null : Math.floor(this.t / 1000) + this.wrongClockS;
    if (!this.timeSynced) return null;
    let el = this.t - this.tRef;
    if (this.ntpStepEveryS) el = el % (this.ntpStepEveryS * 1000);
    return Math.floor((this.t + this.driftPpm * 1e-6 * el) / 1000);
  }
  powerOn(bootMs, resetReason) {
    this.bootT = this.t; this.resetReason = resetReason === undefined ? 1 : resetReason;
    if (this.unsyncS) this.syncAt = this.t + this.unsyncS * 1000;
    for (const [k, c] of this.comps) if (c.type !== 'group' && !c.config.persisted && c.config.default_value !== undefined) {
      if (JSON.stringify(c.value) !== JSON.stringify(c.config.default_value) && this.onValue) this.onValue(k, c.config.default_value, this.t);
      c.value = c.config.default_value;
    }
    this.run(bootMs || 3000);
    for (const id of this.autostartIds || []) this.startScript(id);
  }
  run(ms) {
    if (!this.jitterMs) return super.run(ms);
    const end = this.t + ms;
    this.drain();
    for (;;) {
      // timer fires a random latency after its schedule; the schedule itself does not drift
      for (const tm of this.timers) if (tm.fireAt === undefined || tm.fireAt < tm.at) tm.fireAt = tm.at + Math.floor(this.rnd() * this.jitterMs);
      this.timers.sort((a, b) => a.fireAt - b.fireAt);
      const tm = this.timers[0];
      if (!tm || tm.fireAt > end) break;
      this.t = Math.max(this.t, tm.fireAt);
      if (tm.repeat) { tm.at += tm.ms; tm.fireAt = undefined; } else this.timers.shift();
      this.invoke(tm.sid, () => tm.cb(tm.ud));
      this.drain();
    }
    this.t = end;
  }
}

/* o: as test/v3run.js runV3 plus
   unsyncS, wrongClockS, driftPpm, jitterMs, shellyBootMs, swReboots: [{at, offMs, rr}], scriptStops: [{at, durMs}] */
function runExt(o) {
  const code = o.code || fs.readFileSync(V3_PATH, 'utf8');
  const dev = new ExtDevice({ startMs: o.t0, resetReason: o.resetReason, tzOffsetMin: o.tzOffsetMin, unsyncS: o.unsyncS, wrongClockS: o.wrongClockS,
    driftPpm: o.driftPpm, jitterMs: o.jitterMs, seed: o.seed, ntpStepEveryS: o.ntpStepEveryS });
  dev.verbose = !!o.verbose;
  dev.bootT = o.t0 - (o.uptimeAtStartS === undefined ? 86400 : o.uptimeAtStartS) * 1000;
  if (o.unsyncAtStartS) dev.syncAt = o.t0 + o.unsyncAtStartS * 1000;
  for (const k of Object.keys(o.kvs || {})) dev.kvs.set(k, o.kvs[k]);
  dev.voltage = o.voltage === undefined ? 230 : o.voltage;
  dev.setFeed(o.events);
  const changes = [];
  const roleOf = (key) => {
    let m = {}; try { m = JSON.parse(dev.kvs.get('uc_vc') || '{}'); } catch (e) { m = {}; }
    for (const r of Object.keys(m)) if (m[r] === key) return r;
    const c = dev.comps.get(key);
    const names = { Phase: 'phase', Cycle: 'cycle', Status: 'status', Warning: 'warning', 'Next pump-out': 'next_pumpout', Batches: 'batches', Chemical: 'chemical', Sludge: 'sludge' };
    return c && names[c.config.name] ? names[c.config.name] : null;
  };
  dev.onValue = (key, value, t) => changes.push({ t, role: roleOf(key), value });
  const sid = dev.addScript('uponor_clean_v3', code);
  const r = dev.startScript(sid);
  if (r.err) throw new Error('start failed: ' + r.msg);
  const ctl = [];
  const bootMs = o.shellyBootMs || 3000;
  for (const c of o.shellyCuts || []) { ctl.push({ at: c.off, kind: 'off' }); ctl.push({ at: c.on, kind: 'on' }); }
  for (const x of o.swReboots || []) ctl.push({ at: x.at, kind: 'reboot', x });
  for (const x of o.scriptStops || []) ctl.push({ at: x.at, kind: 'stop', x });
  for (const t of o.scriptRestarts || []) ctl.push({ at: t, kind: 'stop', x: { durMs: 2000 } });
  for (const t of o.dataGapEnds || []) ctl.push({ at: t, kind: 'gap' });
  for (const u of o.userSets || []) ctl.push({ at: u.at, kind: 'set', u });
  const sampleMs = o.sampleMs || 60000;
  for (let t = o.t0 + sampleMs; t < o.t1; t += sampleMs) ctl.push({ at: t, kind: 'sample' });
  ctl.sort((a, b) => a.at - b.at || (a.kind === 'sample') - (b.kind === 'sample'));
  const states = [];
  const offWindows = [];
  let powered = true;
  for (const c of ctl) {
    if (c.at > dev.t) dev.run(c.at - dev.t);
    if (c.kind === 'off') { dev.powerOff(); powered = false; offWindows.push([dev.t, null]); }
    else if (c.kind === 'on') { dev.powerOn(bootMs, 1); powered = true; offWindows[offWindows.length - 1][1] = dev.t; }
    else if (c.kind === 'reboot') { const t0 = dev.t; dev.powerOff(); dev.run(c.x.offMs || 8000); dev.powerOn(bootMs, c.x.rr === undefined ? 3 : c.x.rr); offWindows.push([t0, dev.t]); }
    else if (c.kind === 'stop') { const t0 = dev.t; dev.stopScript(sid); dev.run(c.x.durMs); dev.startScript(sid); offWindows.push([t0, dev.t]); }
    // readings missing from the recording: the script restarts without a stored phase (as test/v3run.js)
    else if (c.kind === 'gap') { dev.stopScript(sid); dev.kvs.delete('uc_cycle'); dev.startScript(sid); offWindows.push([dev.t, dev.t]); }
    else if (c.kind === 'set') {
      const key = JSON.parse(dev.kvs.get('uc_vc'))[c.u.role];
      const res = dev.externalSet(key, c.u.value);
      if (res.err) throw new Error('user set failed: ' + res.msg);
    } else if (c.kind === 'sample' && powered) {
      const res = dev.httpGet(`/script/${sid}/state`);
      if (res.code === 200 && res.sent) states.push({ t: dev.t, s: JSON.parse(res.body) });
    }
  }
  if (o.t1 > dev.t) dev.run(o.t1 - dev.t);
  const uncaught = dev.logs.filter((l) => /UNCAUGHT/.test(l.s));
  return { dev, sid, changes, states, offWindows, events: dev.eventLog.filter((e) => e.name === 'uponor').map((e) => Object.assign({ t: e.t }, e.data)),
    logs: dev.logs, kvs: dev.kvs, uncaught };
}

function timeline(changes, role) { return changes.filter((c) => c.role === role).map((c) => ({ t: c.t, v: c.value })); }
function cursor(tl) { let i = -1; return (t) => { while (i + 1 < tl.length && tl[i + 1].t <= t) i++; return i >= 0 ? tl[i].v : undefined; }; }

// evaluate a run against the simulator truth from tBack (power back / restart) on
function evaluate(sim, run, tBack, tEval1, opts) {
  opts = opts || {};
  const ph = cursor(timeline(run.changes, 'phase')), cy = cursor(timeline(run.changes, 'cycle'));
  const gt = sim.gt;
  let gi = -1;
  const SKIP = ['off', 'boot', 'paused', 'test_comp'];
  let n = 0, ok = 0, unk = 0, wrong = 0, recov = null;
  let unkRun = 0, maxUnkRun = 0;
  const wrongKinds = new Map();
  const marks = [];   // [t, 1 match / 0 mismatch]
  for (let t = Math.floor(tBack / 1000) * 1000; t < tEval1; t += 1000) {
    while (gi + 1 < gt.length && gt[gi + 1].t <= t) gi++;
    if (gi < 0) continue;
    const G = gt[gi];
    if (SKIP.includes(G.ph)) { continue; }
    const sp = ph(t), sc = cy(t);
    if (sp === 'unknown') { unkRun++; maxUnkRun = Math.max(maxUnkRun, unkRun); } else unkRun = 0;
    if (t - G.t < 8000) continue;
    n++;
    const match = sp === G.ph && sc === G.cyc;
    marks.push([t, match ? 1 : 0]);
    if (match) ok++;
    else {
      if (sp === 'unknown') unk++; else { wrong++; const k = `${G.cyc}/${G.ph}->${sc}/${sp}`; wrongKinds.set(k, (wrongKinds.get(k) || 0) + 1); }
    }
  }
  // recovery: first matching second after which the next 600 evaluated seconds have at most 20 mismatches
  let bad = 0, j = 0;
  for (let i = 0; i < marks.length; i++) {
    while (j < marks.length && j - i < 600) { bad += 1 - marks[j][1]; j++; }
    if (j - i >= 600 && marks[i][1] === 1 && bad <= 20) { recov = marks[i][0]; break; }
    bad -= 1 - marks[i][1];
  }
  if (recov === null && marks.length < 600 && marks.length && marks.every((m) => m[1])) recov = marks[0][0];
  // batches and doses over the whole run
  const bSim = sim.marks.filter((m) => /batch \+1/.test(m.s)).map((m) => m.t);
  const bScr = run.events.filter((e) => e.type === 'batch' && !e.user);
  const bScrT = bScr.map((e) => (e.ts !== null && e.ts !== undefined ? e.ts * 1000 : e.t));
  const missB = bSim.filter((t) => !bScrT.some((x) => Math.abs(x - t) <= 60e3));
  const extraB = bScrT.filter((x) => !bSim.some((t) => Math.abs(x - t) <= 60e3));
  const nullTsB = bScr.filter((e) => e.ts === null || e.ts === undefined).length;
  const dSim = sim.doses.filter((t) => t >= (opts.dosesFrom || 0));
  const dScr = run.events.filter((e) => e.type === 'chemical' && !e.user && e.t >= (opts.dosesFrom || 0)).map((e) => e.t);
  const missD = dSim.filter((t) => !dScr.some((x) => x >= t && x - t <= 90e3));
  const extraD = dScr.filter((x) => !dSim.some((t) => x >= t && x - t <= 90e3));
  // warnings after tBack - 30 s
  const wEv = run.events.filter((e) => e.type === 'warning' && e.t >= tBack - 30e3);
  const wOn = {};
  for (const e of wEv) if (e.on) { const off = wEv.find((x) => x.key === e.key && !x.on && x.t >= e.t); (wOn[e.key] = wOn[e.key] || []).push(Math.round(((off ? off.t : tEval1) - e.t) / 1000)); }
  // eta: state samples after tBack whose truth is a cleaning cycle before its pump-out
  const outs = sim.marks.filter((m) => m.s === 'pump-out').map((m) => m.t + 1000);
  let etaNullS = 0, etaMaxErr = 0, etaMaxErrAfterRecov = 0, etaWrongNonClean = 0;
  for (const x of run.states) {
    if (x.t < tBack || x.t >= tEval1) continue;
    let gj = -1; for (let j = 0; j < gt.length && gt[j].t <= x.t; j++) gj = j;
    const G = gt[gj];
    const nxt = outs.find((o) => o > x.t);
    if (G && G.cyc === 'cleaning' && nxt && G.ph !== 'pump_out' && G.ph !== 'pump_in' && nxt - x.t < 3 * 3600e3) {
      if (x.s.eta === null) etaNullS += 60;
      else { const e = Math.abs(x.s.eta - nxt / 1000); etaMaxErr = Math.max(etaMaxErr, e); if (recov !== null && x.t >= recov) etaMaxErrAfterRecov = Math.max(etaMaxErrAfterRecov, e); }
    } else if (x.s.eta !== null && G && G.cyc !== 'cleaning') etaWrongNonClean++;
  }
  return { n, pct: n ? (100 * ok) / n : 100, unk, wrong, wrongKinds: [...wrongKinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    recovS: recov === null ? null : Math.round((recov - tBack) / 1000), maxUnkRunS: maxUnkRun,
    bSim: bSim.length, bScr: bScr.length, missB: missB.length, extraB: extraB.length, nullTsB, missBt: missB, extraBt: extraB,
    dSim: dSim.length, dScr: dScr.length, missD: missD.length, extraD: extraD.length,
    warnings: wOn, etaNullS, etaMaxErr: Math.round(etaMaxErr), etaMaxErrAfterRecov: Math.round(etaMaxErrAfterRecov), etaWrongNonClean,
    uncaught: run.uncaught.length };
}

// ---------------------------------------------------------------- base firmware traces
const T0 = Date.parse('2026-11-01T00:00:00Z');
const H = 3600e3;
const KVS = { uc_batch: JSON.stringify({ n: 100, ts: Date.parse('2026-10-31T20:00:00Z') / 1000 }) };

// cleaning: power-up at T0, the first post-cleaning pump-in trips after 300 s (second cleaning), then waiting
// waiting: no trips for the first 4 pump-ins (waiting loops), trip at pump-in 5
// holiday: starts in the holiday cycle, trip at the 4th holiday pump-in
const BASES = {
  cleaning: { startCycle: 'cleaning', powerUp: true, tripAt: (c, n) => (n === 1 ? 300 : null) },
  waiting: { startCycle: 'cleaning', powerUp: true, tripAt: (c, n) => (n === 5 ? 200 : null) },
  holiday: { startCycle: 'holiday', powerUp: false, tripAt: (c, n) => (n === 4 ? 200 : null) },
};

function simFor(base, extra, durS) {
  return F.simulate(Object.assign({ t0: T0, seed: 11, durationS: durS }, BASES[base], extra || {}));
}

function runOpts(base, sim, extra) {
  const B = BASES[base];
  return Object.assign({ events: sim.events, t0: B.powerUp ? T0 - 2000 : T0 - 60e3, t1: sim.tEnd, kvs: KVS,
    uptimeAtStartS: B.powerUp ? 1 : 86400, resetReason: B.powerUp ? 1 : 3,
    userSets: [{ at: T0 + 120e3, role: 'chemical', value: 20 }] }, extra || {});
}

module.exports = { ExtDevice, runExt, evaluate, timeline, cursor, F, REPO, V3_PATH, T0, H, KVS, BASES, simFor, runOpts };
