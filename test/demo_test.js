// The online demo (demo/index.html): the app connects to the demo Shelly, loads the week's power
// history, shows the recorded plant in the picture and the details view, and the chemical can be
// entered. Needs Playwright (Chromium); the page is opened from the file system.
// Usage: node test/demo_test.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '..', 'demo', 'index.html');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(PAGE + '?lang=fi');
  await p.waitForFunction(() => window.__ucApp && window.__ucApp.S.connected && window.__ucApp.S.state, null, { timeout: 30000 });
  check(new URL(p.url()).searchParams.get('host') === 'demo', 'the address gets host=demo');
  const st = await p.evaluate(() => window.__ucApp.S.state);
  check(st.phase && st.phase !== 'unknown' && st.cycle && st.cycle !== 'unknown', 'script state: ' + st.cycle + ' / ' + st.phase);
  check(typeof st.batches === 'number' && st.batches > 150, 'batch counter ' + st.batches);
  check(Math.abs(st.since - Date.now() / 1000) < 6 * 3600 && st.since <= Date.now() / 1000 + 5, 'phase start moved to today');
  check(await p.evaluate(() => /Demo/.test(document.getElementById('demo-note').innerText) && /tallennettu data/.test(document.getElementById('demo-note').innerText)), 'demo note in Finnish');
  check(await p.evaluate(() => !document.getElementById('uc-demo') && !document.getElementById('uc-demo-data')), 'demo scripts removed from the page');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('d-inst')).display === 'none'), 'install section hidden');

  // the week of minute power
  await p.waitForFunction(() => window.__ucApp.S.recs.size > 7 * 1440 * 0.95 && !window.__ucApp.S.histBusy, null, { timeout: 60000 });
  const recs = await p.evaluate(() => { const r = [...window.__ucApp.S.recs.entries()].sort((a, b) => a[0] - b[0]); return { n: r.length, first: r[0][0], last: r[r.length - 1][0] }; });
  check(Date.now() / 1000 - recs.last < 180 && recs.last - recs.first > 6.9 * 86400, `power history ${recs.n} minutes up to ${Math.round(Date.now() / 1000 - recs.last)} s ago`);
  // the picture: past phases worked out from the minute power, batches on the timeline
  await p.waitForFunction(() => { const c = document.querySelector('uponor-clean-card'); return c && c._model && c._model.segs && c._model.segs.length > 100; }, null, { timeout: 60000 });
  const pic = await p.evaluate(() => { const c = document.querySelector('uponor-clean-card'); return { segs: c._model.segs.length, kv: c.shadowRoot.getElementById('kv').innerText }; });
  check(pic.segs > 100, 'picture timeline ' + pic.segs + ' segments');
  check(/kWh/.test(pic.kv) && /Panokset/.test(pic.kv), 'picture figures shown');

  // entering the chemical on the card goes to the demo Shelly
  await p.evaluate(() => { const c = document.querySelector('uponor-clean-card'); c._openChem(); c.shadowRoot.getElementById('chem-in').value = '12'; c._saveChem(); });
  await p.waitForFunction(() => window.__ucApp.S.state.chemical && window.__ucApp.S.state.chemical.l === 12, null, { timeout: 15000 }).catch(() => {});
  check(await p.evaluate(() => window.__ucApp.S.state.chemical.l === 12), 'chemical entered: 12 l');

  // the details view, live power
  await p.click('#v-data');
  await p.waitForTimeout(1500);
  const data = await p.evaluate(() => ({ pw: document.getElementById('tv-power') ? document.getElementById('tv-power').innerText : '', chem: document.getElementById('tv-chem').innerText }));
  check(/W/.test(data.pw) && /12/.test(data.chem), 'details view: ' + data.pw.replace(/\s+/g, ' ') + ', chemical ' + data.chem.replace(/\s+/g, ' '));
  check(await p.evaluate(() => /Kemikaali asetettu: 12/.test(document.body.innerText)), 'event list shows the entry');

  // English
  const q = await b.newPage({ viewport: { width: 390, height: 844 } });
  q.on('pageerror', (e) => errors.push(String(e)));
  await q.goto(PAGE + '?lang=en');
  await q.waitForFunction(() => window.__ucApp && window.__ucApp.S.connected && document.getElementById('demo-note'), null, { timeout: 30000 });
  check(await q.evaluate(() => /Recorded data of a real Uponor Clean I/.test(document.getElementById('demo-note').innerText)), 'demo note in English (phone width)');
  check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll on a phone');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await b.close();
  console.log(fails ? fails + ' failed' : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
