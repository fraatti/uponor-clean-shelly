#!/usr/bin/env node
// Puts the Home Assistant card (ha-card/uponor-clean-card.js) into the browser app, where it draws
// the picture view, and rebuilds the packed app for the Shelly web UI (app/uponor-clean-app-data*.txt).
//
//   node app/tools/build_app.js
//
// The card is minified with terser when it is installed (npm install --no-save terser@5.31.6),
// which saves about 12 kB on the Shelly; without terser the card goes in as it is.
// The card stays a separate script before the app's own script: the app's script must be the
// last element of the page (it stores the page on the Shelly as it was loaded).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const CARD = path.join(root, 'ha-card', 'uponor-clean-card.js');
const APP = path.join(root, 'app', 'uponor-clean-app.html');
const OPEN = '<script id="uc-card">', CLOSE = '</script>';

(async () => {
  const src = fs.readFileSync(CARD, 'utf8');
  const ver = /UC_VERSION = '([^']+)'/.exec(src)[1];
  let code = src, how = 'as is (terser not installed)';
  try {
    const { minify } = require(require.resolve('terser', { paths: [root, process.cwd()] }));
    const r = await minify(src, { compress: true, mangle: true, format: { comments: /^!/ } });
    code = r.code; how = 'minified with terser';
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  if (/<\/script|<!--/i.test(code)) throw new Error('the card contains </script or <!--, which would end the script element');
  const page = fs.readFileSync(APP, 'utf8');
  const a = page.indexOf(OPEN);
  if (a < 0) throw new Error('marker ' + OPEN + ' missing in ' + APP);
  const b = page.indexOf(CLOSE, a);
  const out = page.slice(0, a + OPEN.length) + code.trim() + page.slice(b);
  fs.writeFileSync(APP, out);
  console.log('app: card ' + ver + ' ' + how + ', ' + src.length + ' -> ' + code.length + ' chars; app ' + out.length + ' chars');
  const py = spawnSync('python3', [path.join(root, 'shelly', 'tools', 'sovellus_shellyyn.py'), '--tiedosto'], { stdio: 'inherit' });
  if (py.error || py.status !== 0) console.log('note: run python3 shelly/tools/sovellus_shellyyn.py --tiedosto to rebuild the packed app');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
