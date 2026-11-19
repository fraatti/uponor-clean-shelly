// v3 install, components, user edits, stored counters, reinstall, endpoint and events
// on the device mock. Usage: node v3_device_test.js [-v]
'use strict';
const fs = require('fs');
const { Device, languageCheck } = require('./shelly_device_mock');
const F = require('./fwsim');
const R = require('./v3run');

const code = fs.readFileSync(R.V3_PATH, 'utf8');
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };

check(languageCheck(code).length === 0, 'language subset: ' + (languageCheck(code).join('; ') || 'ok'));
check(!code.trimStart().startsWith('/* @meta'), 'no @meta block: Home Assistant does not show script-owned components');

// a waiting-cycle trace with one cleaning cycle
const T0 = Date.parse('2026-11-18T08:00:00Z');
const sim = F.simulate({ t0: T0, seed: 3, durationS: 8 * 3600, startCycle: 'cleaning', tripAt: () => null });

const dev = new Device({ startMs: T0 - 1000, tzOffsetMin: 120, resetReason: 1 });   // installed right after a power-up
dev.verbose = process.argv.includes('-v');
dev.bootT = T0 - 2000;
dev.voltage = 230;
dev.setFeed(sim.events);
// counters from an earlier v3 run
dev.kvs.set('uc_batch', JSON.stringify({ n: 249, ts: Date.parse('2026-11-17T19:15:30Z') / 1000 }));
const sid = dev.addScript('uponor_clean_v3', code);
const r = dev.startScript(sid);
check(!r.err, 'script starts: ' + (r.msg || 'ok'));
dev.run(5000);
const roles = JSON.parse(dev.kvs.get('uc_vc'));
roles.plant = roles.group;
const comp = (role) => dev.comps.get(roles[role]);
check(dev.vcCount() === 9 && [...dev.comps.values()].every((c) => c.owner === ''), `9 components created with Virtual.Add, not owned (${Object.keys(roles).join(',')})`);
check(comp('phase').config.name === 'Phase' && comp('next_pumpout').config.name === 'Next pump-out', 'component names');
check(comp('phase').config.options.length === 13 && comp('warning').config.options.length === 11, 'enum options set with setConfig');
check(comp('chemical').config.unit === undefined ? comp('chemical').config.meta.ui.unit === 'l' : true, 'chemical unit l');
check(JSON.stringify(comp('plant').value) === JSON.stringify(['phase', 'cycle', 'status', 'warning', 'next_pumpout', 'batches', 'chemical', 'sludge'].map((x) => roles[x])), 'group members in order');
check(comp('batches').value === 249, 'batch count from uc_batch: ' + comp('batches').value);
const ub = JSON.parse(dev.kvs.get('uc_batch') || 'null');
check(ub && ub.n === 249, 'uc_batch kept');

// external writes: read-only labels refused, fields accepted
check(comp('phase').config.meta.ui.view === 'label' && comp('batches').config.meta.ui.view === 'field', 'labels for outputs, fields for user values');
dev.run(10 * 60e3);
check(comp('phase').value === 'aeration' && comp('cycle').value === 'cleaning', `cleaning cycle at power-up seen as ${comp('cycle').value}/${comp('phase').value}`);
const st1 = JSON.parse(dev.httpGet(`/script/${sid}/state`).body);
check(st1.eta !== null && Math.abs(st1.eta * 1000 - (sim.marks.find((m) => m.s === 'pump-out').t + 1000)) < 60e3, 'state endpoint gives the pump-out time');
check(/^2026-11-18T\d\d:\d\d:\d\d\+02:00$/.test(comp('next_pumpout').value), 'next pump-out as local ISO time: ' + comp('next_pumpout').value);
check(/Pump-out at \d\d:\d\d \(in \d+ h \d+ min\)/.test(comp('status').value), 'status text: ' + comp('status').value);
check(st1.last_pumpout === Date.parse('2026-11-17T19:15:30Z') / 1000, 'last pump-out from uc_batch');

// user edits
dev.externalSet(roles.chemical, 0.5);
dev.run(2000);
check(comp('warning').value === 'chemical_low', 'chemical 0.5 l -> chemical_low warning (' + comp('warning').value + ')');
dev.externalSet(roles.chemical, 18);
dev.externalSet(roles.sludge, 805);
dev.run(2000);
check(comp('warning').value === 'sludge_due', 'sludge 805 -> sludge_due (' + comp('warning').value + ')');
dev.externalSet(roles.sludge, 0);
dev.externalSet(roles.batches, 1000);
dev.run(2000);
check(comp('warning').value === 'none', 'sludge reset clears the reminder');
check(JSON.parse(dev.kvs.get('uc_sludge')).reset !== null, 'sludge reset time stored');
check(JSON.parse(dev.kvs.get('uc_batch')).n === 1000, 'user batch count stored');

// run through the pump-out
dev.run(4 * 3600e3);
check(comp('batches').value === 1001 && comp('sludge').value === 1, `batch counted: batches ${comp('batches').value}, sludge ${comp('sludge').value}`);
check(comp('chemical').value === 17.96, 'one dose taken from the chemical: ' + comp('chemical').value);
check(JSON.parse(dev.kvs.get('uc_batch')).n === 1001, 'batch stored in uc_batch');
check(![...dev.kvs.keys()].some((k) => k.startsWith('puhdistamo_')), 'no v2 KVS keys written');
const types = [...new Set(dev.eventLog.filter((e) => e.name === 'uponor').map((e) => e.data.type))].sort();
check(JSON.stringify(types) === JSON.stringify(['batch', 'chemical', 'phase', 'sludge', 'start', 'warning']), 'event types: ' + types.join(','));
check(dev.eventLog.every((e) => e.data.v === 1), 'events carry version 1');

// script stopped for an update and started again: stored phase is resumed
const before = comp('phase').value;
dev.stopScript(sid); dev.run(30e3); dev.startScript(sid); dev.run(60e3);
check(comp('phase').value === before, `phase resumed after a script restart (${before} -> ${comp('phase').value})`);

// delete and reinstall: counters come back from KVS
dev.deleteScript(sid);
check(dev.vcCount() === 9, 'deleting the script keeps the components');
const sid2 = dev.addScript('uponor_clean_v3', code);
dev.startScript(sid2); dev.run(5000);
const roles2 = JSON.parse(dev.kvs.get('uc_vc'));
check(dev.vcCount() === 9 && roles2.phase === roles.phase, 'reinstall reuses the components (uc_vc)');
// a component deleted by the user is created again
dev.stopScript(sid2); dev.comps.delete(roles2.warning); dev.startScript(sid2); dev.run(5000);
const roles3 = JSON.parse(dev.kvs.get('uc_vc'));
check(dev.vcCount() === 9 && dev.comps.has(roles3.warning) && dev.comps.get(roles3.group).value.includes(roles3.warning), 'missing component recreated and added to the group');
check(dev.comps.get(roles2.batches).value === 1001 && dev.comps.get(roles2.chemical).value === 17.96 && dev.comps.get(roles2.sludge).value === 1, 'reinstall restores batches, chemical and sludge from KVS');
const keys = [...dev.kvs.keys()].sort();
check(keys.every((k) => k.length <= 42 && dev.kvs.get(k).length <= 253), 'KVS keys and values within limits: ' + keys.join(','));
const timers = dev.timers.filter((t) => t.sid === sid2).length;
check(timers <= 3, 'timers in use: ' + timers);
check(!dev.logs.some((l) => /UNCAUGHT/.test(l.s)), 'no uncaught errors');
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exitCode = fails ? 1 : 0;
