// Validate harness + script against device-recorded statuses and expected batch counts.
'use strict';
const H = require('./harness');
const script = process.argv[2] || 'puhdistamo_skripti_v2_3.js';
const only = process.argv[3];
const SETS = [
  { f: 'history__uponor_2_.csv', batches: 11 },
  { f: 'history__23_simu.csv', batches: 4 },
  { f: 'history__24_.csv', batches: 2 },
  { f: 'history__26_.csv', batches: 1 },
  { f: 'history__28_.csv', batches: 2 },
  { f: 'history__9_.csv', batches: 9 },
  { f: 'history__11_.csv', batches: null },
];
const fmt = (t) => new Date(t).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
for (const S of SETS) {
  if (only && S.f.indexOf(only) < 0) continue;
  const csv = H.loadCsv('data/' + S.f);
  const feed = H.feedFromCsv(csv);
  const dev = H.deviceSeries(csv);
  const T0 = Date.now();
  const log = H.runScript({ scriptPath: script, events: feed.events, quiet: true });
  const dt = ((Date.now() - T0) / 1000).toFixed(1);
  const batches = +JSON.parse(log.kvs.puhdistamo_batch_count);
  let devB = null;
  if (dev.batch.length) { const v = dev.batch.map((r) => +r.v).filter((x) => !isNaN(x)); devB = v[v.length - 1] - v[0]; }
  // status comparison with device
  let cmp = '';
  if (dev.status.length) {
    const simT = log.status.map((r) => ({ t: r.t, v: H.KEYS[r.v] }));
    const devT = []; for (const r of dev.status) { if (r.v === 'unavailable' || r.v === 'unknown') continue; const l = devT[devT.length - 1]; if (!l || l.v !== r.v) devT.push(r); }
    const from = Math.max(simT.length ? simT[0].t : 0, feed.events[0].t) + 3600e3; // skip first hour (startup)
    let ok = 0, n = 0; const bad = [];
    for (const d of devT) {
      if (d.t < from) continue; n++;
      const m = simT.find((s) => s.v === d.v && Math.abs(s.t - d.t) <= 30e3);
      if (m) ok++; else bad.push(fmt(d.t) + ' ' + d.v);
    }
    cmp = `device transitions matched ${ok}/${n}` + (bad.length ? `  first misses: ${bad.slice(0, 4).join(' | ')}` : '');
  }
  console.log(`${S.f.padEnd(24)} ${feed.raw ? 'raw+U' : 'norm '} batches ${batches}${S.batches != null ? ' (exp ' + S.batches + ')' : ''}${devB != null ? ' device +' + devB : ''}  ${cmp}  [${dt}s, rpc ${log.calls}]`);
}
