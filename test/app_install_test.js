// End-to-end test of the app's "Install on the Shelly" button against the WebSocket mock.
// Needs Playwright with Chromium (npm install playwright; npx playwright install chromium).
//   node test/app_install_test.js
// 1. open app/uponor-clean-app.html as a file, connect to the mock, press Install
// 2. open the address the Shelly now serves: the app loads from the Shelly and connects
// 3. the served app sees the same version; installing in more parts and back to the usual split works
// 4. the Python tool removes extra parts; a full file system and three running scripts give errors;
//    an update fits where only the space of the deleted old app makes room; the Remove button
//    (the mock: detection script 1, at most 3 scripts running, --fs-free sets the free space)
'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('skip: playwright not installed'); process.exit(0); }

const root = path.join(__dirname, '..');
const APP = path.join(root, 'app', 'uponor-clean-app.html');
const appScript = (html) => /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(html)[1];
const VERSION = /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(APP, 'utf8'))[1];

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

function startMock(port, extra) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'shelly_ws_mock.js'), '--port', String(port), '--days', '1'].concat(extra || []), { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (/listening|http:\/\//.test(out)) resolve(p); });
    p.on('exit', (c) => reject(new Error('mock exited ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('mock did not start\n' + out)), 90000);
  });
}
async function openApp(browser, url) {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__ucApp && window.__ucApp.rpc.ws && window.__ucApp.rpc.ws.readyState === 1 && window.__ucApp.S.connected, null, { timeout: 30000 });
  return page;
}
async function pressInstall(page) {
  await page.click('#setb');
  await page.waitForFunction(() => !document.getElementById('d-inst-b').disabled, null, { timeout: 30000 });
  const before = await page.textContent('#d-inst-s');
  await page.click('#d-inst-b');
  await page.waitForFunction(() => { const t = document.getElementById('d-inst-s').textContent; return /^(Valmis|Done|Asennus ei|Installation failed)/.test(t); }, null, { timeout: 60000 });
  return { before, after: await page.textContent('#d-inst-s'), url: await page.evaluate(() => { const a = document.querySelector('#d-inst-s a'); return a ? a.href : null; }) };
}
const listScripts = (page) => page.evaluate(async () => (await window.__ucApp.rpc.call('Script.List')).scripts.map((s) => s.name + (s.running ? '*' : '')));

(async () => {
  const browser = await chromium.launch();
  let mock = await startMock(8091, ['--fs-free', '300000']);
  try {
    // 1. install from a file
    const file = await openApp(browser, 'file://' + APP + '?host=127.0.0.1:8091&lang=fi');
    const r = await pressInstall(file);
    check(/ei ole vielä asennettu/.test(r.before), 'before: ' + r.before);
    check(/^Valmis/.test(r.after) && /^http:\/\/127\.0\.0\.1:8091\/script\/\d+\/app$/.test(r.url), 'install: ' + r.after);
    const names0 = await listScripts(file);
    const dataParts = (l) => l.filter((n) => /^uponor-clean-app-data\d*$/.test(n)).length;
    const usual = dataParts(names0);
    check(/^uponor-clean-v3\*,uponor-clean-app-data(,uponor-clean-app-data\d)*,uponor-clean-app\*$/.test(String(names0)), 'scripts: ' + names0);

    // 2. the Shelly serves the app
    const served = await openApp(browser, r.url);
    const html = await served.evaluate(() => '<!doctype html>\n' + document.documentElement.outerHTML);
    check(appScript(html) === appScript(fs.readFileSync(APP, 'utf8')), 'served app has the same script as the file');
    check((await served.textContent('#foot')).includes(VERSION), 'served app version ' + VERSION);

    // 3. the served app sees its own version; more parts and back to the usual split
    await served.click('#setb');
    await served.waitForFunction(() => /tämä versio|this version/.test(document.getElementById('d-inst-s').textContent), null, { timeout: 30000 });
    check(true, 'served app: ' + (await served.textContent('#d-inst-s')));
    const three = await file.evaluate(() => window.__ucApp.installApp({ partMax: 9000 }));
    check(three.parts > usual, 'install in ' + three.parts + ' parts (usually ' + usual + ')');
    const servedParts = await openApp(browser, r.url);
    check(await servedParts.evaluate(() => !!window.__ucApp.selfLength), 'served app loads from ' + three.parts + ' parts');
    const one = await file.evaluate(() => window.__ucApp.installApp());
    const names = await listScripts(file);
    check(one.parts === usual && dataParts(names) === usual, 'back to ' + usual + ' parts, extra parts removed: ' + names);

    // 4a. the Python tool removes extra parts too
    await file.evaluate(() => window.__ucApp.installApp({ partMax: 9000 }));
    execFileSync('python3', [path.join(root, 'shelly', 'tools', 'sovellus_shellyyn.py'), '127.0.0.1:8091'], { stdio: 'pipe' });
    const names2 = await listScripts(file);
    check(dataParts(names2) === usual, 'Python tool removed extra parts: ' + names2);
    const servedPy = await openApp(browser, r.url);
    check(await servedPy.evaluate(() => !!window.__ucApp.selfLength), 'app installed by the Python tool loads');
    mock.kill();

    // 4b. not enough space
    mock = await startMock(8092, ['--fs-free', '80000']);
    const small = await openApp(browser, 'file://' + APP + '?host=127.0.0.1:8092&lang=fi');
    const rs = await pressInstall(small);
    check(/ei ole tarpeeksi tilaa/.test(rs.after), 'full file system: ' + rs.after);
    check(String(await listScripts(small)) === 'uponor-clean-v3*', 'nothing written: ' + (await listScripts(small)));
    mock.kill();

    // 4c. an update deletes the old app first, so it fits where old + new would not
    mock = await startMock(8094, ['--fs-free', '240000']);
    const tight = await openApp(browser, 'file://' + APP + '?host=127.0.0.1:8094&lang=fi');
    const t1 = await pressInstall(tight);
    const t2 = await tight.evaluate(async () => { try { return 'ok ' + (await window.__ucApp.installApp()).free; } catch (e) { return 'error ' + e.message; } });
    check(/^Valmis/.test(t1.after) && /^ok /.test(t2), 'update with tight space: ' + t2);
    const ids1 = await listScripts(tight);
    check(/^uponor-clean-v3\*,uponor-clean-app\*,uponor-clean-app-data(,uponor-clean-app-data\d)*$/.test(String(ids1)), 'after the update: ' + ids1);
    const servedT = await openApp(browser, t1.url);
    check(await servedT.evaluate(() => !!window.__ucApp.selfLength), 'same address after the update: ' + t1.url);

    // 4d. Remove from the Shelly (two presses); the settings are still open after the install
    if (!(await tight.evaluate(() => document.getElementById('dlg').open))) await tight.click('#setb');
    await tight.waitForFunction(() => !document.getElementById('d-inst-x').hidden && !document.getElementById('d-inst-x').disabled, null, { timeout: 30000 });
    await tight.click('#d-inst-x');
    const armed = await tight.textContent('#d-inst-x');
    await tight.click('#d-inst-x');
    await tight.waitForFunction(() => /poistettiin|removed/.test(document.getElementById('d-inst-s').textContent), null, { timeout: 30000 });
    check(armed === 'Vahvista poisto', 'first press arms the removal: ' + armed);
    check(String(await listScripts(tight)) === 'uponor-clean-v3*', 'removed: ' + (await tight.textContent('#d-inst-s')));
    mock.kill();

    // 4e. three scripts already running
    mock = await startMock(8093, ['--fs-free', '300000']);
    const busy = await openApp(browser, 'file://' + APP + '?host=127.0.0.1:8093&lang=fi');
    await busy.evaluate(async () => {
      const c = window.__ucApp.rpc;
      for (const name of ['other1', 'other2']) { const { id } = await c.call('Script.Create', { name }); await c.call('Script.PutCode', { id, code: 'print(1)' }); await c.call('Script.Start', { id }); }
    });
    const rb = await pressInstall(busy);
    check(/enintään kolme skriptiä/.test(rb.after), 'three running: ' + rb.after);
  } catch (e) {
    console.log('FAIL ' + (e.stack || e)); fails++;
  } finally {
    mock.kill(); await browser.close();
  }
  console.log(fails ? fails + ' failed' : 'all ok');
  process.exit(fails ? 1 : 0);
})();
