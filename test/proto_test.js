// Runs the v3 device prototype, the listener and the migration tool against the
// device mock: backup -> delete -> prototype -> reboot -> reinstall -> restore.
'use strict';
const fs = require('fs');
const path = require('path');
const { Device, languageCheck } = require('./shelly_device_mock');

const P = path.join(__dirname, '..', 'shelly', 'v3', 'proto');
const TOOLS = fs.readFileSync(path.join(P, 'uc_tools.js'), 'utf8');
const PROTO = fs.readFileSync(path.join(P, 'uponor_v3_proto.js'), 'utf8');
const LISTEN = fs.readFileSync(path.join(P, 'uponor_v3_listener.js'), 'utf8');
const PROBE = fs.readFileSync(path.join(P, 'uponor_v3_probe.js'), 'utf8');

let fails = 0;
function check(cond, what) { console.log((cond ? 'PASS ' : 'FAIL ') + what); if (!cond) fails++; }
const withMode = (m) => TOOLS.replace(/let MODE = "[a-z]+";/, `let MODE = "${m}";`);

// --- language checks
for (const [n, c] of [['uc_tools.js', TOOLS], ['uponor_v3_proto.js', PROTO], ['uponor_v3_listener.js', LISTEN], ['uponor_v3_probe.js', PROBE]]) {
  const pr = languageCheck(c);
  check(pr.length === 0, `language check ${n}${pr.length ? ': ' + pr.join('; ') : ''}`);
}

// --- device with the v2.4 components (manual, not owned)
const dev = new Device();
dev.verbose = process.argv.includes('-v');
const add = (t, id, cfg, v) => { dev.addComponent(t, id, cfg); if (v !== undefined) dev.comps.get(`${t}:${id}`).value = v; };
add('boolean', 201, { name: 'VC Pump in' }, false);
add('boolean', 202, { name: 'VC Pump out' }, false);
add('boolean', 203, { name: 'VC Sludge removal' }, false);
add('boolean', 204, { name: 'VC Dosing' }, false);
add('boolean', 205, { name: 'VC Aeration' }, true);
add('number', 200, { name: 'VC Batch counter', min: 0, max: 1e9, meta: { ui: { view: 'label' } } }, 230);
add('number', 201, { name: 'VC Normalized consumption', meta: { ui: { view: 'label', unit: 'W' } } }, 57.1);
add('enum', 200, { name: 'VC Cycle status', options: ['U', 'F', 'A', 'C', 'S', 'R', 'D', 'W'], default_value: 'U', meta: { ui: { view: 'dropdown', titles: { U: 'Unknown', F: 'Filling', A: 'Aeration', C: 'Dosing', S: 'Settling', R: 'Sludge', D: 'Discharge', W: 'Waiting' } } } }, 'A');
add('text', 200, { name: 'Process message', max_len: 255, meta: { ui: { view: 'label' } } }, 'Pump out in 64 min');
add('group', 200, { name: 'Uponor Clean 1' });
dev.comps.get('group:200').value = ['boolean:201', 'boolean:202', 'boolean:203', 'boolean:204', 'boolean:205', 'number:200', 'number:201', 'enum:200', 'text:200'];
dev.kvs.set('puhdistamo_batch_count', '230');
const original = JSON.parse(JSON.stringify([...dev.comps.entries()].map(([k, c]) => [k, c.config, c.value])));

const logsOf = (sid, from = 0) => dev.logs.filter(l => l.sid === sid).slice(from).map(l => l.s);
const has = (sid, re) => logsOf(sid).some(s => re.test(s));

// --- A. probe next to v2.4: no components, events reach the listener
const listenA = dev.addScript('uponor-listen', LISTEN);
const probe = dev.addScript('uponor-probe', PROBE);
dev.startScript(listenA);
check(!dev.startScript(probe).err, 'probe starts next to v2.4');
dev.run(3 * 60000);
check(dev.vcCount() === 10, 'probe created no components');
check(has(probe, /KVS.Set ok, start number 1/), 'probe KVS write');
check(has(probe, /EM1Data blocks in last 24 h: 1/), 'probe EM1Data history');
check(has(listenA, /raw .*"type":"probe"/), 'listener received probe events');
const pe = logsOf(probe).map(x => /endpoint: http:\/\/[\d.]+(\/\S+)/.exec(x)).find(Boolean);
const pr = pe ? dev.httpGet(pe[1]) : { sent: false };
check(pr.sent && JSON.parse(pr.body).probe === true, 'probe endpoint returns JSON');
check(!dev.scripts.get(probe).error && !dev.scripts.get(listenA).error, 'no uncaught errors in part A');
dev.deleteScript(probe); dev.deleteScript(listenA);

// --- 1. backup
const tools = dev.addScript('uc-tools', withMode('backup'));
check(!dev.startScript(tools).err, 'tools start (backup)');
dev.run(5000);
check(dev.scripts.get(tools).storage.get('n') === '10', 'backup stored 10 components');
check(has(tools, /Backup stored: 10 components/), 'backup message printed');

// --- 2. prototype cannot start while v2.4 components fill the slots
const proto = dev.addScript('uponor-proto', PROTO);
const r0 = dev.startScript(proto);
check(r0.err === -110 && /limit/.test(r0.msg), 'prototype refused while slots are full (' + (r0.msg || 'started') + ')');

// --- 3. delete the v2.4 components
dev.stopScript(tools); dev.scripts.get(tools).code = withMode('delete');
dev.startScript(tools); dev.run(5000);
check(dev.vcCount() === 0, 'all v2.4 components deleted');
check(dev.kvs.get('puhdistamo_batch_count') === '230', 'v2.4 KVS keys untouched');

// --- 4. prototype starts and creates its components
const r1 = dev.startScript(proto);
check(!r1.err, 'prototype starts' + (r1.err ? ': ' + r1.msg : ''));
dev.run(60000);
check(dev.vcCount() === 9, 'prototype created 9 components (' + dev.vcCount() + ')');
const grp = [...dev.comps.values()].find(c => c.type === 'group');
check(grp && grp.value.length === 8, 'group has 8 members');
check(has(proto, /handles: 9\/9/), 'all 9 handles found');
check(has(proto, /state endpoint: http:\/\/192\.168\.1\.50\/script\/\d+\/state/), 'state endpoint printed');
check(!dev.scripts.get(proto).error, 'no uncaught error in prototype');

// --- 5. listener receives events; simulated batch is recognised as own write
const listen = dev.addScript('uponor-listen', LISTEN);
dev.startScript(listen);
dev.run(5 * 60000);
check(has(listen, /raw .*"event":"uponor"/), 'listener received raw uponor event');
check(has(listen, /#\d+ \{"tick"/), 'listener decoded heartbeat');
check(has(proto, /simulated batch: batches 1, sludge 1, chemical 0/), 'simulated batch');
check(has(proto, /own write confirmed: batches = 1/), 'own write recognised');
check(!has(proto, /USER EDIT/), 'no false user edit');

// --- 6. user edits Chemical, tries to write Phase
const keyOf = (role) => dev.scripts.get(proto).roles[role];
check(!dev.externalSet(keyOf('chemical'), 15).err, 'user can write Chemical');
dev.run(1000);
check(has(proto, /USER EDIT chemical: 0 -> 15/), 'user edit detected');
check(JSON.parse(dev.kvs.get('uc_proto')).chemical === 15, 'user edit saved to KVS');
const rw = dev.externalSet(keyOf('phase'), 'aeration');
check(rw.err === -103, 'Phase is read-only for other clients');

// --- 7. state endpoint
const st = dev.httpGet(dev.logs.filter(l => l.sid === proto).map(l => /state endpoint: http:\/\/[\d.]+(\/\S+)/.exec(l.s)).find(Boolean)[1]);
let parsed = null; try { parsed = JSON.parse(st.body); } catch (e) { /* */ }
check(st.sent && parsed && parsed.version === '3.0-proto1', 'state endpoint returns JSON');
check(parsed && /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+02:00$/.test(parsed.time), 'ISO local time with offset: ' + (parsed && parsed.time));
check(parsed && parsed.time.slice(11, 16) === new Date(dev.t + 7200e3).toISOString().slice(11, 16), 'ISO time matches the clock');

// --- 8. reboot: numbers persist, KVS start counter grows, values come from KVS
const chemBefore = dev.comps.get(keyOf('chemical')).value;
dev.reboot({ autostart: [proto, listen], offMs: 120000 });
dev.run(40000);
check(dev.comps.get(keyOf('chemical')).value === chemBefore, 'Chemical kept over reboot (' + chemBefore + ')');
dev.run(30000);
const fromBoot = logsOf(proto).filter(s => /start number/.test(s));
check(fromBoot.length === 2 && /start number 2/.test(fromBoot[1]), 'second start counted in KVS');
check(has(proto, /EM1Data blocks in last 30 min: 1/), 'EM1Data probe ran');

// --- 9. delete the prototype: its components go, KVS stays
const protoKeys = Object.values(dev.scripts.get(proto).roles);
const chemStored = JSON.parse(dev.kvs.get('uc_proto')).chemical;
dev.deleteScript(proto);
check(protoKeys.every(k => !dev.comps.has(k)), 'deleting the script removed its components');
check(dev.kvs.has('uc_proto'), 'KVS survives script deletion');

// --- 10. reinstall: values restored from KVS
const proto2 = dev.addScript('uponor-proto', PROTO);
check(!dev.startScript(proto2).err, 'reinstalled prototype starts');
dev.run(30000);
check(dev.comps.get(dev.scripts.get(proto2).roles.chemical).value === chemStored, 'Chemical restored from KVS after reinstall (' + chemStored + ')');
check(logsOf(proto2).some(s => /start number 3/.test(s)), 'KVS start counter continues (3)');

// --- 11. rollback: remove prototype + listener, restore the v2.4 components
dev.deleteScript(proto2); dev.deleteScript(listen);
dev.stopScript(tools); dev.scripts.get(tools).code = withMode('restore');
dev.startScript(tools); dev.run(10000);
const restored = JSON.parse(JSON.stringify([...dev.comps.entries()].map(([k, c]) => [k, c.config, c.value])));
const norm = (a) => JSON.stringify(a.sort((x, y) => x[0] < y[0] ? -1 : 1));
check(norm(restored) === norm(original), 'restore recreated the same components, configs, values and group members');
check(!has(tools, /FAILED/), 'no failed RPC calls in the tool');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
