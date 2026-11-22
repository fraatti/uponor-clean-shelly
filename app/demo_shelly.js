// Demo Shelly for the online demo of the browser app (demo/index.html, built by app/tools/build_demo.js).
// Answers the app's WebSocket RPC for the host "demo" from a recording of a real plant (window.UC_DEMO,
// demo/data.js): the power and voltage, the power history (EM1Data) and the v3 script's state and events.
// The recording is moved by whole days so that it runs in real time with the clock of today; with at
// least a day of it still ahead and a week behind. Entering the chemical and the sludge counter works
// in the page only. build_demo.js lets the host "demo" through the app's https check.
(() => {
  'use strict';
  const D = window.UC_DEMO;
  for (const id of ['uc-demo-data', 'uc-demo']) { const e = document.getElementById(id); if (e) e.remove(); }
  if (!D) return;
  const HOST = 'demo', DEV_ID = 'shellyemminig4-demo', SID = 1, DAY = 864e5;
  window.__ucDemoHost = HOST;
  // the app reads the host from the address
  const q = new URLSearchParams(location.search);
  if (!q.get('host')) { q.set('host', HOST); history.replaceState(null, '', location.pathname + '?' + q + location.hash); }

  // ---------------------------------------------------------------- the recording
  const T0 = D.t0 * 1000, T1 = D.t1 * 1000;
  const pt = [], pv = [];
  { let t = D.t0; for (let i = 0; i < D.p.length; i += 2) { t += D.p[i]; pt.push(t * 1000); pv.push(D.p[i + 1] / 10); } }
  const cum = new Float64Array(pt.length);
  for (let i = 1; i < pt.length; i++) cum[i] = cum[i - 1] + pv[i - 1] * (pt[i] - pt[i - 1]) / 3600e3;
  const sts = [];
  { let t = D.t0, cur = {}; for (let i = 0; i < D.st.length; i += 2) { t += D.st[i]; cur = Object.assign({}, cur, D.st[i + 1]); sts.push([t * 1000, cur]); } }
  const evs = [];
  { let t = D.t0; for (let i = 0; i < D.ev.length; i += 2) { t += D.ev[i]; evs.push([t * 1000, D.ev[i + 1]]); } }
  // last index with a[i] <= t (-1 before the first)
  const at = (a, t, key) => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if ((key ? a[m][0] : a[m]) <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

  // real time = recording time + SHIFT (whole days, so the clock times are the recorded ones)
  const SHIFT = Math.ceil((Date.now() - (T1 - DAY)) / DAY) * DAY;
  const rec = (real) => Math.min((real === undefined ? Date.now() : real) - SHIFT, T1);
  // history the app stored in this browser on another day belongs to another part of the recording
  try {
    if (localStorage.getItem('uc_demo_shift') !== String(SHIFT)) { localStorage.removeItem('uc_app_hist:' + HOST); localStorage.setItem('uc_demo_shift', String(SHIFT)); }
  } catch (e) { /* private window */ }

  const powerAt = (t) => { const i = at(pt, t); return i < 0 ? pv[0] : pv[i]; };
  const energyAt = (t) => { const i = at(pt, t); return i < 0 ? 0 : cum[i] + pv[i] * (t - pt[i]) / 3600e3; };
  const voltAt = (t) => D.u[Math.max(0, Math.min(D.u.length - 1, Math.floor((t - T0) / (D.uStep * 1000))))] / 10;
  const TIMES = ['since', 'eta', 'last_pumpout', 'holiday_at', 'holiday_since', 'ts', 'reset'];
  const shiftTimes = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) shiftTimes(v);
      else if (TIMES.includes(k) && typeof v === 'number' && v > 1e9) o[k] = v + SHIFT / 1000;
    }
    return o;
  };

  // entered values: the shown counter is the entered value plus the recorded change since
  const over = {};
  const recState = (t) => { const i = at(sts, t, true); return JSON.parse(JSON.stringify(i < 0 ? { cycle: 'unknown', phase: 'unknown', warnings: [] } : sts[i][1])); };
  function adjust(s) {
    const o = over;
    if (o.chemical && s.chemical && typeof s.chemical.l === 'number') {
      const l = Math.max(0, Math.round((o.chemical.v + s.chemical.l - o.chemical.base) * 100) / 100);
      if (typeof s.chemical.days === 'number' && s.chemical.l > 0) s.chemical.days = Math.round(s.chemical.days * l / s.chemical.l * 10) / 10;
      s.chemical.l = l;
    }
    if (o.sludge && s.sludge && typeof s.sludge.n === 'number') { s.sludge.n = Math.max(0, o.sludge.v + s.sludge.n - o.sludge.base); if (o.sludge.reset) s.sludge.reset = o.sludge.reset; }
    if (o.batches && typeof s.batches === 'number') s.batches = Math.max(0, o.batches.v + s.batches - o.batches.base);
    return s;
  }
  function stateNow() {
    const t = rec(), s = adjust(recState(t));
    s.power = powerAt(t); s.band = null; s.time_synced = true; s.uptime = Math.floor((t - T0) / 1000) + 86400;
    return shiftTimes(s);
  }
  function eventData(d) {
    const e = JSON.parse(JSON.stringify(d));
    if (e.type === 'chemical') { const s = adjust({ chemical: { l: e.l, days: e.days } }); e.l = s.chemical.l; e.days = s.chemical.days; }
    if (e.type === 'sludge') { const s = adjust({ sludge: { n: e.n, reset: e.reset } }); e.n = s.sludge.n; e.reset = s.sludge.reset; }
    if (e.type === 'batch' && typeof e.n === 'number') e.n = adjust({ batches: e.n }).batches;
    return shiftTimes(e);
  }

  // ---------------------------------------------------------------- RPC
  const EQ = 0.2072;   // the minute energy of the device comes in steps of 0.2072 Wh
  const KEYS = ['total_act_energy', 'total_act_ret_energy', 'lag_react_energy', 'lead_react_energy', 'max_act_power', 'min_act_power',
    'max_aprt_power', 'min_aprt_power', 'max_voltage', 'min_voltage', 'avg_voltage', 'max_current', 'min_current', 'avg_current'];
  function record(ts) {
    const a = ts * 1000 - SHIFT, b = a + 60e3;
    const wh = (Math.floor(energyAt(b) / EQ) - Math.floor(energyAt(a) / EQ)) * EQ;
    let i = at(pt, a), p = i < 0 ? pv[0] : pv[i], mn = p, mx = p; i++;
    while (i < pt.length && pt[i] < b) { p = pv[i]; mn = Math.min(mn, p); mx = Math.max(mx, p); i++; }
    const u = voltAt(a), r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10;
    return [r4(wh), 0, 0, 0, r1(mx), r1(mn), r1(mx * 1.08), r1(mn * 1.08), r1(u + 0.4), r1(u - 0.3), u, r4(mx / u), r4(mn / u), r4(wh * 60 / u)];
  }
  const firstTs = () => Math.ceil((T0 + SHIFT) / 60e3) * 60;
  const lastTs = () => Math.floor(Math.min(Date.now(), T1 + SHIFT) / 60e3) * 60 - 60;
  const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
  function call(method, p) {
    const t = rec();
    switch (method) {
      case 'Shelly.GetDeviceInfo':
        return { name: null, id: DEV_ID, model: 'S4EM-001PXCEU16', gen: 4, fw_id: 'demo/2.2.0', ver: '2.2.0', app: 'MiniEMG4', auth_en: false, auth_domain: null };
      case 'Sys.GetStatus':
        return { unixtime: Math.floor(Date.now() / 1000), uptime: Math.floor((t - T0) / 1000) + 86400, reset_reason: 3, fs_size: 786432, fs_free: 106496 };
      case 'Script.List':
        return { scripts: [{ id: SID, name: 'uponor-clean-v3', enable: true, running: true }] };
      case 'Script.GetStatus':
        return { id: SID, running: true, mem_used: 16400, mem_peak: 20000, mem_free: 6700 };
      case 'Script.Eval':
        if (p.id !== SID || !/stateObject\(\)/.test(p.code || '')) throw err(-103, 'the demo answers only JSON.stringify(stateObject())');
        return { result: JSON.stringify(stateNow()) };
      case 'EM1.GetStatus': {
        const w = powerAt(t), u = voltAt(t);
        return { id: 0, current: Math.round(w / u * 1000) / 1000, voltage: u, act_power: w, aprt_power: Math.round(w * 1.08 * 10) / 10, pf: 0.92, freq: 50, calibration: 'factory' };
      }
      case 'EM1Data.GetStatus':
        return { id: 0, total_act_energy: Math.round((136000 + energyAt(t)) * 100) / 100, total_act_ret_energy: 0 };
      case 'EM1Data.GetRecords':
        return { data_blocks: [{ ts: firstTs(), period: 60, records: (lastTs() - firstTs()) / 60 + 1 }] };
      case 'EM1Data.GetData': {
        const first = firstTs(), last = lastTs();
        let ts = Math.max(first, Math.ceil((p.ts || first) / 60) * 60);
        const end = Math.min(last, p.end_ts || last), t0 = ts, values = [];
        while (ts <= end && values.length < 31) { values.push(record(ts)); ts += 60; }
        const out = { keys: KEYS, data: values.length ? [{ ts: t0, period: 60, values }] : [] };
        if (ts <= end) out.next_record_ts = ts;
        return out;
      }
      case 'KVS.Get':
        if (p.key === 'uc_vc') return { etag: 'demo', value: JSON.stringify(D.vc) };
        if (p.key === 'uc_cfg' && D.cfg) return { etag: 'demo', value: JSON.stringify(D.cfg) };
        throw err(-105, 'Argument key, value ' + p.key + ' not found!');
      case 'Number.Set': {
        const role = Object.keys(D.vc).find((r) => D.vc[r] === 'number:' + p.id);
        const v = Number(p.value);
        if (!['chemical', 'sludge', 'batches'].includes(role) || !isFinite(v) || v < 0) throw err(-103, 'Argument value out of range');
        const s = recState(t);
        if (role === 'chemical') { over.chemical = { v: Math.min(v, 30), base: s.chemical ? s.chemical.l || 0 : 0 }; notifyEvent(Object.assign({ v: 1, type: 'chemical', user: true }, adjust(recState(t)).chemical), true); }
        if (role === 'sludge') { over.sludge = { v: Math.round(v), base: s.sludge ? s.sludge.n || 0 : 0, reset: Math.round(v) === 0 ? Math.floor(t / 1000) : (over.sludge && over.sludge.reset) }; notifyEvent(Object.assign({ v: 1, type: 'sludge', user: true }, adjust(recState(t)).sludge), true); }
        if (role === 'batches') { over.batches = { v: Math.round(v), base: s.batches || 0 }; notifyEvent({ v: 1, type: 'batch', user: true, n: Math.round(v) }, true); }
        return null;
      }
      default: throw err(404, 'No handler for ' + method);
    }
  }

  // ---------------------------------------------------------------- WebSocket
  const socks = new Set();
  const RealWS = window.WebSocket;
  class DemoWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.src = null;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; socks.add(this); if (this.onopen) this.onopen({}); }, 80);
    }
    send(text) {
      if (this.readyState !== 1) return;
      let m; try { m = JSON.parse(text); } catch (e) { return; }
      if (m.src) this.src = m.src;
      let out; try { out = { result: call(m.method, m.params || {}) }; } catch (e) { out = { error: { code: e.code || -1, message: String(e.message || e) } }; }
      this.deliver(Object.assign({ id: m.id, src: DEV_ID, dst: m.src }, out), 2 + Math.random() * 6);
    }
    deliver(o, ms) { setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(o) }); }, ms || 0); }
    close() { if (this.readyState >= 2) return; this.readyState = 3; socks.delete(this); setTimeout(() => { if (this.onclose) this.onclose({}); }, 0); }
  }
  window.WebSocket = function WebSocket(url, protocols) {
    return /^wss?:\/\/demo(:\d+)?\/rpc$/.test(String(url)) ? new DemoWS(url) : new RealWS(url, protocols);
  };
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = RealWS[k];
  window.WebSocket.prototype = RealWS.prototype;

  function notify(method, params) { for (const s of socks) if (s.src) s.deliver({ src: DEV_ID, dst: s.src, method, params }); }
  function notifyEvent(data, user) {
    const now = Date.now() / 1000;
    notify('NotifyEvent', { ts: now, events: [{ component: 'script:' + SID, id: SID, event: 'uponor', data: user ? shiftTimes(data) : eventData(data), ts: now }] });
  }
  // every second: the recorded events and power changes up to now
  let lastT = rec(), lastP = null;
  setInterval(() => {
    if (Date.now() - SHIFT > T1) { location.reload(); return; }   // the end of the recording (after a day or more)
    const t = rec();
    for (let i = at(evs, lastT, true) + 1; i < evs.length && evs[i][0] <= t; i++) notifyEvent(evs[i][1]);
    const p = powerAt(t);
    if (p !== lastP) notify('NotifyStatus', { ts: Date.now() / 1000, 'em1:0': { id: 0, act_power: p, voltage: voltAt(t) } });
    lastP = p; lastT = t;
  }, 1000);

  // ---------------------------------------------------------------- the note on the page
  const NOTE = {
    fi: { t: 'Demo', b: 'Oikean Uponor Clean I -puhdistamon tallennettu data ({m}) ilman Shellyä. Ajat on siirretty tähän päivään, ja tiedot etenevät reaaliajassa. Oikeassa käytössä Shelly jakaa sovelluksen itse kotiverkossa.', a: 'Ohjeet ja lähdekoodi' },
    en: { t: 'Demo', b: 'Recorded data of a real Uponor Clean I ({m}), no Shelly needed. The times are moved to today, and the data runs in real time. In real use the Shelly serves the app itself in the home network.', a: 'Guides and source code' },
  };
  const css = document.createElement('style');
  css.textContent = '.demo-note { margin: -4px 0 14px; padding: 8px 12px; border-radius: 10px; background: var(--soft); border: 1px solid var(--line); color: var(--muted); font-size: 13px; line-height: 1.45; }'
    + ' .demo-note b { color: var(--fg); font-weight: 600; margin-right: 6px; } .demo-note a { color: var(--accent); white-space: nowrap; } #d-inst { display: none; }';
  document.head.appendChild(css);
  function note() {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'fi', N = NOTE[lang];
    const m = new Date(T0).toLocaleDateString(lang === 'fi' ? 'fi-FI' : 'en-GB', { month: 'long', year: 'numeric' });
    let el = document.getElementById('demo-note');
    if (!el) {
      const head = document.querySelector('.wrap > header'); if (!head) return;
      el = document.createElement('div'); el.className = 'demo-note'; el.id = 'demo-note'; head.after(el);
    }
    el.innerHTML = '<b>' + N.t + '</b>' + N.b.replace('{m}', m) + ' <a href="https://github.com/fraatti/uponor-clean-shelly" target="_blank" rel="noopener">' + N.a + ' ›</a>';
  }
  document.addEventListener('DOMContentLoaded', () => {
    note();
    new MutationObserver(note).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  });
})();
