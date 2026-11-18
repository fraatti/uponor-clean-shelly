// 1) v2.4 with all v24_* flags false must produce exactly the same outputs as v2.3.
// 2) v2.4 (flags on): batch counts, device match, early ETA coverage, pump-out length, waiting status, holiday timing.
'use strict';
const H = require('./harness');
const fs = require('fs');
const V23 = fs.readFileSync(process.argv[2] || 'puhdistamo_skripti_v2_3.js', 'utf8');
const V24 = fs.readFileSync(process.argv[3] || 'puhdistamo_skripti_v2_4.js', 'utf8');
const off = (c) => c.replace(/(v24_\w+):\s*true/g, '$1: false');
const fmt = (t) => new Date(t).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
const SETS = [
  { f: 'history__uponor_2_.csv', batches: 11 }, { f: 'history__23_simu.csv', batches: 4 }, { f: 'history__24_.csv', batches: 2 },
  { f: 'history__26_.csv', batches: 1 }, { f: 'history__28_.csv', batches: 2 }, { f: 'history__9_.csv', batches: 9 },
  { f: 'history__11_.csv', batches: 20, t0: Date.parse('2026-10-08T01:12:00Z'),
    reboots: null },
];
const W_OPTS = ['U', 'F', 'A', 'C', 'S', 'R', 'D', 'W'];
let allOk = true;
for (const S of SETS) {
  const csv = H.loadCsv('data/' + S.f);
  const feed = H.feedFromCsv(csv);
  const reboots = (csv['button.uponor_clean_1_restart'] || []).map((r) => r.t).filter((t) => !S.t0 || t > S.t0);
  const base = { events: feed.events, t0: S.t0, quiet: false, reboots };
  const a = H.runScript(Object.assign({ code: V23 }, base));
  const b = H.runScript(Object.assign({ code: off(V24) }, base));
  const same = JSON.stringify([a.status, a.msg, a.batch]) === JSON.stringify([b.status, b.msg, b.batch]);
  if (!same) allOk = false;
  const c = H.runScript(Object.assign({ code: V24, enumOptions: W_OPTS }, base));
  const n23 = +JSON.parse(a.kvs.puhdistamo_batch_count), n24 = +JSON.parse(c.kvs.puhdistamo_batch_count);
  // early ETA: for every trip ETA print, find ETA source
  const etas = c.prints.filter((p) => /ETA set/.test(p.s));
  const trips = etas.filter((p) => /fill -> aeration|restart/.test(p.s)).length;
  const dosingEta = etas.filter((p) => /Kohta1 dosing/.test(p.s)).length;
  const etas23 = a.prints.filter((p) => /ETA set/.test(p.s));
  const early23 = etas23.filter((p) => /peaks/.test(p.s)).length;
  // discharge durations (D status segments) v2.4
  const segs = H.segments(c.status, Infinity).filter((g) => g.v === 'D' && g.t1 !== Infinity).map((g) => Math.round((g.t1 - g.t0) / 1000));
  const segs23 = H.segments(a.status, Infinity).filter((g) => g.v === 'D' && g.t1 !== Infinity).map((g) => Math.round((g.t1 - g.t0) / 1000));
  const wcount = c.status.filter((r) => r.v === 'W').length;
  const warn = c.prints.filter((p) => /PROCESS WARNING: Warning/.test(p.s)).map((p) => fmt(p.t) + ' ' + p.s);
  const maint = c.prints.filter((p) => /MAINTENANCE MODE ON/.test(p.s)).map((p) => fmt(p.t) + ' ' + p.s.replace('MAINTENANCE MODE ON: ', ''));
  const maint23 = a.prints.filter((p) => /MAINTENANCE MODE ON/.test(p.s)).map((p) => fmt(p.t));
  console.log(`\n== ${S.f}`);
  console.log(`  flags off == v2.3: ${same ? 'IDENTICAL' : 'DIFFERENT'}   (status ${a.status.length}/${b.status.length}, msg ${a.msg.length}/${b.msg.length})`);
  console.log(`  batches v2.3 ${n23}  v2.4 ${n24}  expected ${S.batches}`);
  console.log(`  early ETA at batch start: v2.3 ${early23}, v2.4 ${trips}   (dosing-ETA events v2.4 ${dosingEta})`);
  console.log(`  pump-out lengths v2.3 [${[...new Set(segs23)].sort((x, y) => x - y).join(',')}]  v2.4 [${[...new Set(segs)].sort((x, y) => x - y).join(',')}]`);
  console.log(`  Waiting (W) periods ${wcount}; holiday ON v2.3 ${maint23.join(', ') || '-'} | v2.4 ${maint.join(', ') || '-'}`);
  console.log(`  warnings: ${warn.length ? warn.join(' ; ') : 'none'}`);
  if (S.reboots !== undefined || reboots.length) console.log(`  reboots simulated: ${reboots.map(fmt).join(', ') || '-'}`);
  if (process.env.DUMP === S.f) fs.writeFileSync('/tmp/claude-0/-home-claude/c1f5f5b4-40bf-5c20-b6d3-3583f9920dfc/scratchpad/dump_' + S.f + '.json', JSON.stringify({ a, c }, null, 0));
}
console.log('\nALL flags-off identical:', allOk);
