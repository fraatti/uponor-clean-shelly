// Shelly WebSocket RPC mock for the browser app (app/uponor-clean-app.html).
// Runs the real v3 script on the device mock over a firmware simulation: first the last days at
// full speed, then in real time. Answers the RPC calls the app makes over ws://host:port/rpc and
// sends the script's "uponor" events as NotifyEvent. No dependencies.
//
// Usage: node shelly_ws_mock.js [--port 8098] [--days 7] [--seed 3] [--password secret] [--fs-free 190000]
//        then open app/uponor-clean-app.html?host=127.0.0.1:8098
//        (the mock also serves the app at http://127.0.0.1:8098/app)
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('./v3run');
const F = require('./fwsim');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 8098));
const DAYS = Number(arg('days', 7));
const SEED = Number(arg('seed', 3));
const PASSWORD = arg('password', null);
const FS_FREE0 = Number(arg('fs-free', 190000));   // free file system space before the extra scripts (bytes)
const REALM = 'shellyemminig4-mock';
const APP = path.join(__dirname, '..', 'app', 'uponor-clean-app.html');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const vm = require('vm');

// ---------------------------------------------------------------- plant and script
const NOW0 = Date.now();
const T0 = Math.floor((NOW0 - DAYS * 86400e3) / 60e3) * 60e3;
const sim = F.simulate({ t0: T0, seed: SEED, durationS: (DAYS + 3) * 86400, startCycle: 'cleaning',
  tripAt: (c, n) => ((n * 7919) % 11 < 4 ? 60 + ((n * 37) % 500) : null) });
const feed = sim.events.filter((e) => e.p != null);
const tStart = Date.now();
const run = R.runV3({ events: sim.events, t0: T0, t1: NOW0, uptimeAtStartS: 1, resetReason: 1, sampleMs: 3600e3,
  userSets: [{ at: T0 + 60e3, role: 'chemical', value: 12 }, { at: T0 + 120e3, role: 'sludge', value: 300 }, { at: T0 + 180e3, role: 'batches', value: 240 }] });
const dev = run.dev, sid = run.sid;
console.log(`simulated ${DAYS} d in ${((Date.now() - tStart) / 1000).toFixed(1)} s, ${run.events.length} events, script ${sid}`);
let evIdx = dev.eventLog.length;
const bootUnix = Math.floor(T0 / 1000);

// power at time t (ms): the feed is piecewise constant
function powerAt(t) {
  let lo = 0, hi = feed.length - 1;
  if (!feed.length || t < feed[0].t) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (feed[mid].t <= t) lo = mid; else hi = mid - 1; }
  return feed[lo].p;
}
// cumulative energy (Wh) at each feed change, for the energy of any minute
const cum = [0];
for (let i = 1; i < feed.length; i++) cum.push(cum[i - 1] + feed[i - 1].p * (feed[i].t - feed[i - 1].t) / 3600e3);
function idxAt(t) { let lo = 0, hi = feed.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (feed[mid].t <= t) lo = mid; else hi = mid - 1; } return lo; }
function energyAt(t) { if (!feed.length || t <= feed[0].t) return 0; const i = idxAt(t); return cum[i] + feed[i].p * (t - feed[i].t) / 3600e3; }
// like the device: the minute energy comes in steps of 0.2072 Wh
const EQ = 0.2072;
// one EM1Data record (60 s from ts, seconds): energy Wh, min and max power
function record(ts) {
  const a = ts * 1000, b = a + 60e3;
  const wh = (Math.floor(energyAt(b) / EQ) - Math.floor(energyAt(a) / EQ)) * EQ;
  let i = idxAt(a), p = feed[i] && feed[i].t <= a ? feed[i].p : 0, mn = p, mx = p; i++;
  while (i < feed.length && feed[i].t < b) { p = feed[i].p; mn = Math.min(mn, p); mx = Math.max(mx, p); i++; }
  const u = 230, r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10;
  return [r4(wh), 0, 0, 0, r1(mx), r1(mn), r1(mx * 1.08), r1(mn * 1.08), u + 0.4, u - 0.3, u, r4(mx / u), r4(mn / u), r4(wh * 60 / u)];
}
const KEYS = ['total_act_energy', 'total_act_ret_energy', 'lag_react_energy', 'lead_react_energy', 'max_act_power', 'min_act_power',
  'max_aprt_power', 'min_aprt_power', 'max_voltage', 'min_voltage', 'avg_voltage', 'max_current', 'min_current', 'avg_current'];
const lastRecordTs = () => Math.floor(dev.t / 60e3) * 60 - 60;   // last completed minute

// ---------------------------------------------------------------- RPC
let nonce = crypto.randomBytes(12).toString('base64');
const challenge = () => ({ code: 401, message: JSON.stringify({ auth_type: 'digest', nonce, realm: REALM, algorithm: 'SHA-256' }) });
function authOk(a) {
  if (!PASSWORD) return true;
  if (!a || a.username !== 'admin' || a.realm !== REALM || a.nonce !== nonce || a.algorithm !== 'SHA-256' || !/^[0-9a-f]{8}$/.test(String(a.nc))) return false;
  const ha1 = sha(`admin:${REALM}:${PASSWORD}`), ha2 = sha('dummy_method:dummy_uri');
  return a.response === sha(`${ha1}:${a.nonce}:${a.nc}:${a.cnonce}:auth:${ha2}`);
}
function call(method, p) {
  p = p || {};
  switch (method) {
    case 'Shelly.GetDeviceInfo':
      return { name: null, id: REALM, model: 'S4EM-001PXCEU16', gen: 4, fw_id: '20261109-150305/2.2.0-mock', ver: '2.2.0', app: 'MiniEMG4', auth_en: !!PASSWORD, auth_domain: PASSWORD ? REALM : null };
    case 'Sys.GetStatus':
      return { time: null, unixtime: Math.floor(dev.t / 1000), uptime: Math.floor(dev.t / 1000) - bootUnix, reset_reason: 1, fs_size: 786432, fs_free: fsFree() };
    case 'Script.List':
      return { scripts: [{ id: sid, name: 'uponor-clean-v3', enable: true, running: true }].concat([...extra.values()].map((x) => ({ id: x.id, name: x.name, enable: x.enable, running: x.running }))) };
    case 'Script.Create': { const id = nextId++; extra.set(id, { id, name: p.name, code: '', enable: false, running: false, ep: {} }); return { id }; }
    case 'Script.PutCode': { const x = script(p.id); if (!x) return {}; if (x.running) throw { code: -103, message: 'Script is running' };
      if ((p.code || '').length > 0 && fsFree() - (p.code || '').length < 0) throw { code: -103, message: 'No space left' }; x.code = (p.append ? x.code : '') + (p.code || ''); return { len: x.code.length }; }
    case 'Script.GetCode': { const x = script(p.id); const c = x ? x.code : '', off = Number(p.offset || 0), len = Number(p.len || 2048); const data = c.slice(off, off + len); return { data, left: Math.max(0, c.length - off - data.length) }; }
    case 'Script.SetConfig': { const x = script(p.id); if (x && p.config && 'enable' in p.config) x.enable = !!p.config.enable; return { restart_required: false }; }
    case 'Script.Stop': { const x = script(p.id); if (x) { x.running = false; x.ep = {}; } return { was_running: true }; }
    case 'Script.Start': { const x = script(p.id); if (!x) return {}; if (!x.running && 1 + [...extra.values()].filter((y) => y.running).length >= 3) throw { code: -103, message: 'Too many scripts running' };
      startExtra(x); return { was_running: false }; }
    case 'Script.Delete': { const x = script(p.id); if (!x) throw { code: -105, message: 'Argument id, value ' + p.id + ' not found!' }; if (x.running) throw { code: -103, message: 'Script is running' }; extra.delete(x.id); return null; }
    case 'Script.GetStatus': { const x = script(p.id); return x ? { id: x.id, running: x.running, mem_used: x.running ? 1520 : 0, mem_peak: x.running ? 2210 : 0, mem_free: 9800 } : { id: sid, running: true, mem_used: 15036, mem_peak: 17430 }; }
    case 'Script.Eval': {
      if (p.id !== sid) throw { code: -105, message: 'Argument id, value ' + p.id + ' not found!' };
      if (!/JSON\.stringify\(stateObject\(\)\)/.test(p.code || '')) throw { code: -103, message: 'mock evaluates only JSON.stringify(stateObject())' };
      const res = dev.httpGet(`/script/${sid}/state`);
      return { result: res.body };
    }
    case 'EM1.GetStatus': {
      const w = dev.power, u = dev.voltage || 230;
      return { id: 0, current: Math.round(w / u * 1000) / 1000, voltage: u, act_power: w, aprt_power: Math.round(w * 1.08 * 10) / 10, pf: 0.92, freq: 50, calibration: 'factory' };
    }
    case 'EM1Data.GetRecords':
      return { data_blocks: [{ ts: T0 / 1000, period: 60, records: (lastRecordTs() - T0 / 1000) / 60 + 1 }] };
    case 'EM1Data.GetData': {
      const first = T0 / 1000, last = lastRecordTs();
      let ts = Math.max(first, Math.ceil((p.ts || first) / 60) * 60);
      const end = Math.min(last, p.end_ts || last);
      const values = [];
      const t0 = ts;
      while (ts <= end && values.length < 720) { values.push(record(ts)); ts += 60; }
      const out = { keys: KEYS, data: values.length ? [{ ts: t0, period: 60, values }] : [] };
      if (ts <= end) out.next_record_ts = ts;
      return out;
    }
    default: throw { code: 404, message: 'No handler for ' + method };
  }
}

// scripts other than the recognition script: their code, and HTTP endpoints when started
const extra = new Map(); let nextId = sid + 1;
const script = (id) => extra.get(Number(id));
const fsFree = () => FS_FREE0 - [...extra.values()].reduce((a, x) => a + Math.ceil(x.code.length / 4096) * 4096, 0);
function startExtra(x) {
  x.ep = {};
  vm.runInNewContext(x.code, { HTTPServer: { registerEndpoint: (name, fn) => { x.ep[name] = fn; } }, Shelly: { getCurrentScriptId: () => x.id }, print: (...a) => console.log('[script ' + x.id + ']', ...a) });
  x.running = true;
}

// ---------------------------------------------------------------- WebSocket (RFC 6455, text frames only)
const clients = new Set();
function wsSend(sock, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([head, data]));
}
function onFrame(c, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.src) c.src = m.src;
  const reply = (o) => wsSend(c.sock, Object.assign({ id: m.id, src: REALM, dst: m.src }, o));
  if (m.method !== 'Shelly.GetDeviceInfo' && !authOk(m.auth)) { c.authed = false; return reply({ error: challenge() }); }
  c.authed = true;
  try { reply({ result: call(m.method, m.params) }); } catch (e) { reply({ error: e && e.code ? e : { code: -1, message: String(e) } }); }
}
function attach(sock) {
  const c = { sock, buf: Buffer.alloc(0), src: null, authed: !PASSWORD };
  clients.add(c);
  sock.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    for (;;) {
      const b = c.buf; if (b.length < 2) return;
      const op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? b.slice(off, off + 4) : null; if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.slice(off, off + len)); if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      c.buf = b.slice(off + len);
      if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch (e) { /* closed */ } return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 1) onFrame(c, payload.toString('utf8'));
    }
  });
  const drop = () => clients.delete(c);
  sock.on('close', drop); sock.on('error', drop);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/app' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(APP));
  }
  // like the firmware: cross-origin HTTP requests are refused
  if (req.headers.origin) { res.writeHead(503); return res.end(); }
  if (url.pathname === `/script/${sid}/state`) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(dev.httpGet(`/script/${sid}/state`).body); }
  const em = url.pathname.match(/^\/script\/(\d+)\/([\w-]+)$/);
  if (em && script(em[1]) && script(em[1]).running && script(em[1]).ep[em[2]]) {
    const out = { code: 200, headers: [], body: '', send() { const h = {}; for (const [k, v] of this.headers) h[k] = v; res.writeHead(this.code, h); res.end(this.body); } };
    return script(em[1]).ep[em[2]]({ method: req.method, query: url.search.slice(1) }, out);
  }
  const rm = url.pathname.match(/^\/rpc\/?([\w.]*)$/);
  if (rm) {
    const answer = (method, params, id) => {
      try { const r = call(method, params); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(id === undefined ? r : { id, src: REALM, result: r })); }
      catch (e) { res.writeHead(id === undefined ? 500 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(id === undefined ? (e.code ? e : { code: -1, message: String(e) }) : { id, src: REALM, error: e.code ? e : { code: -1, message: String(e) } })); }
    };
    if (req.method === 'GET' && rm[1]) {
      const params = {}; for (const [k, v] of url.searchParams) params[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
      return answer(rm[1], params);
    }
    if (req.method === 'POST') { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { let m = {}; try { m = JSON.parse(b); } catch (e) { /* bad */ } answer(m.method, m.params, m.id); }); return; }
  }
  res.writeHead(404); res.end();
});
server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/rpc') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  attach(sock);
});

// real time: advance the device every second, send new events and power changes
let lastP = null;
setInterval(() => {
  if (Date.now() > dev.t) dev.run(Date.now() - dev.t);
  const evs = dev.eventLog.slice(evIdx); evIdx = dev.eventLog.length;
  const now = dev.t / 1000;
  for (const c of clients) {
    if (!c.src || !c.authed) continue;
    for (const e of evs) if (e.name === 'uponor') wsSend(c.sock, { src: REALM, dst: c.src, method: 'NotifyEvent', params: { ts: now, events: [{ component: 'script:' + sid, id: sid, event: 'uponor', data: e.data, ts: e.t / 1000 }] } });
    if (dev.power !== lastP) wsSend(c.sock, { src: REALM, dst: c.src, method: 'NotifyStatus', params: { ts: now, 'em1:0': { id: 0, act_power: dev.power } } });
  }
  lastP = dev.power;
}, 1000);

server.listen(PORT, () => console.log(`Shelly WS mock on ws://127.0.0.1:${PORT}/rpc${PASSWORD ? ' (password set)' : ''}, app at http://127.0.0.1:${PORT}/app`));
