// The app's picture view against the WebSocket mock: the Home Assistant card runs on the app's
// stand-in for Home Assistant. Needs Playwright with Chromium.
//   node test/app_picture_test.js
// Checks: the card shows the script's phase, reads the power history (EM1Data) and the energy meter,
// keeps the observed phases in the browser, enters the chemical and the sludge counter through
// Number.Set, follows the app language, and the Details view still works.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('skip: playwright not installed'); process.exit(0); }

const APP = path.join(__dirname, '..', 'app', 'uponor-clean-app.html');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

function startMock(port) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'shelly_ws_mock.js'), '--port', String(port), '--days', '2'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (/http:\/\//.test(out)) resolve(p); });
    p.on('exit', (c) => reject(new Error('mock exited ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('mock did not start\n' + out)), 120000);
  });
}
const cardInfo = (page) => page.evaluate(() => {
  const c = document.querySelector('uponor-clean-card'), r = c && c.shadowRoot;
  const t = (id) => (r && r.getElementById(id) ? r.getElementById(id).textContent : null);
  return { card: !!c, side: !!(r && r.querySelector('svg.side')), name: t('st-name'), kv: r ? r.getElementById('kv').innerText : '',
    power: c ? c._model.power.length : 0, status: c ? c._model.status.map((e) => e.v) : [], loaded: c ? c._loaded : false,
    appPhase: window.__ucApp.S.state && window.__ucApp.S.state.phase };
});

(async () => {
  const mock = await startMock(8089);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP + '?host=127.0.0.1:8089&lang=fi');
    await page.waitForFunction(() => window.__ucApp && window.__ucApp.S.connected && window.__ucApp.S.lastTs && window.__ucApp.S.etotal, null, { timeout: 60000 });
    await page.waitForFunction(() => { const c = document.querySelector('uponor-clean-card'); return c && c._loaded && c._model.power.length > 1000; }, null, { timeout: 30000 });
    // the card rebuilds its model on its own schedule
    await page.waitForFunction(() => { const r = document.querySelector('uponor-clean-card').shadowRoot; return /kWh/.test(r.getElementById('kv').innerText) && !/Tuntematon|Unknown/.test(r.getElementById('st-name').textContent); }, null, { timeout: 30000 }).catch(() => {});
    let i = await cardInfo(page);
    check(i.card && i.side, 'picture view shows the card with the side view');
    check(await page.evaluate(() => document.body.classList.contains('pic') && getComputedStyle(document.getElementById('main')).display === 'none'), 'picture view is the default, the details are hidden');
    check(i.status.length >= 1 && i.status[i.status.length - 1] === i.appPhase, 'card phase = script phase (' + i.appPhase + ')');
    check(!!i.name && i.name !== '–', 'phase on the card: ' + i.name);
    check(i.power > 2000, 'power history from EM1Data: ' + i.power + ' points');
    check(/kWh\/vrk/.test(i.kv), 'energy per day from the energy meter: ' + (i.kv.match(/[\d,]+ kWh\/vrk/) || [''])[0]);

    // a new browser: the past phases come from the minute power, the batches from their pump-outs
    await page.waitForFunction(() => { const m = document.querySelector('uponor-clean-card')._model; return m.status.length > 50 && m.stats && m.stats.count7 > 0; }, null, { timeout: 30000 }).catch(() => {});
    const past = await page.evaluate(() => {
      const m = document.querySelector('uponor-clean-card')._model, now = Date.now();
      const kinds = new Set(m.status.map((e) => e.v));
      return { n: m.status.length, hours: (now - m.status[0].t) / 3600e3, kinds: [...kinds].sort().join(','), count7: m.stats.count7, perDay: m.stats.perDay,
        counted: window.__ucApp.S.state.batches - 240, seen: JSON.parse(localStorage.getItem('uc_app_hist:127.0.0.1:8089') || '{}').seen };
    });
    check(past.n > 50 && past.hours > 40, 'timeline from the minute power: ' + past.n + ' phases over ' + past.hours.toFixed(0) + ' h');
    check(['aeration', 'pump_in', 'pump_out', 'sedimentation_1', 'waiting'].every((k) => past.kinds.split(',').includes(k)), 'phases read: ' + past.kinds);
    check(past.count7 > 0 && Math.abs(past.count7 - past.counted) <= 1, 'batches in 7 days ' + past.count7 + ' (the script counted ' + past.counted + ' since its start), ' + (past.perDay || 0).toFixed(1) + '/day');
    // what this browser saw while connected goes before the minute power; outside, the power is used
    const mg = await page.evaluate(() => {
      const { H } = window.__ucApp.hist(), now = Date.now(), at = (a, t) => { let r = null; for (const e of a) if (e[0] <= t) r = e[1]; return r; };
      const s0 = H.seen.slice(), p0 = H.s.phase.slice();
      H.seen.unshift([now - 30 * 3600e3, now - 29 * 3600e3]);
      H.s.phase.unshift([now - 30.2 * 3600e3, 'mixing']);
      const v = window.__ucApp.hist().view;
      const r = { inSpan: at(v.phase, now - 29.5 * 3600e3), before: at(v.phase, now - 30.5 * 3600e3), nowPh: at(v.phase, now), state: window.__ucApp.S.state.phase,
        lastBatch: v.batch_counter[v.batch_counter.length - 1][1], batches: String(window.__ucApp.S.state.batches) };
      H.seen.splice(0, H.seen.length, ...s0); H.s.phase.splice(0, H.s.phase.length, ...p0);
      return r;
    });
    check(mg.inSpan === 'mixing' && mg.before !== 'mixing', 'seen span wins over the power reading: ' + mg.before + ' -> ' + mg.inSpan);
    // the same phase before and after a break: the browser stores it once, the break still comes from the power
    const br = await page.evaluate(() => {
      const { H } = window.__ucApp.hist(), now = Date.now(), cur = window.__ucApp.S.state.phase;
      const s0 = H.seen.slice(), p0 = H.s.phase.slice();
      H.seen.unshift([now - 12 * 3600e3, now - 10 * 3600e3, now - 12 * 3600e3]);
      H.s.phase.splice(0, H.s.phase.length, [now - 12 * 3600e3, cur]);
      const v = window.__ucApp.hist().view.phase, start = s0[0][0];
      const r = { inGap: v.filter((e) => e[0] > now - 10 * 3600e3 && e[0] < start).length, first: v.find((e) => e[0] >= now - 12 * 3600e3 - 1)[1], cur };
      H.seen.splice(0, H.seen.length, ...s0); H.s.phase.splice(0, H.s.phase.length, ...p0);
      return r;
    });
    check(br.first === br.cur && br.inGap > 5, 'a break between two spans with the same phase: ' + br.inGap + ' phases from the power in the break');
    check(mg.nowPh === mg.state && mg.lastBatch === mg.batches, 'now: phase ' + mg.nowPh + ', batch counter ' + mg.lastBatch + ' = script');
    // the chemical and the sludge counter back in time from the doses and batches (the mock set them
    // to 12 l and 300 at its start), shown when the timeline is moved back
    const cs = await page.evaluate(async () => {
      const c = document.querySelector('uponor-clean-card'), m = c._model, now = Date.now(), s = window.__ucApp.S.state;
      const at = (a, t) => { let r = null; for (const e of a) if (e.t <= t) r = e.v; return r; };
      const r = { chem0: m.chem.length ? parseFloat(m.chem[0].v) : null, sludge0: m.sludge.length ? parseFloat(m.sludge[0].v) : null,
        hours: m.chem.length ? (now - m.chem[0].t) / 3600e3 : 0, chemNow: parseFloat(at(m.chem, now)), chemState: s.chemical.l, sludgeNow: parseFloat(at(m.sludge, now)), sludgeState: s.sludge.n };
      c._cursor = now - 3 * 3600e3; c._playing = false; c._lastChips = 0;
      await new Promise((res) => setTimeout(res, 2500));
      r.kv = c.shadowRoot.getElementById('kv').innerText.replace(/\n/g, ' ');
      c._goLive();
      return r;
    });
    check(Math.abs(cs.chem0 - 12) < 0.05 && cs.hours > 40 && cs.chemNow === cs.chemState, 'chemical back in time: ' + cs.chem0 + ' l ' + cs.hours.toFixed(0) + ' h ago, now ' + cs.chemNow + ' l = script');
    check(Math.abs(cs.sludge0 - 300) <= 1 && cs.sludgeNow === cs.sludgeState, 'sludge counter back in time: ' + cs.sludge0 + ', now ' + cs.sludgeNow + ' = script');
    check(/Kemikaali ≈ [\d,]+ l/.test(cs.kv) && /Lietemuistutus \d+/.test(cs.kv), 'history view shows the chemical and the sludge: ' + (cs.kv.match(/Kemikaali[^A-ZÄÖ]*/) || [''])[0].trim());

    // a dropped connection: the app connects again, keeps the power history it has and starts a new span
    const rc0 = await page.evaluate(() => ({ recs: window.__ucApp.S.recs.size, spans: window.__ucApp.hist().H.seen.length }));
    await page.evaluate(() => window.__ucApp.rpc.ws.close());
    await page.waitForFunction((n) => window.__ucApp.S.connected && window.__ucApp.hist().H.seen.length > n && !window.__ucApp.S.histBusy, rc0.spans, { timeout: 30000 });
    const rc1 = await page.evaluate(() => ({ recs: window.__ucApp.S.recs.size, spans: window.__ucApp.hist().H.seen.length }));
    check(rc1.recs >= rc0.recs - 1 && rc1.spans === rc0.spans + 1, 'reconnect: power history kept (' + rc0.recs + ' -> ' + rc1.recs + ' minutes), spans ' + rc0.spans + ' -> ' + rc1.spans);

    // observed phases are kept in the browser
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('uc_app_hist:127.0.0.1:8089') || '{}'));
    await page.waitForTimeout(3500);
    const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('uc_app_hist:127.0.0.1:8089') || '{}'));
    check(!!(stored2.s && stored2.s.phase && stored2.s.phase.length), 'history stored in the browser: ' + JSON.stringify((stored2.s || stored.s || {}).phase || []));

    // the chemical and the sludge counter through the card's editors -> Number.Set
    const r = await page.evaluate(async () => {
      const c = document.querySelector('uponor-clean-card');
      await c.hass.callService('number', 'set_value', { entity_id: 'number.uc_chemical', value: 15.5 });
      await c.hass.callService('number', 'set_value', { entity_id: 'number.uc_sludge', value: 0 });
      let bad = null; try { await c.hass.callService('light', 'turn_on', {}); } catch (e) { bad = e.message; }
      return { bad };
    });
    await page.waitForFunction(() => { const s = window.__ucApp.S.state; return s && s.chemical.l === 15.5 && s.sludge.n === 0; }, null, { timeout: 15000 });
    check(true, 'Number.Set: chemical 15.5 l, sludge 0');
    check(/unsupported/.test(r.bad || ''), 'other services are refused: ' + r.bad);
    await page.waitForTimeout(1500);
    i = await cardInfo(page);
    check(/15,5 l/.test(i.kv), 'card shows the new chemical amount');

    // language follows the app
    await page.click('#setb');
    await page.selectOption('#d-lang', 'en');
    await page.click('#d-ok');
    await page.waitForFunction(() => { const c = document.querySelector('uponor-clean-card'); return c && /Batches/.test(c.shadowRoot.getElementById('kv').innerText); }, null, { timeout: 15000 });
    check(true, 'card language follows the app (en)');

    // details view
    await page.click('#v-data');
    check(await page.evaluate(() => getComputedStyle(document.getElementById('main')).display !== 'none' && getComputedStyle(document.getElementById('pic')).display === 'none'), 'details view shows the app sections');
    check(await page.evaluate(() => localStorage.getItem('uc_app_view') === 'data'), 'the view is remembered');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    console.log('FAIL ' + (e.stack || e)); fails++;
  } finally {
    mock.kill(); await browser.close();
  }
  console.log(fails ? fails + ' failed' : 'all ok');
  process.exit(fails ? 1 : 0);
})();
