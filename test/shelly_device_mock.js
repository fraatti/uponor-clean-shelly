// Shelly device mock for v3 scripts: several scripts on one device, virtual clock,
// @meta-managed virtual components, KVS, Script.storage, events, HTTP endpoints.
// Behaviour follows the Shelly gen2 documentation as far as it is documented;
// details that are not documented are marked "assumed".
'use strict';
const vm = require('vm');

const VC_TYPES = ['boolean', 'number', 'text', 'enum', 'group', 'button'];
const VC_LIMIT = 10;

class Device {
  constructor(opts = {}) {
    this.t = opts.startMs || Date.parse('2026-11-18T19:00:00Z'); // wall clock (ms)
    this.bootT = this.t;
    this.timeSynced = opts.timeSynced !== false;
    this.tzOffsetMin = opts.tzOffsetMin === undefined ? 120 : opts.tzOffsetMin;
    this.comps = new Map();     // key -> {type, id, config, value, owner, access}
    this.kvs = new Map();
    this.scripts = new Map();   // id -> script record
    this.nextScriptId = 1;
    this.queue = [];            // immediate tasks
    this.timers = [];           // {at, ms, repeat, cb, sid, id}
    this.timerSeq = 1;
    this.logs = [];
    this.endpoints = new Map(); // path -> {sid, cb}
    this.em1Blocks = opts.em1Blocks || null;
    this.power = 4.0;
    this.voltage = 236;
    this.feed = null;          // power feed for em1:0: [{t, p?, u?}] sorted by t
    this.feedIdx = 0;
    this.resetReason = opts.resetReason;   // sys.reset_reason (undefined: field absent)
    this.eventLog = [];        // emitted script events {t, sid, name, data}
    this.onValue = null;       // hook (key, value, t) on every component value change
  }

  setFeed(events) { this.feed = events; this.feedIdx = 0; if (events.length) { const e0 = events.find((e) => e.p != null); if (e0) this.power = e0.p; } this.advanceFeed(); }
  advanceFeed() {
    const f = this.feed; if (!f) return;
    while (this.feedIdx < f.length && f[this.feedIdx].t <= this.t) { const e = f[this.feedIdx++]; if (e.p != null) this.power = e.p; if (e.u != null) this.voltage = e.u; }
  }

  // the device loses power (scripts stop) / gets it back (uptime restarts, scripts start after bootMs)
  powerOff() { this.autostartIds = [...this.scripts.values()].filter((s) => s.running).map((s) => s.id); for (const id of this.autostartIds) this.stopScript(id); this.queue = []; this.timers = []; }
  powerOn(bootMs, resetReason) {
    this.bootT = this.t; this.resetReason = resetReason === undefined ? 1 : resetReason;
    for (const c of this.comps.values()) if (c.type !== 'group' && !c.config.persisted && c.config.default_value !== undefined) c.value = c.config.default_value;
    this.run(bootMs || 3000);
    for (const id of this.autostartIds || []) this.startScript(id);
  }

  // ---------------------------------------------------------------- helpers
  log(sid, s) { this.logs.push({ t: this.t, sid, s }); if (this.verbose) console.log(`[${sid}] ${s}`); }
  unix() { return this.timeSynced ? Math.floor(this.t / 1000) : null; }
  uptimeMs() { return this.t - this.bootT; }
  vcCount() { return this.comps.size; }
  freeId(type) { for (let id = 200; id <= 299; id++) if (!this.comps.has(`${type}:${id}`)) return id; return null; }
  post(fn) { this.queue.push(fn); }

  addComponent(type, id, config, owner, access) {
    if (!VC_TYPES.includes(type)) throw new Error('bad type ' + type);
    if (this.vcCount() >= VC_LIMIT) return { err: -114, msg: 'Too many virtual components' };
    if (id === undefined || id === null) id = this.freeId(type);
    if (id < 200 || id > 299) return { err: -103, msg: 'Invalid id' };
    const key = `${type}:${id}`;
    if (this.comps.has(key)) return { err: -103, msg: 'ID not available' };
    const cfg = JSON.parse(JSON.stringify(config || {}));
    cfg.id = id;
    let value = null;
    if (type === 'number') value = cfg.default_value !== undefined ? cfg.default_value : 0;
    if (type === 'text') value = cfg.default_value !== undefined ? cfg.default_value : '';
    if (type === 'boolean') value = cfg.default_value !== undefined ? cfg.default_value : false;
    if (type === 'enum') value = cfg.default_value !== undefined ? cfg.default_value : (cfg.options ? cfg.options[0] : null);
    if (type === 'group') value = [];
    this.comps.set(key, { type, id, config: cfg, value, owner: owner || '', access: access || '*', listeners: [] });
    return { res: { id } };
  }

  // external write (RPC from app / HA): respects access letters of managed VCs
  externalSet(key, value) {
    const c = this.comps.get(key);
    if (!c) return { err: -105, msg: 'not found' };
    if (c.owner && !(c.access.includes('w') || c.access.includes('*'))) return { err: -103, msg: 'Access denied' };
    this.setValueNow(key, value, 'rpc');
    return { res: null };
  }

  setValueNow(key, value, source) {
    const c = this.comps.get(key);
    if (!c) return;
    if (c.type === 'number') {
      if (typeof c.config.min === 'number') value = Math.max(c.config.min, value);
      if (typeof c.config.max === 'number') value = Math.min(c.config.max, value);
    }
    if (c.type === 'enum' && !c.config.options.includes(value)) throw new Error(`enum ${key} has no option ${value}`);
    if (c.type === 'text' && typeof c.config.max_len === 'number' && value.length > c.config.max_len) throw new Error(`text ${key} too long (${value.length})`);
    const changed = JSON.stringify(c.value) !== JSON.stringify(value);
    c.value = value;
    if (changed && this.onValue) this.onValue(key, value, this.t);
    if (changed) {
      for (const l of c.listeners) {
        const ev = { component: key, id: c.id, event: 'change', value, source: source || 'script', ts: this.t / 1000 }; // assumed shape
        this.post(() => this.invoke(l.sid, () => l.cb(ev)));
      }
    }
  }

  // ---------------------------------------------------------------- scripts
  addScript(name, code) {
    const id = this.nextScriptId++;
    this.scripts.set(id, { id, name, code, running: false, storage: new Map(), ctx: null, eventHandlers: [], statusHandlers: [], timerCount: 0, pendingSets: [], memPeak: 0 });
    return id;
  }

  parseMeta(code) {
    // device reads @meta only from the first 1024 bytes (seen 2026-11-18); roles beyond are ignored
    if (code.indexOf('*/') > 1024) throw new Error('@meta block ends after byte 1024 (' + code.indexOf('*/') + '); roles beyond are ignored on the device');
    const lines = code.split('\n');
    let i = 0; while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || !lines[i].trim().startsWith('/* @meta')) return null;
    const rest = lines.slice(i).join('\n');
    const end = rest.indexOf('*/');
    const body = rest.slice(rest.indexOf('@meta') + 5, end).trim();
    return JSON.parse(body);
  }

  reconcile(sid, meta) {
    const owner = `script:${sid}`;
    const vc = (meta && meta.vc) || {};
    const roles = Object.keys(vc);
    // validate first (whole declaration or nothing)
    for (const r of roles) {
      const d = vc[r];
      if (!VC_TYPES.includes(d.type)) return { err: -110, msg: `role ${r}: bad type` };
      if (!d.config) return { err: -110, msg: `role ${r}: config missing` };
      if (d.members) for (const m of d.members) if (!m.startsWith('@') || !vc[m.slice(1)]) return { err: -110, msg: `role ${r}: unresolved member ${m}` };
    }
    const existing = [...this.comps.entries()].filter(([, c]) => c.owner === owner);
    const byRole = new Map(existing.map(([k, c]) => [c.role, k]));
    const newOnes = roles.filter(r => !byRole.has(r) || this.comps.get(byRole.get(r)).type !== vc[r].type);
    const removed = existing.filter(([, c]) => !vc[c.role]);
    if (this.vcCount() - removed.length + newOnes.length > VC_LIMIT && newOnes.length > 0) return { err: -110, msg: 'virtual component limit reached' };
    for (const [k] of removed) this.comps.delete(k);
    const keys = {};
    for (const r of roles) {
      const d = vc[r];
      let key = byRole.get(r);
      if (key && this.comps.get(key).type !== d.type) { this.comps.delete(key); key = null; }
      if (!key) {
        const res = this.addComponent(d.type, null, d.config, owner, (d.access || '*').replace('m', ''));
        if (res.err) return { err: -110, msg: `role ${r}: ${res.msg}` };
        key = `${d.type}:${res.res.id}`;
        this.comps.get(key).role = r;
        this.comps.get(key).declared = JSON.stringify(d.config);
      } else {
        const c = this.comps.get(key);
        // device behaviour seen in the 2026-11-18 test: an unchanged declaration does not
        // reset settings that the script changed later with setConfig()
        if (c.declared !== JSON.stringify(d.config)) { Object.assign(c.config, JSON.parse(JSON.stringify(d.config))); c.declared = JSON.stringify(d.config); }
        c.access = (d.access || '*').replace('m', '');
      }
      keys[r] = key;
    }
    for (const r of roles) if (vc[r].members) this.comps.get(keys[r]).value = vc[r].members.map(m => keys[m.slice(1)]);
    return { res: keys };
  }

  startScript(sid) {
    const s = this.scripts.get(sid);
    let meta = null;
    try { meta = this.parseMeta(s.code); } catch (e) { return { err: -110, msg: '@meta is not valid JSON: ' + e.message }; }
    if (meta) {
      const r = this.reconcile(sid, meta);
      if (r.err) return r;
      s.roles = r.res;
    } else s.roles = {};
    s.running = true;
    s.ctx = vm.createContext(this.makeApi(sid));
    this.invoke(sid, () => vm.runInContext(s.code, s.ctx, { filename: s.name }));
    return { res: { was_running: false } };
  }

  stopScript(sid) {
    const s = this.scripts.get(sid);
    s.running = false;
    this.timers = this.timers.filter(t => t.sid !== sid);
    for (const c of this.comps.values()) c.listeners = c.listeners.filter(l => l.sid !== sid);
    for (const [p, e] of [...this.endpoints]) if (e.sid === sid) this.endpoints.delete(p);
    s.eventHandlers = []; s.statusHandlers = []; s.eventSubs = 0;
  }

  deleteScript(sid) {
    this.stopScript(sid);
    for (const [k, c] of [...this.comps]) if (c.owner === `script:${sid}`) this.comps.delete(k);
    this.scripts.delete(sid);
  }

  reboot(opts = {}) {
    for (const s of this.scripts.values()) if (s.running) this.stopScript(s.id);
    this.queue = []; this.timers = [];
    this.t += opts.offMs || 8000;
    this.bootT = this.t;
    for (const c of this.comps.values()) {
      if (c.type === 'group') continue;
      if (!c.config.persisted && c.config.default_value !== undefined) c.value = c.config.default_value;
    }
    if (opts.timeSynced !== undefined) this.timeSynced = opts.timeSynced;
    for (const s of this.scripts.values()) if (opts.autostart && opts.autostart.includes(s.id)) this.startScript(s.id);
  }

  invoke(sid, fn) {
    const s = this.scripts.get(sid);
    if (!s || !s.running) return;
    try { fn(); } catch (e) { this.log(sid, 'UNCAUGHT ' + (e && e.stack || e)); s.error = e; }
    // setValue is applied when the script context exits
    const p = s.pendingSets; s.pendingSets = [];
    for (const [key, v] of p) this.setValueNow(key, v, 'script');
  }

  // ---------------------------------------------------------------- RPC
  rpc(sid, method, params) {
    const p = params || {};
    switch (method) {
      case 'KVS.Get': return this.kvs.has(p.key) ? { res: { etag: 'x', value: this.kvs.get(p.key) } } : { err: -105, msg: 'Key not found' };
      case 'KVS.Set':
        if (String(p.key).length > 42) return { err: -103, msg: 'key too long' };
        if (String(p.key).includes('.')) return { err: -103, msg: 'dotted keys not supported' };
        if (JSON.stringify(p.value).length > 253 + 2) return { err: -103, msg: 'value too long' };
        if (!this.kvs.has(p.key) && this.kvs.size >= 50) return { err: -103, msg: 'too many keys' };
        this.kvs.set(p.key, p.value); return { res: { etag: 'x', rev: 1 } };
      case 'KVS.Delete': if (!this.kvs.has(p.key)) return { err: -105, msg: 'not found' }; this.kvs.delete(p.key); return { res: { rev: 1 } };
      case 'Shelly.GetComponents': {
        const all = [...this.comps.entries()].filter(([k]) => !p.keys || p.keys.includes(k)).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, c]) => {
          const o = { key: k };
          if (p.include && p.include.includes('status')) o.status = c.type === 'group' ? { value: c.value.slice() } : { value: c.value };
          if (p.include && p.include.includes('config')) o.config = JSON.parse(JSON.stringify(c.config));
          if (c.owner) o.attrs = { owner: c.owner };
          return o;
        });
        const off = p.offset || 0, page = 4; // small pages to exercise paging
        return { res: { components: all.slice(off, off + page), cfg_rev: 1, offset: off, total: all.length } };
      }
      case 'Virtual.Add': return this.addComponent(p.type, p.id, p.config, '', '*');
      case 'Virtual.Delete': {
        const c = this.comps.get(p.key);
        if (!c) return { err: -105, msg: 'not found' };
        if (c.owner) return { err: -103, msg: 'owned component, manage access required' };
        this.comps.delete(p.key);
        for (const g of this.comps.values()) if (g.type === 'group') g.value = g.value.filter(m => m !== p.key);
        return { res: null };
      }
      case 'Group.Set': {
        const c = this.comps.get(`group:${p.id}`); if (!c) return { err: -105, msg: 'not found' };
        for (const m of p.value) if (!this.comps.has(m)) return { err: -103, msg: 'unknown member ' + m };
        c.value = p.value.slice(); return { res: null };
      }
      case 'Boolean.Set': case 'Number.Set': case 'Text.Set': case 'Enum.Set': {
        const type = method.split('.')[0].toLowerCase();
        return this.externalSetFromScript(`${type}:${p.id}`, p.value);
      }
      case 'EM1Data.GetRecords': return { res: { data_blocks: this.em1Blocks || [{ ts: Math.floor(this.bootT / 1000), period: 60, records: Math.floor(this.uptimeMs() / 60000) }] } };
      default: return { err: -114, msg: 'Method not found: ' + method };
    }
  }

  externalSetFromScript(key, value) {
    const c = this.comps.get(key);
    if (!c) return { err: -105, msg: 'not found' };
    this.setValueNow(key, value, 'rpc');
    return { res: null };
  }

  // ---------------------------------------------------------------- API seen by the script
  makeApi(sid) {
    const dev = this;
    const s = this.scripts.get(sid);
    const handleFor = (key) => {
      if (!key || !dev.comps.has(key)) return null;
      return {
        getValue: () => { const c = dev.comps.get(key); return c ? c.value : undefined; },
        setValue: (v) => { const c = dev.comps.get(key); if (c && c.type !== 'group' && c.type !== 'button') s.pendingSets.push([key, v]); },
        getStatus: () => { const c = dev.comps.get(key); return c ? { value: Array.isArray(c.value) ? c.value.slice() : c.value } : undefined; },
        getConfig: () => { const c = dev.comps.get(key); return c ? JSON.parse(JSON.stringify(c.config)) : undefined; },
        setConfig: (o) => { const c = dev.comps.get(key); if (c) Object.assign(c.config, o); },
        on: (ev, cb) => { const c = dev.comps.get(key); if (!c) return -1; s.eventSubs = (s.eventSubs || 0) + 1; if (s.eventSubs > 5) throw new Error('more than 5 event subscriptions'); c.listeners.push({ sid, ev, cb }); return c.listeners.length; },
        off: () => true,
      };
    };
    const storage = {
      getItem: (k) => s.storage.has(k) ? s.storage.get(k) : null,
      setItem: (k, v) => {
        if (typeof v !== 'string') throw new Error('Script.storage only stores strings');
        if (k.length > 16) throw new Error('storage key too long: ' + k);
        if (v.length > 1024) throw new Error('storage value too long: ' + k + ' ' + v.length);
        if (!s.storage.has(k) && s.storage.size >= 12) throw new Error('storage full');
        s.storage.set(k, v);
      },
      key: (i) => [...s.storage.keys()][i],
      get length() { return s.storage.size; },
    };
    let inflight = 0;
    return {
      print: (...a) => dev.log(sid, a.join(' ')),
      console: { log: (...a) => dev.log(sid, a.join(' ')) },
      JSON, Math, Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(dev.t); } },
      Number, String, Object, Array,
      Timer: {
        set: (ms, repeat, cb, ud) => {
          s.timerCount++; if (dev.timers.filter(t => t.sid === sid).length >= 5) throw new Error('more than 5 timers');
          const id = dev.timerSeq++; dev.timers.push({ at: dev.t + ms, ms, repeat, cb, ud, sid, id }); return id;
        },
        clear: (id) => { dev.timers = dev.timers.filter(t => t.id !== id); return true; },
      },
      Shelly: {
        call: (method, params, cb, ud) => {
          inflight++; if (inflight > 5) throw new Error('more than 5 RPC calls in flight');
          const r = dev.rpc(sid, method, params);
          dev.post(() => { inflight--; dev.invoke(sid, () => { if (cb) cb(r.res === undefined ? undefined : r.res, r.err || 0, r.msg || '', ud); }); });
        },
        getComponentStatus: (k, id) => {
          const key = id === undefined ? k : `${k}:${id}`;
          if (key === 'sys') {
            const u = dev.unix();
            let time = null;
            if (u !== null) { const lm = Math.floor(((u + dev.tzOffsetMin * 60) % 86400) / 60); time = String(Math.floor(lm / 60)).padStart(2, '0') + ':' + String(lm % 60).padStart(2, '0'); }
            const o = { uptime: Math.floor(dev.uptimeMs() / 1000), unixtime: u, time, ram_free: 50000 };
            if (dev.resetReason !== undefined) o.reset_reason = dev.resetReason;
            return o;
          }
          if (key === 'wifi') return { sta_ip: '192.168.1.50', status: 'got ip' };
          if (key.startsWith('script:')) { const n = Number(key.split(':')[1]); const x = dev.scripts.get(n); return x ? { id: n, running: x.running, mem_used: 9000, mem_peak: 12000, mem_free: 16000 } : null; }
          if (key === 'em1data:0') return { id: 0 };
          if (key === 'em1:0') { dev.advanceFeed(); return { id: 0, act_power: dev.power, voltage: dev.voltage }; }
          const c = dev.comps.get(key); return c ? { value: c.value } : null;
        },
        getComponentConfig: (k, id) => { const key = id === undefined ? k : `${k}:${id}`; const c = dev.comps.get(key); return c ? JSON.parse(JSON.stringify(c.config)) : null; },
        getDeviceInfo: () => ({ id: 'shellyemminig4-000000000000', model: 'S4EM-001PXEU16', ver: '2.2.0', fw_id: '20261111-000000/2.2.0-mock', app: 'MiniEM' }),
        getCurrentScriptId: () => sid,
        getUptimeMs: () => dev.uptimeMs(),
        addEventHandler: (cb, ud) => { s.eventHandlers.push({ cb, ud }); s.eventSubs = (s.eventSubs || 0) + 1; return s.eventHandlers.length; },
        addStatusHandler: (cb, ud) => { s.statusHandlers.push({ cb, ud }); return s.statusHandlers.length; },
        removeEventHandler: () => true, removeStatusHandler: () => true,
        emitEvent: (name, data) => {
          const now = dev.t / 1000;
          const ev = { component: `script:${sid}`, name: 'script', id: sid, now, info: { component: `script:${sid}`, id: sid, event: name, data: JSON.parse(JSON.stringify(data)), ts: now } }; // assumed shape
          for (const x of dev.scripts.values()) if (x.running) for (const h of x.eventHandlers) dev.post(() => dev.invoke(x.id, () => h.cb(ev, h.ud)));
          dev.emitted = (dev.emitted || 0) + 1;
          dev.eventLog.push({ t: dev.t, sid, name, data: JSON.parse(JSON.stringify(data)) });
        },
      },
      Script: {
        getVcHandle: (role) => handleFor(s.roles[role]),
        storage,
      },
      Virtual: { getHandle: (key) => handleFor(key) },
      HTTPServer: {
        registerEndpoint: (name, cb) => { const path = `/script/${sid}/${name}`; dev.endpoints.set(path, { sid, cb }); return path; },
      },
    };
  }

  httpGet(path) {
    const e = this.endpoints.get(path);
    if (!e) return { code: 404 };
    const res = { code: 200, body: '', headers: [], sent: false };
    res.send = () => { res.sent = true; return true; };
    this.invoke(e.sid, () => e.cb({ method: 'GET', query: '', headers: [] }, res));
    return res;
  }

  // ---------------------------------------------------------------- clock
  drain() { let n = 0; while (this.queue.length) { this.queue.shift()(); if (++n > 100000) throw new Error('task loop'); } }
  run(ms) {
    const end = this.t + ms;
    this.drain();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const tm = this.timers[0];
      if (!tm || tm.at > end) break;
      this.t = tm.at;
      if (tm.repeat) tm.at += tm.ms; else this.timers.shift();
      this.invoke(tm.sid, () => tm.cb(tm.ud));
      this.drain();
    }
    this.t = end;
  }
}

// Static checks for features the Shelly engine does not support (arrow functions,
// template literals, const, classes, spread) and for calls before function declarations
// at the top level (no hoisting on Shelly).
function languageCheck(code) {
  const problems = [];
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const noStrings = noComments.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  const rules = [[/=>/, 'arrow function'], [/`/, 'template literal'], [/\bconst\b/, 'const'], [/\bclass\b/, 'class'], [/\.\.\./, 'spread'], [/\basync\b|\bawait\b|\bPromise\b/, 'async/Promise']];
  const lines = noStrings.split('\n');
  lines.forEach((l, i) => { for (const [re, name] of rules) if (re.test(l)) problems.push(`line ${i + 1}: ${name}`); });
  const decl = new Map();
  lines.forEach((l, i) => { const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(l); if (m) decl.set(m[1], i); });
  lines.forEach((l, i) => {
    if (/^\s/.test(l) || /^function\s/.test(l) || l.trim() === '' || /^[}\])]/.test(l)) return;
    for (const [name, at] of decl) if (new RegExp('\\b' + name + '\\s*\\(').test(l) && i < at) problems.push(`line ${i + 1}: ${name}() called before its declaration (line ${at + 1})`);
  });
  return problems;
}

module.exports = { Device, languageCheck };
