// A fake Shelly Gen2+ HTTP API for testing the recorder (shelly/tools/nauhuri.ps1).
// Usage: node shelly_http_mock.js [--port 8099] [--password secret] [--meter em1|pm1|switch|em|two]
//                                 [--no-script] [--outage FROM-TO] (seconds after start)
// Power follows a short synthetic cycle (idle, compressor, aeration, valve pulses). During the
// outage the server drops connections, and afterwards the uptime starts again from zero
// (the Shelly lost power with the plant).
'use strict';
const http = require('http');
const crypto = require('crypto');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes('--' + name);
const PORT = Number(arg('port', 8099));
const PASSWORD = arg('password', null);
const METER = arg('meter', 'em1');
const SCRIPT = !flag('no-script');
const OUTAGE = (arg('outage', '') || '').split('-').map(Number).filter((x) => !isNaN(x));
const REALM = 'shellyemminig4-aabbccddeeff';
const t0 = Date.now();
let bootAt = t0 - 3600e3;
let nonce = crypto.randomBytes(4).toString('hex');
let requests = 0, authFails = 0;

const sec = () => (Date.now() - t0) / 1000;
const inOutage = () => OUTAGE.length === 2 && sec() >= OUTAGE[0] && sec() < OUTAGE[1];
let wasOut = false;

function power() {
  const s = sec() % 60;
  if (s < 10) return 4.1;            // idle
  if (s < 30) return 46.5;           // compressor
  if (s < 50) return 56.8;           // aeration
  return s % 2 < 1 ? 18.2 : 4.1;     // valve pulses
}
const volt = () => 231.4 + Math.sin(sec() / 7);
const phase = () => { const s = sec() % 60; return s < 10 ? 'waiting' : s < 30 ? 'pump_in' : s < 50 ? 'aeration' : 'sedimentation_1'; };

function meterStatus(type, id) {
  const p = power(), u = volt(), i = p / u;
  if (type === 'em1') return { id, current: +i.toFixed(3), voltage: +u.toFixed(1), act_power: +p.toFixed(1), aprt_power: +(p * 1.1).toFixed(1), pf: 0.91, freq: 50, calibration: 'factory' };
  if (type === 'pm1') return { id, voltage: +u.toFixed(1), current: +i.toFixed(3), apower: +p.toFixed(1), freq: 50, aenergy: { total: 1234.5 } };
  if (type === 'switch') return { id, source: 'init', output: true, apower: +p.toFixed(1), voltage: +u.toFixed(1), current: +i.toFixed(3), aenergy: { total: 99 } };
  return { id, a_current: +i.toFixed(3), a_voltage: +u.toFixed(1), a_act_power: +p.toFixed(1), a_pf: 0.9, a_freq: 50, b_act_power: 0, c_act_power: 0, total_current: +i.toFixed(3), total_act_power: +p.toFixed(1) };
}

function sys() {
  return { mac: 'AABBCCDDEEFF', restart_required: false, time: new Date().toTimeString().slice(0, 5), unixtime: Math.floor(Date.now() / 1000),
    uptime: Math.floor((Date.now() - bootAt) / 1000), ram_size: 262144, ram_free: 120000, reset_reason: wasOut ? 1 : 3 };
}

function status() {
  const st = { sys: sys(), wifi: { sta_ip: '192.168.1.50', status: 'got ip', ssid: 'MyHomeWifi', rssi: -66 } };
  if (METER === 'two') { st['em1:0'] = meterStatus('em1', 0); st['em1:1'] = Object.assign(meterStatus('em1', 1), { act_power: 0 }); st['em1data:0'] = {}; st['em1data:1'] = {}; }
  else if (METER === 'em1') { st['em1:0'] = meterStatus('em1', 0); st['em1data:0'] = {}; }
  else if (METER === 'em') { st['em:0'] = meterStatus('em', 0); st['emdata:0'] = {}; }
  else if (METER === 'switch') { st['switch:0'] = meterStatus('switch', 0); st['input:0'] = { id: 0, state: false }; }
  else st['pm1:0'] = meterStatus('pm1', 0);
  if (SCRIPT) st['script:2'] = { id: 2, running: true, mem_used: 15000, mem_peak: 19600, mem_free: 6000 };
  return st;
}

function scriptState() {
  return { version: '3.0.2', cycle: 'waiting', phase: phase(), code: 'S204', since: Math.floor(Date.now() / 1000) - 100, eta: null, batches: 255,
    chemical: { l: 1.76, days: 44 }, sludge: { n: 106, reset: null }, warnings: [], power: power(), band: power() > 52 ? 'AER' : power() > 38.5 ? 'COMP' : power() > 10 ? 'VALVE' : 'IDLE', time_synced: true };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function authorized(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!/^Digest /.test(h)) return false;
  const f = {}; h.slice(7).replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (m, k, v, q) => { f[k] = q !== undefined ? q : v; });
  if (f.nonce !== nonce || f.realm !== REALM || f.username !== 'admin') return false;
  const ha1 = sha(`admin:${REALM}:${PASSWORD}`), ha2 = sha(`${req.method}:${f.uri}`);
  return f.response === sha(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:auth:${ha2}`) && f.uri === req.url;
}
function deny(res) {
  authFails++;
  if (authFails % 50 === 0) nonce = crypto.randomBytes(4).toString('hex');   // the nonce goes stale now and then
  res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${REALM}", nonce="${nonce}", algorithm=SHA-256`, 'Content-Type': 'text/plain' });
  res.end('401 Unauthorized');
}
function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
  requests++;
  if (inOutage()) { wasOut = true; req.socket.destroy(); return; }
  if (wasOut && !inOutage() && bootAt < t0 + OUTAGE[1] * 1000) bootAt = t0 + OUTAGE[1] * 1000;
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/shelly') {
    return json(res, { name: null, id: REALM, mac: 'AABBCCDDEEFF', slot: 0, model: 'S4EM-001PXCEU16', gen: 4, fw_id: '20261109-150305/2.2.0-g7968dca', ver: '2.2.0', app: 'MiniEM', auth_en: !!PASSWORD, auth_domain: PASSWORD ? REALM : null });
  }
  if (!authorized(req)) return deny(res);
  if (req.method === 'GET' && url.pathname === '/script/2/state' && SCRIPT) return json(res, scriptState());
  const dm = url.pathname.match(/^\/(em1data|emdata)\/(\d+)\/data\.csv$/);
  if (req.method === 'GET' && dm) {
    const ts = Number(url.searchParams.get('ts')) || Math.floor(Date.now() / 1000) - 86400;
    const rows = ['timestamp,total_act_energy,fund_act_energy,total_act_ret_energy,fund_act_ret_energy,lag_react_energy,lead_react_energy,max_act_power,min_act_power,max_aprt_power,min_aprt_power,max_voltage,min_voltage,avg_voltage,max_current,min_current,avg_current'];
    for (let t = Math.ceil(ts / 60) * 60; t < Date.now() / 1000; t += 60) rows.push(`${t},0.4,0.4,0,0,0,0,57.1,4.0,62.0,8.0,233.0,229.5,231.2,0.26,0.02,0.11`);
    res.writeHead(200, { 'Content-Type': 'text/csv' }); return res.end(rows.join('\n') + '\n');
  }
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let r; try { r = JSON.parse(body); } catch (e) { return json(res, { id: null, error: { code: -32700, message: 'parse error' } }); }
      const p = r.params || {};
      const ok = (result) => json(res, { id: r.id, src: REALM, result });
      const m = r.method;
      if (m === 'Shelly.GetStatus') return ok(status());
      if (m === 'Sys.GetStatus') return ok(sys());
      if (m === 'Sys.GetConfig') return ok({ device: { name: null, mac: 'AABBCCDDEEFF' }, location: { tz: 'Europe/Helsinki', lat: 60.17, lon: 24.94 } });
      if (m === 'Script.List') return ok({ scripts: SCRIPT ? [{ id: 1, name: 'other', enable: false, running: false }, { id: 2, name: 'uponor-clean-v3', enable: true, running: true }] : [] });
      if (m === 'KVS.GetMany') return ok({ items: [{ key: 'uc_batch', etag: 'a', value: '{"n":255,"ts":1795000000}' }, { key: 'uc_cfg', etag: 'b', value: '{}' }] });
      const mm = m && m.match(/^(EM1|PM1|Switch|EM)\.GetStatus$/);
      if (mm) {
        const type = { EM1: 'em1', PM1: 'pm1', Switch: 'switch', EM: 'em' }[mm[1]];
        const st = status()[`${type}:${p.id}`];
        if (!st) return json(res, { id: r.id, src: REALM, error: { code: -105, message: `Argument 'id', value ${p.id} not found!` } });
        return ok(st);
      }
      return json(res, { id: r.id, src: REALM, error: { code: 404, message: `No handler for ${m}` } });
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock Shelly on 127.0.0.1:${PORT} meter=${METER} password=${PASSWORD ? 'yes' : 'no'} script=${SCRIPT} outage=${OUTAGE.join('-') || 'none'}`));
process.on('SIGTERM', () => { console.log(`requests ${requests}, auth challenges ${authFails}`); process.exit(0); });
