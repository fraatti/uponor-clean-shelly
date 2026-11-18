// Test harness: runs the real Shelly script file in Node with mocked Shelly APIs and a virtual clock.
// Usage (module): const { runScript, loadCsv, seriesFromCsv } = require('./harness');
'use strict';
const fs = require('fs');
const vm = require('vm');

process.env.TZ = 'Europe/Helsinki';

const KEYS = { U: 'Unknown', F: 'Filling', A: 'Aeration', C: 'Dosing', S: 'Settling', R: 'Sludge', D: 'Discharge', W: 'Waiting' };

function loadCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n');
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]; if (!L) continue;
    const a = L.indexOf(','), b = L.lastIndexOf(',');
    if (a < 0 || b <= a) continue;
    const id = L.slice(0, a), v = L.slice(a + 1, b), t = Date.parse(L.slice(b + 1));
    if (isNaN(t)) continue;
    (out[id] || (out[id] = [])).push({ t, v });
  }
  for (const k in out) out[k].sort((x, y) => x.t - y.t);
  return out;
}

// Build the power feed for the script: raw power + voltage when present, otherwise normalized power (voltage absent).
function feedFromCsv(csv, mode) {
  const P = csv['sensor.uponor_clean_1_power'], V = csv['sensor.shellyemminig4_000000000000_voltage'];
  const N = csv['sensor.uponor_clean_1_vc_normalized_consumption'];
  const ev = [];
  const useRaw = mode === 'raw' || (mode !== 'norm' && P && P.length > 100);
  const src = useRaw ? P : N;
  if (!src) throw new Error('no power series');
  for (const r of src) { const x = parseFloat(r.v); if (!isNaN(x)) ev.push({ t: r.t, p: x }); }
  if (useRaw && V) {
    // Skip hourly statistic rows (long-term stats at :00:00.000 with many decimals)
    for (const r of V) { const x = parseFloat(r.v); if (!isNaN(x) && !(r.v.length > 9 && r.t % 3600000 === 0)) ev.push({ t: r.t, u: x }); }
  }
  ev.sort((a, b) => a.t - b.t);
  return { events: ev, raw: useRaw };
}

function deviceSeries(csv) {
  const S = (csv['select.uponor_clean_1_vc_cycle_status'] || []).map((r) => ({ t: r.t, v: r.v }));
  const M = (csv['text.storage_room_uponor_clean_1_process_message'] || []).map((r) => ({ t: r.t, v: r.v }));
  const B = (csv['sensor.uponor_clean_1_vc_batch_counter'] || []).map((r) => ({ t: r.t, v: r.v }));
  return { status: S, message: M, batch: B };
}

/* opts: { scriptPath | code, events, t0, t1, configPatch (string of JS run after CONFIG init), enumOptions, kvs, reboots: [ms...],
            pump: power events feed, quiet } */
function runScript(opts) {
  const code0 = opts.code || fs.readFileSync(opts.scriptPath, 'utf8');
  const code = opts.patch ? opts.patch(code0) : code0;
  const ev = opts.events;
  const t0 = opts.t0 != null ? opts.t0 : ev[0].t;
  const t1 = opts.t1 != null ? opts.t1 : ev[ev.length - 1].t + 1000;
  const kvs = Object.assign({}, opts.kvs || { puhdistamo_batch_count: '0', puhdistamo_process_message: '"-"' });
  const vc = { 'number:200': { value: 0 }, 'text:200': { value: '-' }, 'enum:200': { value: 'U' }, 'number:201': { value: 0 } };
  const enumOptions = opts.enumOptions || ['U', 'F', 'A', 'C', 'S', 'R', 'D'];
  const log = { status: [], msg: [], batch: [], prints: [], calls: 0, maxQueue: 0 };
  const reboots = (opts.reboots || []).slice().sort((a, b) => a - b);
  const em = { act_power: null, voltage: opts.noVoltage ? undefined : null };

  let now = t0, bootAt = t0;
  let ctx, timers, nextTimerId, handlers;
  let ei = 0;
  // apply events before t0
  while (ei < ev.length && ev[ei].t <= t0) { if (ev[ei].p != null) em.act_power = ev[ei].p; if (ev[ei].u != null) em.voltage = ev[ei].u; ei++; }

  function boot() {
    timers = []; nextTimerId = 1; handlers = [];
    bootAt = now;
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(now); }
      static now() { return now; }
    }
    const Shelly = {
      call(method, params, cb) {
        log.calls++;
        const m = method.toLowerCase();
        let res = null, err = 0, msg = '';
        if (m === 'kvs.get') { if (kvs[params.key] !== undefined) res = { value: kvs[params.key] }; else { err = -105; msg = 'not found'; } }
        else if (m === 'kvs.set') { kvs[params.key] = params.value; res = { rev: 1 }; }
        else if (m === 'number.set') { vc['number:' + params.id] = { value: params.value }; if (params.id === 200) log.batch.push({ t: now, v: params.value }); res = {}; }
        else if (m === 'text.set') { const last = log.msg[log.msg.length - 1]; vc['text:' + params.id] = { value: params.value }; if (!last || last.v !== params.value) log.msg.push({ t: now, v: params.value }); res = {}; }
        else if (m === 'enum.set') {
          if (enumOptions.indexOf(params.value) < 0) { err = -103; msg = 'invalid option'; }
          else { const last = log.status[log.status.length - 1]; vc['enum:' + params.id] = { value: params.value }; if (!last || last.v !== params.value) log.status.push({ t: now, v: params.value }); res = {}; }
        }
        else if (m === 'boolean.set') { vc['boolean:' + params.id] = { value: params.value }; res = {}; }
        else if (m === 'enum.getconfig') { res = { id: params.id, options: enumOptions.slice(), meta: { ui: { titles: {} } } }; }
        else if (m === 'shelly.getstatus') { res = { sys: { uptime: Math.floor((now - bootAt) / 1000) } }; }
        else { err = -114; msg = 'unsupported ' + method; }
        if (cb) addTimer(15, false, () => cb(res, err, msg));
      },
      getComponentStatus(key) {
        if (key === 'em1:0') return { act_power: em.act_power, voltage: em.voltage };
        if (key === 'pm1:0' || key === 'switch:0') return null;
        return vc[key] || null;
      },
      getComponentConfig() { return null; },
      addStatusHandler(fn) { handlers.push(fn); return handlers.length; },
      addEventHandler() { return 0; },
      getUptimeMs() { return now - bootAt; },
      emitEvent() {},
    };
    function addTimer(ms, rep, cb) { const id = nextTimerId++; timers.push({ id, at: now + ms, every: rep ? ms : 0, cb }); return id; }
    const Timer = { set: addTimer, clear(id) { timers = timers.filter((x) => x.id !== id); return true; } };
    const print = (...a) => { const s = a.join(' '); if (!opts.quiet) log.prints.push({ t: now, s }); };
    ctx = vm.createContext({ Shelly, Timer, print, JSON, Math, Date: FakeDate, console });
    vm.runInContext(code, ctx, { filename: 'script.js' });
  }

  boot();
  let ri = 0;
  while (now < t1) {
    // next data event / timer / reboot
    let nt = Infinity, tIdx = -1;
    for (let i = 0; i < timers.length; i++) if (timers[i].at < nt) { nt = timers[i].at; tIdx = i; }
    const nd = ei < ev.length ? ev[ei].t : Infinity;
    const nr = ri < reboots.length ? reboots[ri] : Infinity;
    const next = Math.min(nt, nd, nr);
    if (next === Infinity || next > t1) break;
    now = next;
    if (nr === next) { ri++; boot(); continue; }
    if (nd === next) {
      const e = ev[ei++]; const delta = {};
      if (e.p != null) { em.act_power = e.p; delta.act_power = e.p; }
      if (e.u != null) { em.voltage = e.u; delta.voltage = e.u; }
      for (const h of handlers) h({ component: 'em1:0', delta });
      continue;
    }
    const tm = timers[tIdx];
    if (tm.every) tm.at += tm.every; else timers.splice(tIdx, 1);
    tm.cb();
  }
  log.kvs = kvs; log.vc = vc;
  return log;
}

function segments(series, tEnd) {
  const out = [];
  for (const r of series) { const last = out[out.length - 1]; if (last && last.v === r.v) continue; if (last) last.t1 = r.t; out.push({ v: r.v, t0: r.t, t1: tEnd }); }
  return out;
}

module.exports = { loadCsv, feedFromCsv, deviceSeries, runScript, segments, KEYS };
