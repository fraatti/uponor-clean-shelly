// Runs the v3 script on the device mock with a power feed, and measures its output against
// a firmware simulation (ground truth) or against another run.
'use strict';
const fs = require('fs');
const path = require('path');
const { Device, languageCheck } = require('./shelly_device_mock');

const V3_PATH = process.env.V3_FILE ? path.resolve(process.env.V3_FILE) : path.join(__dirname, '..', 'shelly', 'v3', 'uponor_clean_v3.js');

/* o = {
     code, events: [{t, p?, u?}], t0 (script start, ms), t1 (end, ms),
     kvs: {key: string}, uptimeAtStartS (default 1 day), resetReason,
     shellyCuts: [{off, on}] (the Shelly loses power with the plant), swReboots: [ms],
     userSets: [{at, role, value}], sampleMs (state endpoint sampling, default 60 s), verbose
   } */
function runV3(o) {
  const code = o.code || fs.readFileSync(V3_PATH, 'utf8');
  const dev = new Device({ startMs: o.t0, resetReason: o.resetReason, tzOffsetMin: o.tzOffsetMin });
  dev.verbose = !!o.verbose;
  dev.bootT = o.t0 - (o.uptimeAtStartS === undefined ? 86400 : o.uptimeAtStartS) * 1000;
  for (const k of Object.keys(o.kvs || {})) dev.kvs.set(k, o.kvs[k]);
  dev.voltage = o.voltage === undefined ? 230 : o.voltage;
  dev.setFeed(o.events);
  const changes = [];
  // components are created by the script (Virtual.Add) and listed in KVS uc_vc
  const roleOf = (key) => {
    const c = dev.comps.get(key); if (c && c.role) return c.role;
    let m = {}; try { m = JSON.parse(dev.kvs.get('uc_vc') || '{}'); } catch (e) { m = {}; }
    for (const r of Object.keys(m)) if (m[r] === key) return r;
    // created but not yet stored: the script names the components
    const names = { Phase: 'phase', Cycle: 'cycle', Status: 'status', Warning: 'warning', 'Next pump-out': 'next_pumpout', Batches: 'batches', Chemical: 'chemical', Sludge: 'sludge' };
    return c && names[c.config.name] ? names[c.config.name] : null;
  };
  dev.onValue = (key, value, t) => changes.push({ t, role: roleOf(key), value });
  const sid = dev.addScript('uponor_clean_v3', code);
  const r = dev.startScript(sid);
  if (r.err) throw new Error('start failed: ' + r.msg);

  const ctl = [];
  for (const c of o.shellyCuts || []) { ctl.push({ at: c.off, kind: 'off' }); ctl.push({ at: c.on, kind: 'on' }); }
  for (const t of o.swReboots || []) ctl.push({ at: t, kind: 'reboot' });
  for (const t of o.scriptRestarts || []) ctl.push({ at: t, kind: 'restart' });
  for (const t of o.dataGapEnds || []) ctl.push({ at: t, kind: 'gap' });
  for (const u of o.userSets || []) ctl.push({ at: u.at, kind: 'set', u });
  const sampleMs = o.sampleMs || 60000;
  for (let t = o.t0 + sampleMs; t < o.t1; t += sampleMs) ctl.push({ at: t, kind: 'sample' });
  ctl.sort((a, b) => a.at - b.at || (a.kind === 'sample') - (b.kind === 'sample'));

  const states = [];
  let powered = true;
  for (const c of ctl) {
    if (c.at > dev.t) dev.run(c.at - dev.t);
    if (c.kind === 'off') { dev.powerOff(); powered = false; }
    else if (c.kind === 'on') { dev.powerOn(3000, 1); powered = true; }
    else if (c.kind === 'reboot') { dev.powerOff(); dev.run(8000); dev.powerOn(3000, 3); }
    else if (c.kind === 'restart') { dev.stopScript(sid); dev.run(2000); dev.startScript(sid); }
    // readings missing from the recording: the script restarts without a stored phase
    else if (c.kind === 'gap') { dev.stopScript(sid); dev.kvs.delete('uc_cycle'); dev.startScript(sid); }
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
  const s = dev.scripts.get(sid);
  const uncaught = dev.logs.filter((l) => /UNCAUGHT/.test(l.s));
  return { dev, sid, changes, states, events: dev.eventLog.filter((e) => e.name === 'uponor').map((e) => Object.assign({ t: e.t }, e.data)),
    logs: dev.logs, kvs: dev.kvs, uncaught, roles: JSON.parse(dev.kvs.get('uc_vc') || '{}') };
}

// value of a role at time t from the change log
function timeline(changes, role) {
  return changes.filter((c) => c.role === role).map((c) => ({ t: c.t, v: c.value }));
}

function valueAt(tl, t, idx) {
  // idx: {i} cursor for monotonic t
  while (idx.i + 1 < tl.length && tl[idx.i + 1].t <= t) idx.i++;
  return idx.i >= 0 && tl[idx.i].t <= t ? tl[idx.i].v : undefined;
}

/* Per-second comparison of the script's cycle/phase with the simulator ground truth.
   Seconds within `graceS` after a firmware phase change, and the off/boot/paused/test_comp
   periods, are left out. */
function phaseAccuracy(run, gt, from, to, graceS) {
  const g = graceS === undefined ? 8 : graceS;
  const ph = timeline(run.changes, 'phase'), cy = timeline(run.changes, 'cycle');
  const pi = { i: -1 }, ci = { i: -1 };
  let gi = -1, n = 0, ok = 0;
  const confusion = new Map();
  for (let t = from; t < to; t += 1000) {
    while (gi + 1 < gt.length && gt[gi + 1].t <= t) gi++;
    if (gi < 0) continue;
    const G = gt[gi];
    if (['off', 'boot', 'paused', 'test_comp'].includes(G.ph)) continue;
    if (t - G.t < g * 1000) continue;
    const sp = valueAt(ph, t, pi), sc = valueAt(cy, t, ci);
    n++;
    if (sp === G.ph && sc === G.cyc) ok++;
    else { const k = `${G.cyc}/${G.ph} -> ${sc}/${sp}`; confusion.set(k, (confusion.get(k) || 0) + 1); }
  }
  return { n, ok, pct: n ? (100 * ok) / n : 100, confusion: [...confusion.entries()].sort((a, b) => b[1] - a[1]) };
}

module.exports = { runV3, timeline, valueAt, phaseAccuracy, languageCheck, V3_PATH };
