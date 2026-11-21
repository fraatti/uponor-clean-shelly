// Analyses a recording made with shelly/tools/nauhuri.ps1: the power levels of the plant against
// the script's power bands, connection breaks, and what script v3 makes of the recording when it
// is run on the device mock (cycles, phases, batches, warnings). If the recording has the device
// script's own phase columns, they are compared with the mock run.
// Usage: node v3_recording.js <uponor_YYYYMMDD_HHMM.csv> [-v] [--cfg '{"comp_max":55}']
//   -v      the script's console from the mock run
//   --cfg   settings to try (KVS uc_cfg), e.g. other band limits; replaces uc_cfg from the recording
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./v3run');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '--cfg');
const verbose = args.includes('-v');
const cfgArg = args.includes('--cfg') ? args[args.indexOf('--cfg') + 1] : null;
if (!file) { console.log('usage: node v3_recording.js <recording.csv> [-v] [--cfg JSON]'); process.exit(2); }

// ---- read ----
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const head = lines[0].split(',');
const col = (n) => head.indexOf(n);
const C = { t: col('time'), p: col('power_w'), u: col('voltage_v'), ph: col('script_phase'), cy: col('script_cycle'), band: col('script_band'), since: col('script_since') };
if (C.t < 0 || C.p < 0) { console.log('not a recorder file (no time/power_w columns)'); process.exit(2); }
const num = (s) => (s === undefined || s === '' ? null : Number(s));
const rows = [];
let tzMin = null;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split(',');
  const t = Date.parse(f[C.t]);
  if (isNaN(t)) continue;
  if (tzMin === null) { const m = f[C.t].match(/([+-])(\d\d):(\d\d)$/); tzMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; }
  rows.push({ t, p: num(f[C.p]), u: C.u >= 0 ? num(f[C.u]) : null, ph: C.ph >= 0 ? f[C.ph] || '' : '', cy: C.cy >= 0 ? f[C.cy] || '' : '', since: C.since >= 0 ? num(f[C.since]) : null });
}
if (rows.length < 10) { console.log('too few rows: ' + rows.length); process.exit(2); }
const infoPath = file.replace(/\.csv$/, '_info.json');
let info = null;
try { info = JSON.parse(fs.readFileSync(infoPath, 'utf8').replace(/^﻿/, '')); } catch (e) { info = null; }

const pad = (n) => String(n).padStart(2, '0');
const fmt = (t) => { const d = new Date(t + tzMin * 60e3); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const dur = (ms) => { const s = Math.round(ms / 1000); if (s < 120) return s + ' s'; const m = Math.round(s / 60); return m < 120 ? m + ' min' : (m / 60).toFixed(1) + ' h'; };
const amin = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);
const amax = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const t0 = rows[0].t, t1 = rows[rows.length - 1].t;

// ---- recording ----
console.log(`Recording ${path.basename(file)}: ${fmt(t0)} - ${fmt(t1)} (${dur(t1 - t0)}), ${rows.length} rows`);
if (info) {
  const d = info.device || {};
  console.log(`Device ${d.model || '?'} fw ${d.ver || '?'}, meter ${info.meter || '?'}, Wi-Fi ${info.wifi_rssi === undefined ? '?' : info.wifi_rssi + ' dBm'}, script ${info.uponor_script ? info.uponor_script.state_start.version + ' (id ' + info.uponor_script.id + ')' : 'none'}`);
}
const steps = [];
for (let i = 1; i < rows.length; i++) steps.push(rows[i].t - rows[i - 1].t);
const gaps = [];
for (let i = 1; i < rows.length; i++) if (steps[i - 1] > 5000) gaps.push([rows[i - 1].t, rows[i].t]);
console.log(`Sampling ${(median(steps) / 1000).toFixed(2)} s; breaks over 5 s: ${gaps.length}${gaps.length ? ', total ' + dur(gaps.reduce((s, g) => s + g[1] - g[0], 0)) + ', longest ' + dur(amax(gaps.map((g) => g[1] - g[0]))) : ''}`);
for (const g of gaps.filter((x) => x[1] - x[0] > 60e3).slice(0, 10)) console.log(`  break ${fmt(g[0])} - ${fmt(g[1])} (${dur(g[1] - g[0])})`);
const us = rows.map((r) => r.u).filter((x) => x !== null && x > 50);
if (us.length) console.log(`Voltage ${amin(us).toFixed(1)} / ${median(us).toFixed(1)} / ${amax(us).toFixed(1)} V (min / median / max)`);

// ---- power levels against the bands ----
const SRC = fs.readFileSync(R.V3_PATH, 'utf8');
const CFG = {};
for (const k of ['off_max', 'idle_max', 'valve_max', 'dosing_max', 'comp_max', 'aer_max']) { const m = SRC.match(new RegExp(k + ':\\s*([0-9.]+)')); CFG[k] = m ? Number(m[1]) : NaN; }
let userCfg = null;
if (cfgArg) userCfg = JSON.parse(cfgArg);
else if (info && info.kvs) {
  const items = Array.isArray(info.kvs.items) ? info.kvs.items : Object.entries(info.kvs.items || {}).map(([key, v]) => Object.assign({ key }, v));
  const it = items.find((x) => x.key === 'uc_cfg');
  if (it) { try { userCfg = JSON.parse(it.value); } catch (e) { userCfg = null; } }
}
if (userCfg) Object.assign(CFG, userCfg);
// as in the script: power above the idle level is normalised to 230 V (the compressor's 4 W base excluded)
const norm = (p, u) => { if (p === null) return null; if (p <= CFG.idle_max) return p; const r = 230 / (u && u > 50 ? u : 230); return (p - 4) * r * r + 4; };
const bandOf = (pn) => (pn < CFG.off_max ? 'OFF' : pn < CFG.idle_max ? 'IDLE' : pn <= CFG.valve_max ? 'VALVE' : pn <= CFG.dosing_max ? 'DOSING' : pn <= CFG.comp_max ? 'COMP' : pn <= CFG.aer_max ? 'AER' : 'BOOST');
const BANDS = ['OFF', 'IDLE', 'VALVE', 'DOSING', 'COMP', 'AER', 'BOOST'];
const time = {}, vals = {};
const hist = new Map();
let near = 0, total = 0;
const limits = [CFG.off_max, CFG.idle_max, CFG.valve_max, CFG.dosing_max, CFG.comp_max, CFG.aer_max];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const pn = norm(r.p, r.u);
  if (pn === null) continue;
  const w = i + 1 < rows.length ? Math.min(rows[i + 1].t - r.t, 5000) : 1000;   // breaks do not count
  const b = bandOf(pn);
  time[b] = (time[b] || 0) + w; (vals[b] || (vals[b] = [])).push(pn);
  const bin = Math.round(pn);
  hist.set(bin, (hist.get(bin) || 0) + w);
  total += w;
  if (pn > CFG.idle_max && limits.some((l) => Math.abs(pn - l) < 1.5)) near += w;
}
console.log(`\nPower bands (normalised to 230 V; limits ${limits.join(' / ')} W${userCfg && Object.keys(userCfg).length ? ', settings ' + JSON.stringify(userCfg) : ''}):`);
for (const b of BANDS) if (time[b]) console.log(`  ${b.padEnd(7)} ${(100 * time[b] / total).toFixed(1).padStart(5)} %  median ${median(vals[b]).toFixed(1).padStart(5)} W  range ${amin(vals[b]).toFixed(1)} - ${amax(vals[b]).toFixed(1)} W`);
// levels: 1 W bins with at least 0.3 % of the time, merged into neighbouring runs
const bins = [...hist.entries()].filter(([, w]) => w / total >= 0.003).sort((a, b) => a[0] - b[0]);
const levels = [];
for (const [p, w] of bins) { const L = levels[levels.length - 1]; if (L && p - L.hi <= 1) { L.hi = p; L.w += w; if (w > L.pw) { L.pw = w; L.peak = p; } } else levels.push({ lo: p, hi: p, w, pw: w, peak: p }); }
console.log('Power levels found (time share, peak): ' + levels.map((L) => `${L.lo === L.hi ? L.lo : L.lo + '-' + L.hi} W ${(100 * L.w / total).toFixed(1)} % (${L.peak} W, ${bandOf(L.peak)})`).join(', '));
console.log(`Time within 1.5 W of a band limit: ${(100 * near / total).toFixed(1)} %${near / total > 0.02 ? '  <- levels sit on a limit: try other limits with --cfg' : ''}`);

// ---- v3 on the recording ----
const events = [];
for (const r of rows) { if (r.p !== null) events.push({ t: r.t, p: r.p }); if (r.u !== null) events.push({ t: r.t, u: r.u }); }
const gapEnds = gaps.filter((g) => g[1] - g[0] > 600e3).map((g) => g[1] - 1000);
const kvs = {};
if (userCfg) kvs.uc_cfg = JSON.stringify(userCfg);
const uptime = info && info.sys_start && typeof info.sys_start.uptime === 'number' ? info.sys_start.uptime : 86400;
const run = R.runV3({ events, t0, t1: t1 + 1000, voltage: 230, tzOffsetMin: tzMin, kvs, uptimeAtStartS: uptime, resetReason: 3, dataGapEnds: gapEnds, verbose });
if (run.uncaught.length) console.log('\n!! script crashed: ' + run.uncaught.map((u) => u.s).join(' | '));
const ph = R.timeline(run.changes, 'phase'), cy = R.timeline(run.changes, 'cycle');
const merged = [];
let ci = 0, curCy = '';
for (const p of ph) { while (ci < cy.length && cy[ci].t <= p.t) curCy = cy[ci++].v; const L = merged[merged.length - 1]; if (L && L.ph === p.v && L.cy === curCy) continue; merged.push({ t: p.t, ph: p.v, cy: curCy }); }
const share = {};
for (let i = 0; i < merged.length; i++) { const a = Math.max(merged[i].t, t0), b = i + 1 < merged.length ? merged[i + 1].t : t1; if (b > a) share[merged[i].ph] = (share[merged[i].ph] || 0) + (b - a); }
const shareTotal = Object.values(share).reduce((x, y) => x + y, 0) || 1;
const ev = run.events;
const batches = ev.filter((e) => e.type === 'batch' && !e.user);
const doses = ev.filter((e) => e.type === 'chemical' && !e.user);
const warns = ev.filter((e) => e.type === 'warning');
console.log(`\nScript v3 on the device mock: ${batches.length} batches, ${doses.length} doses, unknown phase ${(100 * (share.unknown || 0) / shareTotal).toFixed(1)} % of the time`);
const showAll = verbose || merged.length <= 80;
const list = showAll ? merged : merged.slice(0, 40).concat([null], merged.slice(-30));
for (let i = 0; i < list.length; i++) {
  const m = list[i];
  if (!m) { console.log('  ...'); continue; }
  const j = merged.indexOf(m);
  const end = j + 1 < merged.length ? merged[j + 1].t : t1;
  console.log(`  ${fmt(m.t)}  ${(m.cy + ' / ' + m.ph).padEnd(30)} ${dur(end - m.t)}`);
}
for (const w of warns) console.log(`  warning ${w.on ? 'on ' : 'off'} ${fmt(w.ts * 1000)} ${w.key}`);
for (const b of batches) console.log(`  batch ${b.n} at ${fmt(b.ts * 1000)}`);

// ---- the device's own phases, if recorded ----
const dev = rows.filter((r) => r.ph);
if (dev.length) {
  const trans = [];
  for (const r of dev) { const L = trans[trans.length - 1]; if (!L || L.ph !== r.ph || L.cy !== r.cy) trans.push({ t: r.since ? r.since * 1000 : r.t, ph: r.ph, cy: r.cy }); }
  // agreement: the mock's phase at the time the device's phase was read (10 s tolerance)
  const pi = { i: -1 };
  const at = (t) => R.valueAt(ph, t, pi);
  let n = 0, ok = 0;
  const conf = new Map();
  for (const r of dev) {
    if (r.t - t0 < 15 * 60e3) continue;   // the mock needs a while to find its place
    const a = at(r.t);
    n++;
    const pj = { i: -1 };
    if (a === r.ph || R.valueAt(ph, r.t - 10e3, pj) === r.ph) ok++;
    else { const k = `device ${r.ph} / mock ${a}`; conf.set(k, (conf.get(k) || 0) + 1); }
  }
  console.log(`\nDevice script phases in the recording: ${trans.length} changes; the mock agrees ${n ? (100 * ok / n).toFixed(2) + ' %' : '- (needs over 15 min)'} of the readings`);
  for (const [k, c] of [...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${k}: ${c} readings`);
  if (verbose) for (const tr of trans) console.log(`  ${fmt(tr.t)}  ${tr.cy} / ${tr.ph}`);
}
if (verbose) for (const l of run.logs) console.log('  log ' + fmt(l.t) + ' ' + l.s);
