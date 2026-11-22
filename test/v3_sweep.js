// Power-cut and restart sweep of v3: every phase of the cleaning, waiting and holiday cycles at three
// points (early, middle, late), with power cuts of the plant and the Shelly together (1 s - 5 h),
// of the plant only (2 s - 5 h), a Shelly software reboot (also with the clock not set for 60 s)
// and a 2 min script stop. Each run is compared with the simulator's true phases for 4 h after the
// power returns. 912 runs take about 20 min on one core; shards run in parallel:
//   node test/v3_sweep.js run <shard> <nShards> [out dir] [id filter]
//   node test/v3_sweep.js table [out dir]
// Output: <out dir>/sweep_out_<shard>.jsonl (default out dir: test/sweep_out, not in git).
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./v3ext');
const B = L;
const { T0, H } = L;
const cmd = process.argv[2];
const DIR = path.resolve(process.argv[cmd === 'table' ? 3 : 5] || path.join(__dirname, 'sweep_out'));

function phaseList(base) {
  const sim = B.simFor(base, {}, 14 * 3600);
  const gt = sim.gt;
  const pick = [];
  for (let i = 0; i < gt.length - 1; i++) {
    const g = gt[i], L_ = (gt[i + 1].t - g.t) / 1000;
    const tt = (g.t - T0) / 1000;
    if (base === 'cleaning' && g.cyc === 'cleaning' && tt < 11000) pick.push({ cyc: g.cyc, ph: g.ph, t: g.t, len: L_ });
    if (base === 'waiting' && g.cyc === 'waiting' && tt >= 15283 && tt < 18824) pick.push({ cyc: g.cyc, ph: g.ph, t: g.t, len: L_ });
    if (base === 'holiday' && g.cyc === 'holiday' && tt >= 10261 && tt < 20522) pick.push({ cyc: g.cyc, ph: g.ph + (g.ph === 'waiting' ? (tt < 13000 ? '(w1)' : '(w2)') : ''), t: g.t, len: L_ });
  }
  return pick;
}

const MODES = [];
for (const d of [1, 5, 30, 300, 3600, 18000]) MODES.push({ name: 'both_' + d, kind: 'both', dur: d });
for (const d of [2, 5, 8, 60, 600, 18000]) MODES.push({ name: 'plant_' + d, kind: 'plant', dur: d });
MODES.push({ name: 'sw_reboot', kind: 'sw' });
MODES.push({ name: 'sw_reboot_unsync60', kind: 'sw', unsyncS: 60 });
MODES.push({ name: 'script_stop120', kind: 'stop', durMs: 120e3 });
MODES.push({ name: 'both_30_unsync300', kind: 'both', dur: 30, unsyncS: 300 });

const jobs = [];
for (const base of ['cleaning', 'waiting', 'holiday']) {
  for (const p of phaseList(base)) {
    const q = Math.min(15, Math.floor(p.len / 4));
    const offs = [...new Set([q || 1, Math.floor(p.len / 2), Math.max(1, Math.floor(p.len - (q || 1)))])];
    for (const off of offs) for (const m of MODES) jobs.push({ base, cyc: p.cyc, ph: p.ph, off, at: p.t + off * 1000, mode: m });
  }
}

if (cmd === 'run') sweep(Number(process.argv[3] || 0), Number(process.argv[4] || 1), process.argv[6]);
else if (cmd === 'table') table();
else console.log('usage: node test/v3_sweep.js run <shard> <nShards> [out dir] [filter] | table [out dir]');

function sweep(shard, nShards, filter) {
  fs.mkdirSync(DIR, { recursive: true });
  const OUT = path.join(DIR, `sweep_out_${shard}.jsonl`);
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  let k = 0;
  for (let j = 0; j < jobs.length; j++) {
    if (j % nShards !== shard) continue;
    const J = jobs[j];
    const id = `${J.base}|${J.cyc}/${J.ph}+${J.off}|${J.mode.name}`;
    if (filter && !id.includes(filter)) continue;
    const M = J.mode;
    const cutDur = M.kind === 'both' || M.kind === 'plant' ? M.dur : 0;
    const durS = Math.ceil((J.at - T0) / 1000 + cutDur + 4 * 3600);
    const sim = B.simFor(J.base, M.kind === 'both' || M.kind === 'plant' ? { powerCuts: [{ at: J.at, dur: M.dur }] } : {}, durS);
    const extra = { unsyncS: M.unsyncS };
    let tBack;
    if (M.kind === 'both') {
      const off = sim.marks.find((m) => /power cut/.test(m.s)), on = sim.marks.find((m) => /power back/.test(m.s));
      extra.shellyCuts = [{ off: off.t, on: on.t }];
      tBack = on.t;
    } else if (M.kind === 'plant') tBack = sim.marks.find((m) => /power back/.test(m.s)).t;
    else if (M.kind === 'sw') { extra.swReboots = [{ at: J.at, offMs: 8000, rr: 3 }]; tBack = J.at + 11000; }
    else if (M.kind === 'stop') { extra.scriptStops = [{ at: J.at, durMs: M.durMs }]; tBack = J.at + M.durMs; }
    let res;
    try {
      const run = L.runExt(B.runOpts(J.base, sim, extra));
      res = L.evaluate(sim, run, tBack, Math.min(sim.tEnd, tBack + 4 * H), { dosesFrom: T0 + 120e3 });
      // the script's phase sequence right after power back (first 6 changes)
      const ph = L.timeline(run.changes, 'phase').filter((c) => c.t >= tBack - 20e3).slice(0, 6).map((c) => `${Math.round((c.t - tBack) / 1000)}:${c.v}`);
      res.after = ph.join(' ');
      res.logs = run.logs.filter((l) => l.t >= J.at - 1000 && /sync lost|resumed|cleaning cycle|continued|stored|batch/.test(l.s)).slice(0, 6).map((l) => `${Math.round((l.t - tBack) / 1000)}:${l.s.replace('[uc] ', '')}`);
    } catch (e) { res = { error: String(e && e.stack || e).slice(0, 400) }; }
    fs.appendFileSync(OUT, JSON.stringify(Object.assign({ id, base: J.base, phase: `${J.cyc}/${J.ph}`, off: J.off, mode: M.name }, res)) + '\n');
    if (++k % 20 === 0) console.log(shard, k, id);
}
console.log('done', shard, k, 'of', jobs.length);
}

// one row per mode and cycle type
function table() {
  const rows = [];
  for (const f of fs.readdirSync(DIR).filter((x) => /^sweep_out_\d+\.jsonl$/.test(x)))
    for (const l of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) if (l.trim()) rows.push(JSON.parse(l));
  const ORDER = ['both_1', 'both_5', 'both_30', 'both_300', 'both_3600', 'both_18000', 'both_30_unsync300', 'plant_2', 'plant_5', 'plant_8', 'plant_60', 'plant_600', 'plant_18000', 'sw_reboot', 'sw_reboot_unsync60', 'script_stop120'];
  const short = (r) => r.base[0] + ':' + r.phase.split('/')[1] + '+' + r.off;
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : '-'; };
  console.log('| Mode | Cycle | Runs | Recovery median / max | Longest unknown | Wrong phase > 5 min | Batches missed / extra | Doses missed (not counting doses cut mid-dosing) | Unexpected warnings | ETA wrong > 10 min / missing > 30 min |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const m of ORDER) for (const base of ['cleaning', 'waiting', 'holiday']) {
    const R = rows.filter((r) => r.mode === m && r.base === base && !r.error);
    if (!R.length) continue;
    const rec = R.map((r) => (r.recovS === null ? 99999 : r.recovS));
    const wrongRuns = R.filter((r) => r.wrong > 300).map(short);
    const mb = R.filter((r) => r.missB).map(short), eb = R.filter((r) => r.extraB).map(short);
    const md = R.filter((r) => r.missD && !(/dosing/.test(r.phase) && /^(both|plant)/.test(r.mode))).map(short);
    const expW = /^plant_/.test(m) && Number(m.split('_')[1]) >= 60 ? ['no_power'] : [];
    const uw = {};
    for (const r of R) for (const k of Object.keys(r.warnings || {})) if (!expW.includes(k)) (uw[k] = uw[k] || []).push(short(r));
    const etaBad = R.filter((r) => r.etaMaxErr > 600).map(short), etaNull = R.filter((r) => r.etaNullS > 1800).map(short);
    const lst = (a) => (a.length ? a.length + (a.length <= 4 ? ' (' + a.join(', ') + ')' : '') : '0');
    console.log(`| ${m} | ${base} | ${R.length} | ${med(rec)} s / ${Math.max(...rec) === 99999 ? 'none in 4 h' : Math.round(Math.max(...rec) / 60) + ' min'} | ${Math.round(Math.max(...R.map((r) => r.maxUnkRunS || 0)) / 60)} min | ${lst(wrongRuns)} | ${lst(mb)} / ${lst(eb)} | ${lst(md)} | ${Object.keys(uw).map((k) => k + ' ' + uw[k].length).join(', ') || '-'} | ${etaBad.length} / ${etaNull.length} |`);
}
const errs = rows.filter((r) => r.error); if (errs.length) console.log('errors', errs.length, errs[0].id, errs[0].error);
console.log(`\n${rows.length} runs, uncaught errors in ${rows.filter((r) => r.uncaught).length}`);
}
