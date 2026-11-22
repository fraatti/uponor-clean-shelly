// Builds the online demo of the browser app (demo/index.html and demo/data.js).
//
//   node app/tools/build_demo.js                      demo/index.html from the app and app/demo_shelly.js
//   node app/tools/build_demo.js --data <history.csv>  also demo/data.js from a Home Assistant history export
//
// demo/index.html is the app (app/uponor-clean-app.html) with demo/data.js and the demo Shelly (app/demo_shelly.js)
// before it; the app's https check lets the demo host through (GitHub Pages is https). The demo Shelly answers the app's WebSocket RPC from the recording.
//
// demo/data.js: the plant's power and voltage from the recording, and the v3 script's state and events
// worked out by running the script (shelly/v3/uponor_clean_v3.js) on the device mock over the same
// power (test/v3run.js). Only the numbers go in: no entity names, device ids or addresses.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const APP = path.join(root, 'app', 'uponor-clean-app.html');
const SHIM = path.join(root, 'app', 'demo_shelly.js');
const OUT = path.join(root, 'demo');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };

function buildData(csvPath) {
  const H = require(path.join(root, 'test', 'harness'));
  const R = require(path.join(root, 'test', 'v3run'));
  const csv = H.loadCsv(csvPath);
  const feed = H.feedFromCsv(csv);
  if (!feed.raw) throw new Error('the recording has no raw power (sensor.uponor_clean_1_power)');
  const pe = feed.events.filter((e) => e.p != null);
  // the first hours of a history export are hourly statistics: start at the first reading after a 30 min run of readings
  let i0 = 0;
  for (let i = 1; i < pe.length; i++) { if (pe[i].t - pe[i - 1].t > 1800e3) i0 = i; else if (pe[i].t - pe[i0].t > 1800e3) break; }
  const t0 = Math.ceil(pe[i0].t / 60e3) * 60e3;
  const t1 = Math.floor(pe[pe.length - 1].t / 1000) * 1000;
  // recording gaps over 10 min with power on both sides: the script starts again without a stored phase (as in v3_realdata.js)
  const gapEnds = [];
  for (let i = i0 + 1; i < pe.length; i++) if (pe[i].t - pe[i - 1].t > 600e3 && pe[i - 1].p > 2 && pe[i].p > 2) gapEnds.push(pe[i].t - 1000);
  const restarts = (csv['button.uponor_clean_1_restart'] || []).map((r) => r.t).filter((t) => t > t0);
  const bc = (csv['sensor.uponor_clean_1_vc_batch_counter'] || []).map((r) => ({ t: r.t, n: parseInt(r.v, 10) })).filter((r) => r.n >= 0);
  const firstAfter = bc.find((r) => r.t > t0);
  const batches0 = firstAfter ? firstAfter.n - 1 : 0;

  const tRun = Date.now();
  const run = R.runV3({
    events: feed.events.filter((e) => e.t >= t0 - 3600e3), t0, t1, voltage: 230, tzOffsetMin: 180,
    kvs: { uc_sludge: '{"n":300,"reset":null}' }, uptimeAtStartS: 86400, resetReason: 3,
    scriptRestarts: restarts, dataGapEnds: gapEnds, sampleMs: 5000,
    userSets: [{ at: t0 + 120e3, role: 'batches', value: batches0 }, { at: t0 + 180e3, role: 'chemical', value: 14 }],
  });
  if (run.uncaught.length) throw new Error('script errors: ' + run.uncaught.map((u) => u.s).join(' | '));

  // power: [seconds since the previous change, W x 10, ...] from t0, one value per second at most
  const P = [];
  let prevS = Math.round(t0 / 1000), lastP = null;
  const pIn = pe.filter((e) => e.t >= t0 - 3600e3);
  const p0 = pIn.filter((e) => e.t <= t0).pop() || pIn[0];
  P.push(0, Math.round(p0.p * 10)); lastP = Math.round(p0.p * 10);
  for (const e of pIn) {
    if (e.t <= t0) continue;
    const s = Math.round(e.t / 1000), v = Math.round(e.p * 10);
    if (s === prevS && P.length > 2) { P[P.length - 1] = v; lastP = v; continue; }
    if (v === lastP) continue;
    P.push(s - prevS, v); prevS = s; lastP = v;
  }
  // voltage: the mean of each 10 minutes (V x 10), the previous one where a 10 minutes has no reading
  const U = [], ue = feed.events.filter((e) => e.u != null && e.t >= t0);
  let k = 0, last = 2300;
  for (let t = t0; t < t1; t += 600e3) {
    let s = 0, n = 0;
    while (k < ue.length && ue[k].t < t + 600e3) { s += ue[k].u; n++; k++; }
    if (n) last = Math.round(s / n * 10);
    U.push(last);
  }
  // the script state at every change (the power, the band and the uptime come from the demo Shelly)
  const KEEP = ['version', 'cycle', 'phase', 'code', 'since', 'eta', 'last_pumpout', 'batches', 'chemical', 'sludge', 'warnings', 'holiday_at', 'holiday_since', 'time_synced'];
  const pick = (s) => { const o = {}; for (const key of KEEP) o[key] = s[key] === undefined ? null : s[key]; return o; };
  const same = (a, b) => {
    for (const key of KEEP) {
      if (key === 'eta') { if ((a.eta === null) !== (b.eta === null) || Math.abs((a.eta || 0) - (b.eta || 0)) > 2) return false; } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
    return true;
  };
  const ST = [];
  let prev = null, prevT = Math.round(t0 / 1000);
  for (const x of run.states) {
    const s = pick(x.s);
    if (prev && same(prev, s)) continue;
    const ts = Math.round(x.t / 1000);
    const d = {};
    for (const key of KEEP) if (!prev || JSON.stringify(prev[key]) !== JSON.stringify(s[key])) d[key] = s[key];
    ST.push(ts - prevT, d); prev = s; prevT = ts;
  }
  // the script's events: [seconds since the previous one, data, ...]
  const EV = [];
  let prevE = Math.round(t0 / 1000);
  for (const e of run.events) {
    const ts = Math.round(e.t / 1000);
    const d = Object.assign({}, e); delete d.t;
    EV.push(ts - prevE, d); prevE = ts;
  }
  const vc = run.roles;
  const data = { t0: t0 / 1000, t1: t1 / 1000, uStep: 600, p: P, u: U, st: ST, ev: EV, vc, cfg: null };
  const text = '// Uponor Clean app demo: recorded power of a real Uponor Clean I (Home Assistant history, '
    + new Date(t0).toISOString().slice(0, 10) + ' – ' + new Date(t1).toISOString().slice(0, 10) + ')\n'
    + '// and the state of script v3 on that power. Built by app/tools/build_demo.js.\n'
    + 'window.UC_DEMO = ' + JSON.stringify(data) + ';\n';
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data.js'), text);
  console.log(`demo: data ${new Date(t0).toISOString()} – ${new Date(t1).toISOString()}, ${P.length / 2} power changes, ${ST.length / 2} states, `
    + `${EV.length / 2} events, ${(text.length / 1024).toFixed(0)} kB (script run ${((Date.now() - tRun) / 1000).toFixed(0)} s)`);
}

// demo/index.html: the app with the demo Shelly before its own scripts
function buildPage() {
  const app = fs.readFileSync(APP, 'utf8');
  const shim = fs.readFileSync(SHIM, 'utf8');
  if (/<\/script|<!--/i.test(shim)) throw new Error('demo_shelly.js contains </script or <!--');
  if (!fs.existsSync(path.join(OUT, 'data.js'))) throw new Error('demo/data.js missing: run with --data <history.csv>');
  const at = app.indexOf('<script id="uc-card">');
  if (at < 0) throw new Error('marker <script id="uc-card"> missing in the app');
  const head = '<script id="uc-demo-data" src="data.js"></script>\n<script id="uc-demo">\n' + shim.trim() + '\n</script>\n';
  let page = app.slice(0, at) + head + app.slice(at);
  // the one change to the app: GitHub Pages is https, where the app refuses ws:// to a Shelly; the demo host is not a Shelly
  const HTTPS = "if (location.protocol === 'https:') {";
  if (page.split(HTTPS).length !== 2) throw new Error('the https check of the app not found once');
  page = page.replace(HTTPS, "if (location.protocol === 'https:' && S.host !== window.__ucDemoHost) {");
  page = page.replace('<title>Uponor Clean</title>', '<title>Uponor Clean – demo</title>');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), page);
  console.log('demo: index.html ' + page.length + ' chars');
}

const csvPath = arg('data');
if (csvPath) buildData(path.resolve(csvPath));
buildPage();
