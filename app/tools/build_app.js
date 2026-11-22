#!/usr/bin/env node
// Puts the Home Assistant card (ha-card/uponor-clean-card.js, draws the picture view) and the phase
// reconstruction (app/history_from_power.js, the past days from the minute power) into the browser
// app, and rebuilds the packed app for the Shelly web UI (app/uponor-clean-app-data*.txt).
//
//   node app/tools/build_app.js
//
// The code is minified with terser when it is installed (npm install --no-save terser@5.31.6),
// which saves about 15 kB on the Shelly; without terser it goes in as it is.
// Each part stays a separate script before the app's own script: the app's script must be the
// last element of the page (it stores the page on the Shelly as it was loaded).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const APP = path.join(root, 'app', 'uponor-clean-app.html');
const PARTS = [
  { name: 'card', file: path.join(root, 'ha-card', 'uponor-clean-card.js'), open: '<script id="uc-card">', ver: /UC_VERSION = '([^']+)'/ },
  { name: 'history', file: path.join(root, 'app', 'history_from_power.js'), open: '<script id="uc-history">' },
];
const CLOSE = '</script>';

(async () => {
  let minify = null;
  try { ({ minify } = require(require.resolve('terser', { paths: [root, process.cwd()] }))); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  let page = fs.readFileSync(APP, 'utf8');
  for (const part of PARTS) {
    const src = fs.readFileSync(part.file, 'utf8');
    let code = src;
    if (minify) code = (await minify(src, { compress: true, mangle: true, format: { comments: /^!/ } })).code;
    if (/<\/script|<!--/i.test(code)) throw new Error(part.file + ' contains </script or <!--, which would end the script element');
    const a = page.indexOf(part.open);
    if (a < 0) throw new Error('marker ' + part.open + ' missing in ' + APP);
    const b = page.indexOf(CLOSE, a);
    page = page.slice(0, a + part.open.length) + code.trim() + page.slice(b);
    const m = part.ver && part.ver.exec(src);
    console.log('app: ' + part.name + (m ? ' ' + m[1] : '') + ' ' + (minify ? 'minified with terser' : 'as is (terser not installed)') + ', ' + src.length + ' -> ' + code.length + ' chars');
  }
  fs.writeFileSync(APP, page);
  console.log('app: ' + page.length + ' chars');
  const py = spawnSync('python3', [path.join(root, 'shelly', 'tools', 'sovellus_shellyyn.py'), '--tiedosto'], { stdio: 'inherit' });
  if (py.error || py.status !== 0) console.log('note: run python3 shelly/tools/sovellus_shellyyn.py --tiedosto to rebuild the packed app');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
