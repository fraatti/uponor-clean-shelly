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
