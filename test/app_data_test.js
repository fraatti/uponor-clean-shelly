// Checks that app/uponor-clean-app-data*.txt (pasted into the Shelly web UI) is the current app,
// that each part fits the Shelly script editor, that the loader finds the parts and that the app
// carries the same loader for its Install button.
//   node test/app_data_test.js
// Rebuild the files with: python3 shelly/tools/sovellus_shellyyn.py --tiedosto
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'uponor-clean-app.html'));
const partFiles = fs.readdirSync(path.join(root, 'app')).filter((f) => /^uponor-clean-app-data\d*\.txt$/.test(f))
  .sort((a, b) => (Number(a.slice(21, -4)) || 1) - (Number(b.slice(21, -4)) || 1));
const parts = partFiles.map((f) => fs.readFileSync(path.join(root, 'app', f), 'utf8'));
const txt = parts.join('');
const loader = fs.readFileSync(path.join(root, 'app', 'uponor_clean_app_loader.js'), 'utf8');
const EDITOR_MAX = 50000;

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

let unpacked = null;
try { unpacked = zlib.gunzipSync(Buffer.from(txt.replace(/\s+/g, ''), 'base64')); } catch (e) { /* reported below */ }
check(parts.length > 0 && partFiles.every((f, i) => f === 'uponor-clean-app-data' + (i ? i + 1 : '') + '.txt'), 'parts ' + partFiles.join(', '));
check(unpacked !== null, 'the parts unpack (base64 + gzip)');
check(unpacked !== null && unpacked.equals(html), 'unpacked data equals app/uponor-clean-app.html (else run sovellus_shellyyn.py --tiedosto)');
parts.forEach((p, i) => check(p.length <= EDITOR_MAX, partFiles[i] + ' ' + p.length + ' chars <= ' + EDITOR_MAX + ' (Shelly web editor)'));
check(/^[A-Za-z0-9+/=\n]*$/.test(txt), 'data is plain base64 lines');
check(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(loader), 'loader is ASCII');
check(loader.includes('/^uponor-clean-app-data\\\\d*$/.test(x.name)') && loader.includes('slice(21)'), 'loader reads the scripts uponor-clean-app-data, -data2, ...');
check(loader.includes('HTTPServer.registerEndpoint("app"'), 'loader registers the endpoint app');
check(loader.length <= EDITOR_MAX, 'loader ' + loader.length + ' chars <= ' + EDITOR_MAX);
const app = html.toString('utf8');
const lm = /\nconst LOADER_JS = ("(?:[^"\\]|\\.)*");\n/.exec(app);
check(lm !== null && JSON.parse(lm[1]) === loader, 'the app carries app/uponor_clean_app_loader.js unchanged (LOADER_JS)');
check(app.includes("const SELF_HTML = '<!doctype html>\\n' + document.documentElement.outerHTML;"), 'the app captures its own page (SELF_HTML)');
check(/<\/script>\s*<\/body>\s*<\/html>\s*$/.test(app), 'the app script is the last element, so SELF_HTML is the whole page');

console.log(fails ? fails + ' failed' : 'all ok');
process.exit(fails ? 1 : 0);
