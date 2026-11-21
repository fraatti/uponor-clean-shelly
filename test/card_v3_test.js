// Card test with the v3 entities: history from a simulated v3 run (fwsim + v3 script on the
// device mock) is fed to the card in jsdom. Needs jsdom: npm install jsdom (in test/ or above).
// Usage: node card_v3_test.js [card.js]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const R = require('./v3run');
const F = require('./fwsim');

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };

const T0 = Date.parse('2026-11-16T22:00:00Z');
const sim = F.simulate({ t0: T0, seed: 5, durationS: 30 * 3600, startCycle: 'cleaning', tripAt: (c, n) => (n % 3 === 2 ? 200 : null), outletBlocked: (b) => b === 2 });
const run = R.runV3({ events: sim.events, t0: T0 - 2000, t1: sim.tEnd, uptimeAtStartS: 1, resetReason: 1,
  userSets: [{ at: T0 + 60e3, role: 'chemical', value: 12 }, { at: T0 + 120e3, role: 'sludge', value: 300 }, { at: T0 + 20 * 3600e3, role: 'sludge', value: 0 }] });
const NOW = sim.tEnd;
const TITLES = { phase: { unknown: 'Unknown', pre_aeration: 'Pre-aeration', aeration: 'Aeration', chem_filling: 'Chemical filling', dosing: 'Dosing', mixing: 'Mixing', sedimentation_1: 'Sedimentation I', sludge_removal: 'Sludge removal', sedimentation_2: 'Sedimentation II', pump_out: 'Pump-out', pump_in: 'Pump-in', waiting: 'Waiting', off: 'No power' },
  cycle: { unknown: 'Unknown', cleaning: 'Cleaning', waiting: 'Waiting', holiday: 'Holiday', test: 'Test' },
  warning: { none: 'OK', outlet_blocked: 'Outlet blocked?', high_water: 'High water', chemical_low: 'Chemical low', paused: 'Process paused?' } };
const ENT = { phase: 'sensor.uc_phase', cycle: 'sensor.uc_cycle', status: 'sensor.uc_status', warning: 'sensor.uc_warning', next_pumpout: 'sensor.uc_next_pump_out', batches: 'number.uc_batches', chemical: 'number.uc_chemical', sludge: 'number.uc_sludge' };
const hist = {};
for (const role of Object.keys(ENT)) hist[ENT[role]] = R.timeline(run.changes, role).map((c) => ({ s: String(TITLES[role] && TITLES[role][c.v] ? TITLES[role][c.v] : c.v), lc: c.t / 1000 }));
hist['sensor.uc_power'] = sim.events.filter((e) => e.p != null).map((e) => ({ s: String(e.p), lc: e.t / 1000 }));
const states = {};
for (const id of Object.keys(hist)) {
  const a = hist[id]; const l = a.length ? a[a.length - 1] : { s: 'unknown', lc: NOW / 1000 };
  states[id] = { entity_id: id, state: l.s, last_changed: new Date(l.lc * 1000).toISOString(), attributes: id === ENT.phase ? { options: Object.values(TITLES.phase) } : {} };
}
states['sensor.uc_power'].attributes = { device_class: 'power' };

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.ResizeObserver = class { observe() {} disconnect() {} };
w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ isIntersecting: true }]); } disconnect() {} };
w.__ucNow = () => NOW;
const errors = [];
w.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message)));
w.console.warn = (...a) => errors.push('warn ' + a.join(' '));
w.eval(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'ha-card', 'uponor-clean-card.js'), 'utf8'));
const Card = w.customElements.get('uponor-clean-card');

// card picker: entities of a v3 install are found
const stub = Card.getStubConfig({ states, entities: {} });
check(stub.entities.phase === ENT.phase && stub.entities.cycle === ENT.cycle && stub.entities.message === ENT.status && stub.entities.sludge === ENT.sludge &&
  stub.entities.batch_counter === ENT.batches && stub.entities.power === 'sensor.uc_power', 'getStubConfig finds the v3 entities');
const form = Card.getConfigForm();
check(form.schema.length > 2 && JSON.stringify(form.schema).includes('"language"'), 'visual editor schema with a language choice');

const card = w.document.createElement('uponor-clean-card');
card.setConfig({ entities: { power: 'sensor.uc_power', phase: ENT.phase, cycle: ENT.cycle, message: ENT.status, warning: ENT.warning, next_pumpout: ENT.next_pumpout,
  batch_counter: ENT.batches, chemical: ENT.chemical, sludge: ENT.sludge, legacy: { status: 'select.old' } }, language: 'fi', sludge_emptied: '2025-01-01' });
check(card._cfg.legacy && card._cfg.legacy.status === 'select.old' && !card._cfg.entities.legacy, 'legacy inside entities is accepted');
w.document.body.appendChild(card);
const calls = [];
card.hass = { states, themes: {}, locale: { language: 'fi' }, language: 'fi',
  callWS: async (msg) => { const out = {}; for (const id of msg.entity_ids) out[id] = (hist[id] || []).filter((e) => e.lc * 1000 >= Date.parse(msg.start_time) && e.lc * 1000 <= Date.parse(msg.end_time)); return out; },
  callService: async (...a) => { calls.push(a); } };

setTimeout(async () => {
  try {
    const m = card._model; m.build(NOW);
    const gt = sim.gt; let bad = 0, n = 0;
    const map = { pre_aeration: 'aeration', aeration: 'aeration', mixing: 'aeration', chem_filling: 'dosing', dosing: 'dosing', sedimentation_1: 'settling', sedimentation_2: 'settling', waiting: 'settling', sludge_removal: 'sludge', pump_out: 'discharge', pump_in: 'filling' };
    for (let t = T0 + 3600e3; t < NOW; t += 60e3) {
      let g = null; for (const x of gt) if (x.t <= t - 15e3) g = x; if (!g || !map[g.ph]) continue;
      n++; if (m.stateAt(t).phase !== map[g.ph]) bad++;
    }
    check(bad / n < 0.01, `phase agreement ${((1 - bad / n) * 100).toFixed(1)} % of ${n} samples`);
    const sed = gt.filter((x) => x.ph === 'sedimentation_1')[1];
    const po = gt.find((x) => x.ph === 'pump_out' && x.t > sed.t);
    const S2 = m.stateAt(sed.t + 600e3);
    check(S2.eta !== null && Math.abs(S2.eta - (po.t + 1000 - (sed.t + 600e3)) / 1000) <= 60, 'pump-out time from the Next pump-out entity');
    const ch = card._chem();
    check(ch && Math.abs(ch.liters - Number(states[ENT.chemical].state)) < 1e-9, 'chemical from the entity: ' + (ch && ch.liters));
    // the sludge counter was reset 10 h before NOW: the reset in the history wins over the configured date
    const c = card._ctx(NOW);
    check(c.sludgeDays === 0 && !c.sludgeEst && c.sludgeRem.n === Number(states[ENT.sludge].state), `sludge emptied from the counter reset: ${c.sludgeDays} d, counter ${c.sludgeRem.n}`);
    // sludge editor sets the Shelly counter
    card._openSludge(); card.shadowRoot.getElementById('sl-in').value = '0'; await card._saveSludge();
    check(calls.some((a) => a[0] === 'number' && a[1] === 'set_value' && a[2].entity_id === ENT.sludge && a[2].value === 0), 'sludge editor sets number.set_value 0');
    card._openChem(); card.shadowRoot.getElementById('chem-in').value = '15'; await card._saveChem();
    check(calls.some((a) => a[2].entity_id === ENT.chemical && a[2].value === 15), 'chemical editor sets number.set_value 15');
    check(errors.length === 0, 'no errors: ' + errors.slice(0, 3).join(' | '));
  } catch (e) { console.log('ERR', e.stack); fails++; }
  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}, 1500);
