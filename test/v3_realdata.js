// v3 on recorded Home Assistant history: batches against v2.4 (same data), warnings,
// holiday, sludge-emptying hint and cycle/phase timeline.
// Usage: node v3_realdata.js [-v] [file filter]       (CSV files in test/data/)
'use strict';
const fs = require('fs');
const H = require('./harness');
const R = require('./v3run');

const verbose = process.argv.includes('-v');
const only = process.argv.slice(2).filter((a) => a !== '-v')[0];
const V24 = fs.readFileSync('puhdistamo_skripti_v2_4.js', 'utf8');
const fmt = (t) => new Date(t).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
const SETS = [
  // 9.7. maintenance: air hose blocked (high power), supply off twice, restart with high water
  { f: 'history__uponor_2_.csv', allowed: [{ from: Date.parse('2026-07-09T09:45:00Z'), to: Date.parse('2026-07-09T12:00:00Z'), keys: ['air_leak', 'no_power', 'high_water'] }] }, { f: 'history__23_simu.csv' }, { f: 'history__24_.csv' },
  { f: 'history__26_.csv' }, { f: 'history__28_.csv' },
  { f: 'history__9_.csv', holiday: Date.parse('2026-09-21T07:30:00Z'), emptying: ['2026-09-18', '2026-09-19'] },
  { f: 'history__11_.csv', t0: Date.parse('2026-10-08T01:12:00Z') },
];

let fails = 0;
for (const S of SETS) {
  if (only && !S.f.includes(only)) continue;
  if (!fs.existsSync('data/' + S.f)) { console.log('missing data/' + S.f); continue; }
  const csv = H.loadCsv('data/' + S.f);
  const feed = H.feedFromCsv(csv);
  const t0 = S.t0 || feed.events[0].t;
  const t1 = feed.events[feed.events.length - 1].t + 1000;
  const restarts = (csv['button.uponor_clean_1_restart'] || []).map((r) => r.t).filter((t) => t > t0);
  // gaps in the recording (not in the device's own readings) longer than 10 min, power on both sides
  const pe = feed.events.filter((e) => e.p != null && e.t >= t0);
  const gapEnds = [], gaps = [];
  for (let i = 1; i < pe.length; i++) if (pe[i].t - pe[i - 1].t > 600e3 && pe[i - 1].p > 2 && pe[i].p > 2) { gapEnds.push(pe[i].t - 1000); gaps.push([pe[i - 1].t, pe[i].t]); }

  // reference: v2.4 on the same feed
  const v24 = H.runScript({ code: V24, events: feed.events, t0, quiet: false, reboots: restarts, enumOptions: ['U', 'F', 'A', 'C', 'S', 'R', 'D', 'W'] });
  const b24 = v24.prints.filter((p) => /^BATCH \+1/.test(p.s)).map((p) => p.t);
  const hol24 = v24.prints.filter((p) => /MAINTENANCE MODE ON/.test(p.s)).map((p) => p.t);

  const run = R.runV3({
    events: feed.events.filter((e) => e.t >= t0 - 3600e3), t0, t1, voltage: 230, tzOffsetMin: 180,
    kvs: { uc_sludge: '{"n":300,"reset":null}' }, uptimeAtStartS: 86400, resetReason: 3,
    scriptRestarts: restarts, dataGapEnds: gapEnds, verbose,
  });
  const problems = [];
  if (run.uncaught.length) problems.push('uncaught: ' + run.uncaught.map((u) => u.s).join(' | '));
  const b3 = run.events.filter((e) => e.type === 'batch' && !e.user).map((e) => e.ts * 1000);
  // pair the batches: each v2.4 batch with the nearest v3 batch
  const dts = b24.map((t) => { const m = b3.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity); return Math.round((m - t) / 1000); });
  if (b3.length !== b24.length) problems.push(`batches v3 ${b3.length} != v2.4 ${b24.length}`);
  // v2.4 counts when it sees the pump-out end; v3 dates the batch to the firmware count (780 s)
  if (dts.some((d) => Math.abs(d) > 60)) problems.push('batch time differences ' + dts.join(','));

  const wEv = run.events.filter((e) => e.type === 'warning' && e.on);
  const cyc = R.timeline(run.changes, 'cycle');
  const holi = cyc.filter((c, i) => c.v === 'holiday' && (i === 0 || cyc[i - 1].v !== 'holiday')).map((c) => c.t);
  const since = [...new Set(run.states.map((x) => x.s.holiday_since).filter((x) => x))].map((x) => x * 1000);
  if (S.holiday) {
    const d = since.length ? (since[0] - S.holiday) / 60e3 : null;
    if (d === null || Math.abs(d) > 5) problems.push('holiday since ' + (since.map(fmt).join(',') || '-') + ', expected ' + fmt(S.holiday));
  }
  const hint = wEv.filter((e) => e.key === 'sludge_emptied').map((e) => e.t);
  if (S.emptying) {
    const days = hint.map((t) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10));
    if (!days.some((d) => S.emptying.includes(d))) problems.push('no sludge emptying hint on ' + S.emptying.join('/') + ' (hints: ' + (hint.map(fmt).join(',') || '-') + ')');
  }
  const allowedW = (e) => (S.allowed || []).some((w) => e.t >= w.from && e.t <= w.to && w.keys.includes(e.key));
  const inGap = (e) => gaps.some(([a, b]) => e.t >= a && e.t <= b);
  const unexpected = wEv.filter((e) => !(e.key === 'sludge_emptied' && S.emptying) && !allowedW(e) && !inGap(e));
  if (unexpected.length) problems.push('warnings: ' + unexpected.map((e) => `${e.key} ${fmt(e.t)}`).join(', '));
  // share of time per phase and the unknown share
  const ph = R.timeline(run.changes, 'phase');
  const share = {};
  for (let i = 0; i < ph.length; i++) { const a = Math.max(ph[i].t, t0), b = i + 1 < ph.length ? ph[i + 1].t : t1; if (b > a) share[ph[i].v] = (share[ph[i].v] || 0) + (b - a); }
  const total = Object.values(share).reduce((x, y) => x + y, 0);
  const unk = ((share.unknown || 0) / total) * 100;
  const lost = run.logs.filter((l) => /sync lost/.test(l.s));
  const ok = !problems.length; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${S.f}  ${fmt(t0)} - ${fmt(t1)}${gapEnds.length ? '  (recording gaps ending ' + gapEnds.map(fmt).join(', ') + ')' : ''}`);
  console.log(`      batches v3 ${b3.length} v2.4 ${b24.length} (v3 - v2.4 s: ${dts.join(',') || '-'}) | unknown ${unk.toFixed(2)} % | sync lost ${lost.length} | holiday v3 ${holi.map(fmt).join(',') || '-'} since ${since.map(fmt).join(',') || '-'} v2.4 ${hol24.map(fmt).join(',') || '-'} | emptying hint ${hint.map(fmt).join(',') || '-'}`);
  if (verbose || !ok) for (const l of lost.slice(0, 12)) console.log('        ' + fmt(l.t) + ' ' + l.s);
  for (const p of problems) console.log('      !! ' + p);
}
console.log(fails ? `\n${fails} data set(s) failed` : '\nall data sets passed');
process.exitCode = fails ? 1 : 0;
