// Checks that app/uponor-clean-app-data.txt (pasted into the Shelly web UI) is the current app,
// fits the Shelly script editor and that the loader finds it.
//   node test/app_data_test.js
// Rebuild the file with: python3 shelly/tools/sovellus_shellyyn.py --tiedosto
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'uponor-clean-app.html'));
const txt = fs.readFileSync(path.join(root, 'app', 'uponor-clean-app-data.txt'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'uponor_clean_app_loader.js'), 'utf8');
const EDITOR_MAX = 50000;

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

let unpacked = null;
try { unpacked = zlib.gunzipSync(Buffer.from(txt.replace(/\s+/g, ''), 'base64')); } catch (e) { /* reported below */ }
check(unpacked !== null, 'uponor-clean-app-data.txt unpacks (base64 + gzip)');
check(unpacked !== null && unpacked.equals(html), 'unpacked data equals app/uponor-clean-app.html (else run sovellus_shellyyn.py --tiedosto)');
check(txt.length <= EDITOR_MAX, 'data ' + txt.length + ' chars <= ' + EDITOR_MAX + ' (Shelly web editor)');
check(/^[A-Za-z0-9+/=\n]*$/.test(txt), 'data is plain base64 lines');
check(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(loader), 'loader is ASCII');
check(loader.includes('x.name==="uponor-clean-app-data"'), 'loader looks for the script uponor-clean-app-data');
check(loader.includes('HTTPServer.registerEndpoint("app"'), 'loader registers the endpoint app');
check(loader.length <= EDITOR_MAX, 'loader ' + loader.length + ' chars <= ' + EDITOR_MAX);

console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
