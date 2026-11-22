/*! uponor-clean-card v1.8.3 – animated Uponor Clean I card for Home Assistant. PolyForm Noncommercial 1.0.0, github.com/fraatti/uponor-clean-shelly */
(() => {
/* Uponor Clean Card – core: constants, translations, history model */
const UC_VERSION = '1.8.3';

const UC_DEFAULTS = {
  name: 'Uponor Clean I',
  entities: {
    power: 'sensor.uponor_clean_1_vc_normalized_consumption',
    status: 'select.uponor_clean_1_vc_cycle_status',
    message: 'text.storage_room_uponor_clean_1_process_message',
    batch_counter: 'sensor.uponor_clean_1_vc_batch_counter',
    energy: null,
    // Shelly script v3: phase and cycle replace status, Status text replaces message
    phase: null, cycle: null, warning: null, next_pumpout: null, chemical: null, sludge: null,
  },
  // older entities whose history is shown before the v3 entities start (v2 status letters, messages, counter)
  legacy: null,
  hours: 24,
  view: 'side',
  language: 'auto',
  batch_volume: 170,
  sludge_return_lpm: 12,
  history_days: 8,
  sludge_emptied: null,
  sludge_reset_counter: null,
  sludge_reminder_batches: 800,
  chemical_amount: null,
  chemical_refill_counter: null,
  chemical_fill_liters: 15,
  chemical_capacity: 20,
  chemical_dose_dl: 0.4,
};

/* Plant geometry (mm above tank bottom) used for the level model and the drawing */
const UC_GEO = {
  lowMM: 780,        // level after pump-out (discharge intake funnel)
  startMM: 930,      // start level (green pressure-switch tube trips)
  saoMM: 985,        // sedimentation tank working level (pump-in cut-off)
  saoSwingMM: 30,    // visual swing of sedimentation level
  alarmMM: 1100,     // overflow alarm level (black tube)
  partitionMM: 1125, // top of partition wall
  outletMM: 1110,
  inletMM: 1160,
  blanketMM: 430,    // settled sludge blanket top in process tank
  // the pressure switches trip at 10 mbar, i.e. when the water is about 10 cm above the open end of the
  // sensor tube (102 mm water column plus a little for the trapped air compressing)
  greenTubeBottomMM: 825,  // start level 930 - 105
  blackTubeBottomMM: 995,  // alarm level 1100 - 105
};

/* Phase durations (s) of the control unit firmware (board A settings, VERSION 2.1.2) */
const UC_TYP = {
  'filling/wait': 600, 'filling/batch': 600, 'filling/post': 1020, 'filling/holiday': 600,
  'aeration/batch': 6000, 'aeration/wait': 1800, 'aeration/holiday': 600,
  'mixing/batch': 120, 'dosing/batch': 100, 'settling/batch': 2700, 'settling/batch2': 900,
  'waiting/wait': 1080, 'waiting/holiday1': 3000, 'waiting/holiday2': 6000,
  'sludge/batch': 120, 'sludge/wait': 60, 'sludge/holiday': 60, 'discharge/batch': 780,
};
/* Remaining cleaning-cycle time from the start of each phase to pump-out start (s) */
const UC_FW_TO_PUMPOUT = { aeration: 9940, dosing: 3940, mixing: 3840, settling: 3720, sludge: 1020, settling2: 900 };
const UC_PULSE = { on: 5, period: 125 }; // MV5 mixing pulse during pump-in

const UC_PHASE_COLORS = {
  filling: '#2D8CE0', aeration: '#7E8894', mixing: '#A9B0BA', dosing: '#E8B21C',
  settling: '#CDBE94', waiting: '#E2DCCD', sludge: '#8B5A2B', discharge: '#E04A3F', unknown: '#C9C9C9', offline: '#9E9E9E',
};
const UC_HOSE = {
  red: '#E0352B', gray: '#9A9EA6', blue: '#2E9BE8', black: '#2B2B2B', green: '#2EA043', brown: '#7A4A22', yellow: '#F2C21B',
};

const UC_I18N = {
  en: {
    phase: { filling: 'Filling', aeration: 'Aeration', mixing: 'Mixing', dosing: 'Dosing', settling: 'Settling', waiting: 'Waiting',
      sludge: 'Sludge return', discharge: 'Discharge', unknown: 'Unknown', offline: 'Offline' },
    sub: { fill: 'pump filling', dose: 'dose', pulse: 'mixing pulse', restart: 'after power cut' },
    ctx: { batch: 'batch', wait: 'wait cycle', holiday: 'holiday automation', post: 'after pump-out' },
    side: 'Side', top: 'Top', history: 'History', now: 'Now', live: 'Live',
    last_h: 'last {n} h', batches: 'Batches', week: '7 d', per_day: '/d', wastewater: 'Wastewater',
    power: 'Power', energy: 'Energy', chemical: 'Chemical', eta: 'Pump-out in', last_batch: 'Last batch',
    level: 'Level', level_est: 'Level (est.)', est: 'est.', process_level: 'Process tank', sludge_layer: 'Sludge',
    emptied: 'emptied {n} d ago', compressor: 'compressor', power_lbl: 'power', off: 'off',
    logbook: 'Logbook', entries: '{n} entries', show_more: 'Show more', show_less: 'Show less',
    ev_start: 'Start level reached – batch started (filling {d}, {n} wait cycles)',
    ev_start_short: 'Start level reached – batch started (filling {d})',
    ev_dose: 'Chemical dose', ev_discharge: 'Pump-out started', ev_batch: 'Batch {n} completed',
    ev_holiday_on: 'Holiday automation started', ev_holiday_off: 'Holiday automation ended',
    ev_offline: 'Data gap (Shelly or Home Assistant)',
    ev_restart: 'Plant restarted after a power cut – new batch from pre-aeration',
    warn: { high_water: 'High water in the sedimentation tank – aeration skipped or cut short', outlet: 'Outlet blocked? The level did not drop at pump-out',
      high_power: 'High power – check the air hoses and the compressor', no_power: 'No power – check the plant supply',
      no_comp: 'Compressor not running', signal: 'Power signal missing', paused: 'Process paused? (e.g. stopped from the panel)',
      chemical_low: 'Chemical low – refill and set the amount', sludge_due: 'Sludge emptying due', sludge_emptied: 'Sludge emptied? Reset the sludge counter' },
    chem_now: 'Chemical in the tank now', chem_save: 'Save', chem_cancel: 'Cancel', chem_l: 'l', chem_full: 'full tank {n} l',
    chem_cap: 'A full tank is {n} l; a larger amount is saved as {n} l.',
    chem_note: 'Counting restarts from batch {n}, {d} dl per batch.', chem_need: 'Add input_number helpers for chemical_amount and chemical_refill_counter to set the amount here (see README).',
    chem_note3: 'The Shelly script subtracts 0.4 dl per dose from this amount.', chem_left: '≈ {n} batches', chem_saved: 'Saved', sludge_rem: 'Sludge reminder', sludge_rem_v: '{n} / {m} batches',
    sed_tank: 'Sedimentation tank 2.5 m³', proc_tank: 'Process tank 1 m³', control_unit: 'Control unit',
    chem_pump: 'Chemical dosing pump', inlet: 'Inlet', outlet: 'Outlet', pump_in: 'Pump-in', sludge_ret: 'Sludge return',
    discharge_in: 'Discharge intake', aerator: 'Aerator', start_level: 'Start level', overflow: 'Overflow level',
    low_level: 'Pump-out level', partition: 'Partition wall', hole: 'hole', air: 'air', check_valve: 'check valve',
    top_legend: ['Discharge module', 'Aerator', 'Pump-in module', 'Overflow sensor tube', 'Start sensor tube', 'Sludge return module'],
    top_colors: ['red hose', 'grey hose', 'blue hose', 'black hose', 'green hose', 'brown hose'],
    chem_line: 'Chemical tank', chem_line2: 'yellow hose', to_cu: '↑ to control unit',
    top_title: 'Process tank riser from above', sed_side: 'sedimentation side', proc_side: 'process side',
    no_data: 'Waiting for history…', w: 'W', speed_title: 'Playback speed (simulated time per second)', minutes: 'min', seconds: 's', hours: 'h',
    phase_of: '{a} / {b} min', est_cycle: 'next batch ≈ {n}', active: '· air flowing',
    legend_power: 'Power', legend_level: 'Process level (est.)', legend_holiday: 'Holiday automation', warning: 'Warning',
    ev_legend_start: 'start level', ev_legend_dose: 'dose', ev_legend_batch: 'batch done', ev_legend_warn: 'warning',
    start_s: 'start', low_s: 'low', alarm_s: 'alarm', sludge_emptied_lbl: 'Sludge emptied', days_ago: '{n} d ago',
    ev_legend_restart: 'restart', chem_title: 'Set the chemical amount',
    sludge_now: 'Batches since the sludge was emptied', sludge_note: 'Set 0 after the sedimentation tank has been emptied. The Shelly script adds one for every batch.',
    sludge_title: 'Reset the sludge counter', sludge_to_rem: '≈ {n} d to the reminder', days_ago_est: '≈ {n} d ago', emptied_est: 'emptied ≈ {n} d ago',
  },
  fi: {
    phase: { filling: 'Täyttö', aeration: 'Ilmastus', mixing: 'Sekoitus', dosing: 'Annostelu', settling: 'Laskeutus', waiting: 'Odotus',
      sludge: 'Lietteenpalautus', discharge: 'Ulospumppaus', unknown: 'Tuntematon', offline: 'Ei yhteyttä' },
    sub: { fill: 'pumpun täyttö', dose: 'annos', pulse: 'sekoituspulssi', restart: 'sähkökatkon jälkeen' },
    ctx: { batch: 'panos', wait: 'odotusvaihe', holiday: 'loma-automatiikka', post: 'ulospumppauksen jälkeen' },
    side: 'Sivu', top: 'Ylhäältä', history: 'Historia', now: 'Nyt', live: 'Live',
    last_h: 'viim. {n} h', batches: 'Panokset', week: '7 vrk', per_day: '/vrk', wastewater: 'Jätevesi',
    power: 'Teho', energy: 'Energia', chemical: 'Kemikaali', eta: 'Ulospumppaus', last_batch: 'Viim. panos',
    level: 'Pinta', level_est: 'Pinta (arvio)', est: 'arvio', process_level: 'Prosessisäiliö', sludge_layer: 'Liete',
    emptied: 'tyhjennetty {n} vrk sitten', compressor: 'kompressori', power_lbl: 'teho', off: 'pois',
    logbook: 'Lokikirja', entries: '{n} merkintää', show_more: 'Näytä lisää', show_less: 'Näytä vähemmän',
    ev_start: 'Aloitustaso saavutettu – panos alkoi (täyttö {d}, {n} odotusjaksoa)',
    ev_start_short: 'Aloitustaso saavutettu – panos alkoi (täyttö {d})',
    ev_dose: 'Kemikaaliannos', ev_discharge: 'Ulospumppaus alkoi', ev_batch: 'Panos {n} valmis',
    ev_holiday_on: 'Loma-automatiikka alkoi', ev_holiday_off: 'Loma-automatiikka päättyi',
    ev_offline: 'Datakatko (Shelly tai Home Assistant)',
    ev_restart: 'Puhdistamo käynnistyi sähkökatkon jälkeen – uusi panos esi-ilmastuksesta',
    warn: { high_water: 'Korkea vesi saostussäiliössä – ilmastus ohitettiin tai katkesi', outlet: 'Lähtö tukossa? Pinta ei laskenut ulospumppauksessa',
      high_power: 'Suuri teho – tarkista ilmaletkut ja kompressori', no_power: 'Ei tehoa – tarkista puhdistamon syöttö',
      no_comp: 'Kompressori ei käy', signal: 'Tehosignaali puuttuu', paused: 'Prosessi pysähtynyt? (esim. paneelista)',
      chemical_low: 'Kemikaali vähissä – täytä ja syötä määrä', sludge_due: 'Lietteen tyhjennys ajankohtainen', sludge_emptied: 'Liete tyhjennetty? Nollaa lietelaskuri' },
    chem_now: 'Kemikaalia astiassa nyt', chem_save: 'Tallenna', chem_cancel: 'Peruuta', chem_l: 'l', chem_full: 'täysi astia {n} l',
    chem_cap: 'Täysi astia on {n} l; suurempi määrä tallennetaan {n} litrana.',
    chem_note: 'Laskenta alkaa panoksesta {n}, {d} dl panosta kohden.', chem_need: 'Lisää chemical_amount- ja chemical_refill_counter-kohtiin input_number-apurit, niin määrän voi asettaa tästä (ks. README).',
    chem_note3: 'Shelly-skripti vähentää tästä määrästä 0,4 dl annostelua kohden.', chem_left: '≈ {n} panosta', chem_saved: 'Tallennettu', sludge_rem: 'Lietemuistutus', sludge_rem_v: '{n} / {m} panosta',
    sed_tank: 'Saostussäiliö 2,5 m³', proc_tank: 'Prosessisäiliö 1 m³', control_unit: 'Ohjauskeskus',
    chem_pump: 'Kemikaalin annostuspumppu', inlet: 'Tulo', outlet: 'Lähtö', pump_in: 'Sisäänpumppaus', sludge_ret: 'Lietteenpalautus',
    discharge_in: 'Ulospumppauksen imu', aerator: 'Ilmastin', start_level: 'Aloitustaso', overflow: 'Hälytystaso',
    low_level: 'Ulospumppauksen alaraja', partition: 'Väliseinä', hole: 'reikä', air: 'paineilma', check_valve: 'takaiskuventtiili',
    top_legend: ['Ulospumppausmoduuli', 'Ilmastin', 'Sisäänpumppausmoduuli', 'Ylitäytön anturiputki', 'Aloituksen anturiputki', 'Lietteenpalautusmoduuli'],
    top_colors: ['punainen letku', 'harmaa letku', 'sininen letku', 'musta letku', 'vihreä letku', 'ruskea letku'],
    chem_line: 'Kemikaaliastia', chem_line2: 'keltainen letku', to_cu: '↑ ohjauskeskukselle',
    top_title: 'Prosessisäiliön nousuputki ylhäältä', sed_side: 'saostuksen puoli', proc_side: 'prosessin puoli',
    no_data: 'Odotetaan historiaa…', w: 'W', speed_title: 'Toistonopeus (simuloitua aikaa sekunnissa)', minutes: 'min', seconds: 's', hours: 'h',
    phase_of: '{a} / {b} min', est_cycle: 'seuraava panos ≈ {n}', active: '· ilma virtaa',
    legend_power: 'Teho', legend_level: 'Prosessisäiliön pinta (arvio)', legend_holiday: 'Loma-automatiikka', warning: 'Varoitus',
    ev_legend_start: 'aloitustaso', ev_legend_dose: 'annos', ev_legend_batch: 'panos valmis', ev_legend_warn: 'varoitus',
    start_s: 'aloitus', low_s: 'alaraja', alarm_s: 'hälytys', sludge_emptied_lbl: 'Lietteen tyhjennys', days_ago: '{n} vrk sitten',
    ev_legend_restart: 'uudelleenkäynnistys', chem_title: 'Aseta kemikaalin määrä',
    sludge_now: 'Panoksia lietteen tyhjennyksestä', sludge_note: 'Aseta 0, kun saostussäiliö on tyhjennetty. Shelly-skripti lisää yhden jokaisesta panoksesta.',
    sludge_title: 'Nollaa lietelaskuri', sludge_to_rem: '≈ {n} vrk muistutukseen', days_ago_est: '≈ {n} vrk sitten', emptied_est: 'tyhjennetty ≈ {n} vrk sitten',
  },
};

/* Labels of the visual editor */
const UC_FORM_LABELS = {
  en: { name: 'Name', language: 'Language', lang_auto: 'Home Assistant language', view: 'View', view_side: 'Side section', view_top: 'From above',
    hours: 'Timeline', sludge_emptied: 'Sludge emptied (date)', entities: 'Entities', more: 'Plant settings',
    power: 'Power', phase: 'Phase', cycle: 'Cycle', message: 'Status text', warning: 'Warning', next_pumpout: 'Next pump-out',
    batch_counter: 'Batches', chemical: 'Chemical (l)', sludge: 'Sludge (batches)', energy: 'Energy (optional)',
    batch_volume: 'Batch size', sludge_reminder_batches: 'Sludge reminder (batches)', chemical_capacity: 'Chemical tank size', history_days: 'History',
    help: { sludge_emptied: 'Optional. With the Sludge entity the card estimates the date from the counter.', language: 'Empty: the language of your Home Assistant profile', hours: 'Empty: 6 h', view: 'Empty: side section' } },
  fi: { name: 'Nimi', language: 'Kieli', lang_auto: 'Home Assistantin kieli', view: 'Näkymä', view_side: 'Leikkauskuva', view_top: 'Ylhäältä',
    hours: 'Aikajana', sludge_emptied: 'Liete tyhjennetty (pvm)', entities: 'Entiteetit', more: 'Puhdistamon asetukset',
    power: 'Teho', phase: 'Vaihe', cycle: 'Jakso', message: 'Tilateksti', warning: 'Varoitus', next_pumpout: 'Seuraava ulospumppaus',
    batch_counter: 'Panokset', chemical: 'Kemikaali (l)', sludge: 'Liete (panoksia)', energy: 'Energia (valinnainen)',
    batch_volume: 'Panoksen koko', sludge_reminder_batches: 'Lietemuistutus (panoksia)', chemical_capacity: 'Kemikaaliastian koko', history_days: 'Historia',
    help: { sludge_emptied: 'Valinnainen. Liete-entiteetin kanssa kortti arvioi päivän laskurista.', language: 'Tyhjä: Home Assistant -profiilisi kieli', hours: 'Tyhjä: 6 h', view: 'Tyhjä: leikkauskuva' } },
};

function ucFmt(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}
function ucClamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ucEaseOut(x, k = 3) { x = ucClamp(x, 0, 1); return (1 - Math.exp(-k * x)) / (1 - Math.exp(-k)); }
function ucHash(i, s = 1) { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); }
function ucMedian(a) { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

/* Find last index with arr[i].t <= t (arr sorted by t). Returns -1 if none. */
function ucIdx(arr, t) {
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function ucValAt(arr, t) { const i = ucIdx(arr, t); return i >= 0 ? arr[i].v : (arr.length ? null : null); }

function ucNormPhase(s) {
  if (s === null || s === undefined) return 'unknown';
  const x = String(s).trim().toLowerCase();
  if (x === 'unavailable') return 'offline';
  // v3 phases (option keys or their titles)
  if (/pump[ _-]?in/.test(x)) return 'filling';
  if (/pump[ _-]?out/.test(x)) return 'discharge';
  if (x.includes('chem')) return 'dosing';
  if (x.includes('mix')) return 'aeration';
  if (x.includes('sediment')) return 'settling';
  if (x === 'off' || x === 'no power') return 'offline';
  if (x === 'f' || x.includes('fill') || x.includes('täyt')) return 'filling';
  if (x === 'a' || x.includes('aerat') || x.includes('ilmast')) return 'aeration';
  if (x === 'c' || x.includes('dos') || x.includes('chem') || x.includes('annost') || x.includes('kemik')) return 'dosing';
  if (x === 's' || x.includes('settl') || x.includes('laskeu')) return 'settling';
  if (x === 'w' || x.includes('wait') || x.includes('odotu')) return 'settling';
  if (x === 'r' || x.includes('sludge') || x.includes('liete')) return 'sludge';
  if (x === 'd' || x.includes('disch') || x.includes('ulospump') || x.includes('poisto')) return 'discharge';
  return 'unknown';
}

/* Convert HA history (minimal_response) to [{t(ms), v}] */
function ucFromHA(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    const s = e.s !== undefined ? e.s : e.state;
    let t = e.lc !== undefined ? e.lc : (e.lu !== undefined ? e.lu : (e.last_changed || e.last_updated));
    if (typeof t === 'number') t = t * 1000; else t = Date.parse(t);
    if (!isFinite(t)) continue;
    out.push({ t, v: s });
  }
  out.sort((a, b) => a.t - b.t);
  return ucDropBlips(out);
}
/* Home Assistant marks every entity unavailable for a moment when the Shelly integration reloads or
   reconnects (e.g. after a change in the Shelly's settings). Such blips are not data gaps: entries
   'unavailable'/'unknown' followed by a new value within UC_BLIP_MS are dropped. */
const UC_BLIP_MS = 10e3;
function ucDropBlips(arr) {
  let blips = 0;
  for (let i = 0; i + 1 < arr.length; i++) if ((arr[i].v === 'unavailable' || arr[i].v === 'unknown') && arr[i + 1].t - arr[i].t < UC_BLIP_MS) blips++;
  if (!blips) return arr;
  return arr.filter((e, i) => !((e.v === 'unavailable' || e.v === 'unknown') && i + 1 < arr.length && arr[i + 1].t - e.t < UC_BLIP_MS));
}
function ucMergeSeries(a, b) {
  // merge sorted series, dedupe by time
  if (!a.length) return b.slice(); if (!b.length) return a.slice();
  const out = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const x = j >= b.length || (i < a.length && a[i].t <= b[j].t) ? a[i++] : b[j++];
    if (out.length && Math.abs(out[out.length - 1].t - x.t) < 1) { out[out.length - 1] = x; continue; }
    out.push(x);
  }
  return out;
}
/* Process warning inside a message ("… | Warning: high water" or "Warning: no power, …") -> key or raw text */
function ucWarnOf(msg) {
  if (!msg) return null;
  const m = /Warning:\s*([^|]+)/i.exec(msg); if (!m) return null;
  const w = m[1].trim(), x = w.toLowerCase();
  if (x.startsWith('high water')) return { key: 'high_water', raw: w };
  if (x.startsWith('outlet')) return { key: 'outlet', raw: w };
  if (x.startsWith('high power')) return { key: 'high_power', raw: w };
  if (x.startsWith('no power')) return { key: 'no_power', raw: w };
  if (x.startsWith('compressor not')) return { key: 'no_comp', raw: w };
  if (x.startsWith('power signal')) return { key: 'signal', raw: w };
  return { key: null, raw: w };
}
/* v3 Warning entity (key or title) -> card warning key, null for none */
const UC_V3_WARN = {
  no_power: 'no_power', 'no power to plant': 'no_power', air_leak: 'high_power', 'high power, check air hoses': 'high_power',
  no_signal: 'signal', 'power reading missing': 'signal', compressor_idle: 'no_comp', 'compressor not running': 'no_comp',
  outlet_blocked: 'outlet', 'outlet blocked?': 'outlet', high_water: 'high_water', 'high water': 'high_water',
  paused: 'paused', 'process paused?': 'paused', chemical_low: 'chemical_low', 'chemical low': 'chemical_low',
  sludge_due: 'sludge_due', 'sludge emptying due': 'sludge_due', sludge_emptied: 'sludge_emptied', 'sludge emptied? set sludge to 0': 'sludge_emptied',
};
function ucWarn3(v) {
  if (v === null || v === undefined) return null;
  const x = String(v).trim().toLowerCase();
  if (!x || x === 'none' || x === 'ok' || x === 'unknown' || x === 'unavailable') return null;
  return { key: UC_V3_WARN[x] || null, raw: String(v) };
}
function ucIsHoliday3(v) { const x = String(v || '').toLowerCase(); return x === 'holiday' || x.includes('loma'); }
function ucIsWaitRaw(v) { const x = String(v || '').trim().toLowerCase(); return x === 'w' || x.includes('wait') || x.includes('odotu'); }
function ucParseEta(msg) {
  if (!msg) return null;
  const m = /Pump out in\s+(\d+)\s*(min|s)/i.exec(msg);
  if (!m) return null;
  return parseInt(m[1], 10) * (m[2].toLowerCase() === 'min' ? 60 : 1);
}

/* ---------- History model ---------- */
class UcModel {
  constructor() {
    this.status = []; this.message = []; this.batch = []; this.power = []; this.energy = [];
    this.cycle = []; this.warn3 = []; this.next = []; this.chem = []; this.sludge = [];
    this.segs = []; this.events = []; this.keys = []; this.fills = []; this.holidays = []; this.warnings = [];
    this.stats = {}; this.builtAt = 0;
  }

  build(now) {
    this.now = now;
    for (const k of ['status', 'message', 'batch', 'power', 'energy', 'cycle', 'warn3', 'next', 'chem', 'sludge']) this[k] = ucDropBlips(this[k]);
    this._segments(now);
    this._classify();
    this._levels(now);
    this._messages(now);
    this._events();
    this._stats(now);
    this.builtAt = now;
  }

  _segments(now) {
    const segs = [];
    for (const e of this.status) {
      const p = ucNormPhase(e.v);
      const last = segs[segs.length - 1];
      if (last && last.p === p && ucIsWaitRaw(last.raw) === ucIsWaitRaw(e.v)) continue;
      if (last) last.t1 = e.t;
      segs.push({ p, raw: e.v, t0: e.t, t1: now });
    }
    if (segs.length) segs[segs.length - 1].t1 = Math.max(now, segs[segs.length - 1].t0);
    this.segs = segs;
  }

  _classify() {
    const s = this.segs; let inBatch = false; let afterSludgeInBatch = false;
    for (let i = 0; i < s.length; i++) {
      const g = s[i], prev = s[i - 1], next = s[i + 1];
      g.open = i === s.length - 1;
      g.ctx = 'wait'; g.dp = g.p;
      const now0 = this.now || Date.now();
      // next segment that is not a short transition value (self-test dips last a few seconds)
      let kn = i + 1; while (kn < s.length - 1 && s[kn].t1 - s[kn].t0 < 30e3 && s[kn].p !== 'dosing') kn++;
      const nx = s[kn];
      if (g.p === 'filling') {
        // start level: pump-in followed by aeration, or straight by chemical filling when high water skips the aeration
        g.trip = !!(nx && (nx.p === 'aeration' || nx.p === 'dosing'));
        // the pump-in that follows pump-out (cleaning-cycle phase 12, up to 17 min)
        let kp = i - 1; while (kp >= 0 && (s[kp].p === 'unknown' || (s[kp].t1 - s[kp].t0 < 30e3 && s[kp].p !== 'discharge'))) kp--;
        g.post = kp >= 0 && s[kp].p === 'discharge';
        inBatch = false;
        g.ctx = g.trip ? 'batch' : 'wait';
        if (g.trip) inBatch = true;
      } else if (g.p === 'aeration') {
        const dur = (g.open ? now0 : g.t1) - g.t0;
        if (prev && prev.p === 'dosing') { g.dp = 'mixing'; g.ctx = 'batch'; inBatch = true; }
        else if (prev && prev.p === 'filling') { g.ctx = 'batch'; inBatch = true; }
        else if (dur > 2100e3 && (!prev || ['settling', 'offline', 'unknown'].includes(prev.p))) {
          // firmware: an aeration longer than the wait-cycle 30 min that starts from rest only follows a
          // power-up. With no history before it, or after a rest longer than any firmware wait (2 h:
          // a gap the browser app has not filled from the power history yet), it is only a batch.
          g.ctx = 'batch'; inBatch = true;
          g.restart = !!prev && !(prev.p === 'settling' && prev.t1 - prev.t0 > 7200e3);
        } else g.ctx = inBatch ? 'batch' : 'wait';
      } else if (g.p === 'dosing') { inBatch = true; g.ctx = 'batch'; }
      else if (g.p === 'settling') {
        if (ucIsWaitRaw(g.raw)) inBatch = false;
        g.ctx = inBatch ? 'batch' : 'wait';
        if (g.ctx === 'wait') {
          g.dp = 'waiting';
          // holiday cycle: Waiting II (100 min) follows its 10-min aeration + pump-in; Waiting I (50 min) follows sludge
          // return or the last pump-in of the wait cycle (whose aeration lasted 30 min)
          const pa = i >= 2 ? s[i - 2] : null;
          g.afterFill = !!(prev && prev.p === 'filling' && pa && pa.p === 'aeration' && pa.t1 - pa.t0 < 20 * 60e3);
        }
        if (inBatch && prev && prev.p === 'sludge') g.second = true;
      } else if (g.p === 'sludge') { g.ctx = inBatch ? 'batch' : 'wait'; }
      else if (g.p === 'discharge') {
        g.ctx = 'batch'; inBatch = false;
        // outlet blocked: the start level stayed on, so the plant doses again instead of pumping in
        g.blocked = !!(nx && nx.p === 'dosing' && !g.open);
        if (g.blocked) inBatch = true;
      }
      else if (g.p === 'offline' || g.p === 'unknown') { g.ctx = inBatch ? 'batch' : 'wait'; }
      g.key = g.dp + '/' + (g.ctx === 'batch' ? (g.p === 'settling' && g.second ? 'batch2' : 'batch') : (g.p === 'filling' && g.post ? 'post' : 'wait'));
      afterSludgeInBatch = afterSludgeInBatch && inBatch;
    }
    this.fills = s.filter((g) => g.p === 'filling');
  }

  /* Process-tank level keyframes: 0 = pump-out level, 1 = start level (170 l above).
     - A filling moves the wastewater that flowed in since the previous filling, so its share of the batch
       is proportional to the time since the previous filling, plus the water an earlier sludge return took.
     - A sludge return lowers the level (sludge_return_lpm litres per minute, pumped to the sedimentation tank).
     - Pump-out lowers the level to the pump-out level, faster at first. */
  _levels(now) {
    const s = this.segs; const K = []; const V = this.batchVolume || 170;
    const lps = (this.sludgeLpm || 12) / 60;
    const gaps = [];
    for (let i = 1; i < this.fills.length; i++) {
      const d = this.fills[i].t0 - this.fills[i - 1].t1; if (d > 0 && d < 6 * 3600e3) gaps.push(d);
    }
    this.fillGap = ucMedian(gaps) || 49 * 60e3;
    // inflow span of completed cycles: end of the last filling before the cycle -> start-level trip
    const spans = []; let lastEnd = null, spanStart = null, afterDischarge = false;
    for (const g of s) {
      if (g.p === 'discharge' && !g.open) { afterDischarge = true; spanStart = lastEnd; }
      if (g.p === 'filling' && !g.open) {
        if (g.trip && afterDischarge && spanStart !== null) { spans.push(g.t1 - spanStart); afterDischarge = false; }
        lastEnd = g.t1;
      }
    }
    const Tspan = ucMedian(spans.filter((d) => d > 3600e3 && d < 5 * 86400e3)) || 12 * 3600e3;
    this.cycleMedian = Tspan;
    const dropOf = (g) => {
      const end = g.open ? Math.min(now, g.t0 + (UC_TYP[g.ctx === 'batch' ? 'sludge/batch' : 'sludge/wait'] || 90) * 1000) : g.t1;
      return Math.min(0.3, Math.max(0, (end - g.t0) / 1000) * lps / V);
    };

    // pass 1: inflow share of every filling
    const share = new Map(); let cyc = [], cycStart = null, startKnown = false, prevEnd = null, cycPrevEnd = null;
    const weights = (fl, p0) => fl.map((f, k) => Math.max(60e3, f.t0 - (k === 0 ? (p0 !== null ? p0 : f.t0 - this.fillGap) : fl[k - 1].t1)));
    this.initLevel = null;
    for (const g of s) {
      if (g.p === 'discharge' && !g.open) { cyc = []; cycStart = g.t1; startKnown = true; }
      if (g.p !== 'filling') continue;
      if (!cyc.length) cycPrevEnd = prevEnd;
      cyc.push(g);
      if (g.trip) {
        const w = weights(cyc, cycPrevEnd); const W = w.reduce((x, y) => x + y, 0);
        const L0 = startKnown ? 0 : ucClamp(1 - W / Tspan, 0, 0.9);
        if (this.initLevel === null) this.initLevel = L0;
        cyc.forEach((f, k) => share.set(f, (1 - L0) * w[k] / W));
        cyc = []; startKnown = false;
      }
      if (!g.open) prevEnd = g.t1;
    }
    if (cyc.length) {
      const w = weights(cyc, cycPrevEnd);
      if (this.initLevel === null) this.initLevel = startKnown ? 0 : ucClamp(1 - (now - cyc[0].t0) / Tspan, 0, 0.6);
      cyc.forEach((f, k) => share.set(f, w[k] / Tspan));
    }

    // pass 2: keyframes
    const pushFill = (f, L0, L1, tEnd) => {
      K.push({ t: f.t0, L: L0 });
      const t1 = tEnd !== undefined ? tEnd : f.t1;
      for (let k = 1; k <= 4; k++) { const x = k / 4; K.push({ t: f.t0 + (t1 - f.t0) * x, L: L0 + (L1 - L0) * ucEaseOut(x, 2.5) }); }
    };
    let L = null, pending = 0, inOpen = false;
    for (const g of s) {
      if (g.p === 'filling') {
        if (L === null) L = this.initLevel !== null ? this.initLevel : 0;
        const add = (share.get(g) || 0) + pending; pending = 0;
        let L1;
        if (g.trip) L1 = 1;
        else L1 = Math.min(g.open ? 0.95 : 0.99, L + add);
        if (g.open) pushFill(g, L, L1, g.t0 + (UC_TYP[g.key] || 600) * 1000); else pushFill(g, L, L1);
        L = L1; inOpen = !g.trip;
      } else if (g.p === 'sludge') {
        if (L === null) L = g.ctx === 'batch' ? 1 : 0.5;
        const d = dropOf(g); const end = g.open ? Math.min(now, g.t1) : g.t1;
        const L1 = Math.max(-0.3, L - d);
        K.push({ t: g.t0, L }); K.push({ t: Math.max(end, g.t0 + 1000), L: L1 });
        L = L1; if (g.ctx !== 'batch') pending += d;
      } else if (g.p === 'discharge') {
        const Ls = L === null ? 0.85 : L;
        const dur = g.open ? Math.max(UC_TYP['discharge/batch'] * 1000, now - g.t0) : g.t1 - g.t0;
        if (g.blocked) { K.push({ t: g.t0, L: Ls }); K.push({ t: g.t1, L: Ls }); L = Ls; continue; }
        for (let k = 0; k <= 10; k++) {
          const x = k / 10; const t = g.t0 + dur * x;
          if (g.open && t > now + 60e3) break;
          K.push({ t, L: Ls * (1 - ucEaseOut(x, 2)) });
        }
        if (!g.open) { L = 0; pending = 0; K.push({ t: g.t1, L: 0 }); }
      } else if (g.p === 'dosing' || (g.p === 'aeration' && g.ctx === 'batch' && !g.restart)) {
        if (L === null) { L = 1; K.push({ t: g.t0, L: 1 }); }
      } else if (g.restart && L === null) { L = 0.6; K.push({ t: g.t0, L }); }
    }
    this.openLevel = inOpen ? L : null;
    K.sort((a, b) => a.t - b.t);
    this.keys = K;
  }

  levelAt(t) {
    const K = this.keys; if (!K.length) return 0.5;
    const i = ucIdx(K, t);
    if (i < 0) return K[0].L;
    if (i >= K.length - 1) return K[K.length - 1].L;
    const a = K[i], b = K[i + 1];
    if (b.t === a.t) return b.L;
    return a.L + (b.L - a.L) * (t - a.t) / (b.t - a.t);
  }

  /* Sedimentation tank excess (0..1): rises with inflow and returned sludge water, drops during filling */
  saoAt(t) {
    const F = this.fills; if (!F.length) return 0.5;
    let i = -1, lo = 0, hi = F.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (F[m].t0 <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    const gap = this.fillGap * 1.15;
    if (i < 0) return 0.5;
    const f = F[i];
    const prevEnd = i > 0 ? F[i - 1].t1 : f.t0 - this.fillGap;
    const ret = (a, b) => { // returned sludge water between a and b, scaled to the swing
      let v = 0; const lps = (this.sludgeLpm || 12) / 60;
      for (let k = this.segIndexAt(b); k >= 0; k--) {
        const g = this.segs[k]; if (g.t1 <= a) break;
        if (g.p === 'sludge') v += (Math.min(b, g.t1) - Math.max(a, g.t0)) / 1000 * lps / 30;
      }
      return Math.max(0, v);
    };
    const atStart = ucClamp((f.t0 - prevEnd) / gap + ret(prevEnd, f.t0), 0, 1.4);
    const fEnd = f.open ? f.t0 + (UC_TYP[f.key] || 600) * 1000 : f.t1;
    if (t <= fEnd && (f.open || t <= f.t1)) {
      const x = (t - f.t0) / Math.max(1, fEnd - f.t0);
      return atStart * (1 - ucEaseOut(x, 2.5));
    }
    return ucClamp((t - f.t1) / gap + ret(f.t1, t), 0, 1.4);
  }

  segAt(t) {
    const s = this.segs; if (!s.length) return null;
    let lo = 0, hi = s.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].t0 <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r >= 0 ? s[r] : null;
  }
  segIndexAt(t) {
    const s = this.segs; let lo = 0, hi = s.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].t0 <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }

  _messages(now) {
    const hol = [], warn = []; let h = null, w = null;
    for (const e of this.message) {
      const v = e.v || '';
      if (v === 'unavailable' || v === 'unknown') continue;
      const isH = /^holiday automation/i.test(v);
      const wo = ucWarnOf(v);
      if (isH && !h) h = { t0: e.t, t1: now };
      if (!isH && h) { h.t1 = e.t; hol.push(h); h = null; }
      if (wo && (!w || w.text !== wo.raw)) { if (w) { w.t1 = e.t; warn.push(w); } w = { t0: e.t, t1: now, text: wo.raw, key: wo.key }; }
      if (!wo && w) { w.t1 = e.t; warn.push(w); w = null; }
    }
    if (h) hol.push(h); if (w) warn.push(w);
    // v3: holiday from the Cycle entity, warnings from the Warning entity
    h = null;
    for (const e of this.cycle) {
      if (e.v === 'unavailable' || e.v === 'unknown') continue;
      const isH = ucIsHoliday3(e.v);
      if (isH && !h) h = { t0: e.t, t1: now };
      if (!isH && h) { h.t1 = e.t; hol.push(h); h = null; }
    }
    if (h) hol.push(h);
    w = null;
    for (const e of this.warn3) {
      if (e.v === 'unavailable') continue;
      const wo = ucWarn3(e.v);
      if (wo && (!w || w.text !== wo.raw)) { if (w) { w.t1 = e.t; warn.push(w); } w = { t0: e.t, t1: now, text: wo.raw, key: wo.key }; }
      if (!wo && w) { w.t1 = e.t; warn.push(w); w = null; }
    }
    if (w) warn.push(w);
    hol.sort((a, b) => a.t0 - b.t0); warn.sort((a, b) => a.t0 - b.t0);
    this.holidays = hol; this.warnings = warn;
  }

  _events() {
    const ev = []; const s = this.segs; let waits = 0;
    for (let i = 0; i < s.length; i++) {
      const g = s[i];
      if (g.p === 'filling') {
        if (g.trip) { ev.push({ t: g.t1, type: 'start', dur: (g.t1 - g.t0) / 1000, waits }); waits = 0; }
        else if (!g.open) waits++;
      }
      if (g.p === 'discharge') { ev.push({ t: g.t0, type: 'discharge' }); waits = 0; }
      if (g.p === 'dosing') ev.push({ t: g.t0, type: 'dose' });
      if (g.p === 'offline') ev.push({ t: g.t0, type: 'offline' });
      if (g.restart) { ev.push({ t: g.t0, type: 'restart' }); waits = 0; }
    }
    let prevN = null;
    for (const e of this.batch) {
      const n = parseFloat(e.v); if (!isFinite(n)) continue;
      if (prevN !== null && n > prevN) ev.push({ t: e.t, type: 'batch', n: Math.round(n) });
      prevN = n;
    }
    for (const h of this.holidays) { ev.push({ t: h.t0, type: 'holiday_on' }); if (h.t1 < this.now - 1000) ev.push({ t: h.t1, type: 'holiday_off' }); }
    for (const w of this.warnings) ev.push({ t: w.t0, type: 'warning', text: w.text, key: w.key });
    ev.sort((a, b) => a.t - b.t);
    this.events = ev;
  }

  _stats(now) {
    const day = 86400e3; const st = {};
    // batches per local day for the last 7 days
    const days = []; const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    for (let k = 6; k >= 0; k--) { const a = d0.getTime() - k * day; days.push({ t0: a, t1: a + day, n: 0 }); }
    let count7 = 0;
    for (const e of this.events) {
      if (e.type !== 'batch') continue;
      if (e.t >= now - 7 * day) count7++;
      for (const d of days) if (e.t >= d.t0 && e.t < d.t1) d.n++;
    }
    const first = this.batch.length ? this.batch[0].t : now;
    const span = Math.min(7 * day, now - first);
    st.days = days; st.count7 = count7;
    st.perDay = span > day * 0.9 ? count7 / (span / day) : null;
    // energy per day
    const en = this.energy.filter((e) => isFinite(parseFloat(e.v)) && e.t >= now - 7 * day);
    if (en.length > 1) {
      const a = en[0], b = en[en.length - 1]; const dd = (b.t - a.t) / day;
      if (dd > 0.5) st.kwhDay = (parseFloat(b.v) - parseFloat(a.v)) / dd;
    }
    const lastB = [...this.events].reverse().find((e) => e.type === 'batch');
    st.lastBatch = lastB || null;
    this.stats = st;
  }

  /* Complete visual state at time t */
  stateAt(t, live) {
    const g = this.segAt(t);
    const st = { t, phase: 'unknown', dp: 'unknown', ctx: 'wait', elapsed: 0, typical: null, seg: g };
    if (g) {
      st.phase = g.p; st.dp = g.dp; st.ctx = g.ctx; st.elapsed = (t - g.t0) / 1000; st.typical = UC_TYP[g.key] || null;
      if (g.open && g.p === 'aeration' && g.ctx === 'wait' && st.elapsed > 2100) st.ctx = 'batch';
    }
    const msg = live && live.message !== undefined ? live.message : ucValAt(this.message, t);
    st.message = msg || '';
    st.eta = ucParseEta(st.message);
    if (st.eta !== null && st.phase !== 'filling') st.ctx = 'batch';
    st.holiday = /^holiday automation/i.test(st.message);
    let wo = ucWarnOf(st.message);
    // v3 entities: cycle, warning and next pump-out time
    const v3 = this.cycle.length && t >= this.cycle[0].t;
    if (v3) {
      const cy = live && live.cycle !== undefined ? live.cycle : ucValAt(this.cycle, t);
      st.holiday = ucIsHoliday3(cy);
      wo = ucWarn3(live && live.warning !== undefined ? live.warning : ucValAt(this.warn3, t));
      const nx = live && live.next !== undefined ? live.next : ucValAt(this.next, t);
      const ms = nx ? Date.parse(nx) : NaN;
      st.eta = isFinite(ms) && ms > t ? Math.round((ms - t) / 1000) : null;
      if (st.eta !== null && st.phase !== 'filling') st.ctx = 'batch';
    }
    st.v3 = !!v3;
    st.warning = wo ? wo.raw : null; st.warnKey = wo ? wo.key : null;
    if (g && g.p === 'filling' && g.post) st.ctx = 'post';
    if (st.holiday && g && st.ctx === 'wait') {
      st.ctx = 'holiday';
      st.typical = g.dp === 'waiting' ? UC_TYP[g.afterFill ? 'waiting/holiday2' : 'waiting/holiday1'] : (UC_TYP[g.p + '/holiday'] || st.typical);
    }
    // firmware-based pump-out estimate when the message has none (older script versions, playback)
    st.etaEst = false;
    if (st.eta === null && g && g.ctx === 'batch' && !st.v3) {
      const fw = g.dp === 'settling' && g.second ? UC_FW_TO_PUMPOUT.settling2 : UC_FW_TO_PUMPOUT[g.dp];
      if (fw && !(g.dp === 'aeration' && g.restart && st.elapsed < 2100)) { st.eta = Math.max(0, Math.round(fw - st.elapsed)); st.etaEst = true; }
    }
    const pw = live && live.power !== undefined ? live.power : parseFloat(ucValAt(this.power, t));
    st.power = isFinite(pw) ? pw : null;
    st.running = st.power !== null ? st.power >= 24 : ['filling', 'aeration', 'sludge', 'discharge'].includes(st.phase);
    st.sub = null;
    if (st.phase === 'dosing') st.sub = st.power !== null ? (st.power >= 24 ? 'dose' : 'fill') : (st.elapsed < 90 ? 'fill' : 'dose');
    // MV5 mixing pulse during pump-in: 5 s every 125 s from the start of the pump-in (power about 61-67 W)
    st.pulse = st.phase === 'filling' && (st.power !== null ? st.power >= 58 : (st.elapsed % UC_PULSE.period) < UC_PULSE.on);
    if (st.pulse) st.sub = 'pulse';
    st.restart = !!(g && g.restart);
    // levels
    st.level = this.keys.length ? this.levelAt(t) : 0.5;
    st.levelMM = UC_GEO.lowMM + (UC_GEO.startMM - UC_GEO.lowMM) * st.level;
    st.sao = this.saoAt(t);
    st.saoMM = UC_GEO.saoMM + UC_GEO.saoSwingMM * st.sao;
    // clarity / sludge blanket. Only aeration (and dosing, which happens during aeration) mixes the tank.
    // When aeration starts, the settled sludge is lifted gradually (time constant 90 s), not at once.
    const idx = this.segIndexAt(t);
    // pump-in stirs the tank too (5 s air pulses every 2 min), but more slowly than aeration
    const isMix = (p) => p === 'aeration' || p === 'dosing' || p === 'filling';
    const SETTLE = 7 * 60e3; let MIX = 90e3;
    let km = -1;
    for (let k = idx; k >= 0 && k > idx - 16; k--) if (isMix(this.segs[k].p)) { km = k; break; }
    let qFrom = null, qTo = t, scale = 1;
    if (km >= 0 && km === idx) {
      let ks = idx; while (ks > 0 && isMix(this.segs[ks - 1].p)) ks--;
      const mixStart = this.segs[ks].t0;
      if (this.segs[ks].p === 'filling') MIX = 600e3;
      let kp = -1; for (let k = ks - 1; k >= 0 && k > ks - 16; k--) if (isMix(this.segs[k].p)) { kp = k; break; }
      const c0 = kp >= 0 ? 1 - Math.exp(-(mixStart - this.segs[kp].t1) / SETTLE) : 0;
      st.clarity = c0 * Math.exp(-(t - mixStart) / MIX);
      if (kp >= 0) { qFrom = this.segs[kp].t1; qTo = mixStart; scale = c0 > 0 ? st.clarity / c0 : 0; }
    } else if (km >= 0) {
      qFrom = this.segs[km].t1; st.clarity = 1 - Math.exp(-(t - qFrom) / SETTLE);
    } else st.clarity = 0;
    st.mixing = km >= 0 && km === idx;
    st.blanketMM = UC_GEO.blanketMM + (st.levelMM - UC_GEO.blanketMM) * (1 - st.clarity);
    // sludge pumped from the bottom since the last mixing lowers the sludge blanket by the same volume
    st.sludgeOut = 0;
    if (qFrom !== null) {
      const mmPerL = (UC_GEO.startMM - UC_GEO.lowMM) / (this.batchVolume || 170); const lps = (this.sludgeLpm || 12) / 60;
      for (let k = idx; k >= 0 && this.segs[k].t1 > qFrom; k--) {
        const s = this.segs[k];
        if (s.p === 'sludge' && s.t0 < qTo) st.sludgeOut += Math.max(0, (Math.min(qTo, s.t1) - s.t0) / 1000) * lps * mmPerL;
      }
      st.sludgeOut *= scale;
    }
    st.blanketMM = Math.max(120, st.blanketMM - st.sludgeOut);
    if (g && g.p === 'sludge') st.sludgeProg = ucClamp(st.elapsed / (st.typical || 120), 0, 1);
    st.sludgeAge = null; st.sludgeDur = 0;
    for (let k = idx; k >= 0 && k > idx - 6; k--) {
      const s = this.segs[k];
      if (s.p === 'sludge') { const a = (t - s.t0) / 1000; if (a < 600) { st.sludgeAge = a; st.sludgeDur = (Math.min(t, s.t1) - s.t0) / 1000; } break; }
    }
    // chemical tint
    st.tint = 0;
    for (let k = idx; k >= 0 && k > idx - 4; k--) {
      const s = this.segs[k];
      if (s.p === 'dosing') {
        const x = (t - (s.t0 + 90e3)) / 1000;
        if (x > 0) st.tint = 0.14 * Math.exp(-x / 150);
        break;
      }
    }
    // dosing sub-phase progress
    if (st.phase === 'dosing') {
      const fillDur = 90, doseDur = 10;
      st.chamber = st.sub === 'fill' ? ucClamp(st.elapsed / fillDur, 0, 1) : ucClamp(1 - (st.elapsed - fillDur) / doseDur, 0, 1);
      if (st.sub === 'dose' && st.elapsed < fillDur) st.chamber = 0.6;
    } else st.chamber = 0;
    // flow strength for mammoth pumps
    st.flow = 1;
    if (st.phase === 'discharge') st.flow = 0.25 + 0.75 * st.level;
    if (st.phase === 'filling') { const x = st.elapsed / 600; st.flow = 0.35 + 0.65 * (1 - ucEaseOut(x, 2)); }
    return st;
  }
}
/* Uponor Clean Card – side section view */
const UC_Y = (h) => 632 - 0.36 * h;
// Partition wall traced from the manufacturer's cross-section (Clean I manual, p. 18): it bulges
// slightly into the process tank and comes down almost vertically to the floor.
const UC_PART = [[631, UC_Y(1125)], [671, 358], [660, 505], [604, 596]];
const UC_PART_FOOT = [[597.2, 607.1], [596, 638]];   // quadratic end: tangent continues the curve, ends vertical
// recesses in the tank bottom [x1, x2, height] (outer outline). The drawing keeps the bottom flat;
// the manufacturer's drawing has recesses at x 184-245, 363-453, 506-596 and 741-793.
const UC_NOTCHES = [];
function ucFloor(floorY, inset, r) {
  // tank bottom from right to left with the recesses; inset widens them for the inner outline
  let d = '';
  for (const [x1, x2, h] of [...UC_NOTCHES].sort((a, b) => b[1] - a[1])) {
    const X1 = x1 - inset, X2 = x2 + inset, roof = floorY - h;
    d += ` H${X2 + r} Q${X2} ${floorY} ${X2} ${floorY - r} V${roof + r} Q${X2} ${roof} ${X2 - r} ${roof}` +
      ` H${X1 + r} Q${X1} ${roof} ${X1} ${roof + r} V${floorY - r} Q${X1} ${floorY} ${X1 - r} ${floorY}`;
  }
  return d;
}
function ucPartX(y) {
  // x of partition curve at y (bezier sampled)
  let best = UC_PART[0][0], bd = 1e9;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, u = 1 - t;
    const py = u * u * u * UC_PART[0][1] + 3 * u * u * t * UC_PART[1][1] + 3 * u * t * t * UC_PART[2][1] + t * t * t * UC_PART[3][1];
    const d = Math.abs(py - y);
    if (d < bd) { bd = d; best = u * u * u * UC_PART[0][0] + 3 * u * u * t * UC_PART[1][0] + 3 * u * t * t * UC_PART[2][0] + t * t * t * UC_PART[3][0]; }
  }
  return best;
}

const UC_SIDE = {
  pumpIn: { leg: 590, intake: 560, intakeTop: 430, bot: 571, top: 204, spoutX: 696, spoutY: 236, src: 'sao', dst: 'proc', color: '#8F8A74', hose: 'blue', phase: 'filling' },
  sludge: { leg: 726, bot: 585, top: 188, spoutX: 540, spoutY: 254, src: 'proc', dst: 'sao', color: '#6B4A22', hose: 'brown', phase: 'sludge' },
  discharge: { leg: 852, intake: 880, intakeTop: 351, bot: 578, top: 232, spoutX: 1000, spoutY: 232, src: 'proc', dst: 'out', color: '#7FB2DE', hose: 'red', phase: 'discharge' },
};
function ucRoundPath(pts, r = 10) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - (x1 - x0) / l1 * rr, ay = y1 - (y1 - y0) / l1 * rr, bx = x1 + (x2 - x1) / l2 * rr, by = y1 + (y2 - y1) / l2 * rr;
    d += ` L${ax.toFixed(1)} ${ay.toFixed(1)} Q${x1} ${y1} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const L = pts[pts.length - 1]; return d + ` L${L[0]} ${L[1]}`;
}
const UC_SIDE_HOSE_PTS = {
  black: [[600, 144], [600, 178], [520, 178], [520, 184]],
  blue: [[614, 144], [614, 212], [604, 212], [604, 562], [596, 562]],
  brown: [[628, 144], [628, 194], [740, 194], [740, 560], [732, 560]],
  gray: [[642, 144], [642, 186], [756, 186], [756, 568]],
  green: [[656, 144], [656, 180], [812, 180], [812, 182]],
  red: [[670, 144], [670, 176], [842, 176], [842, 566], [846, 566]],
  yellow: [[694, 120], [718, 120], [718, 158]],
};
const UC_SIDE_HOSES = Object.fromEntries(Object.entries(UC_SIDE_HOSE_PTS).map(([k, p]) => [k, ucRoundPath(p, 11)]));
const UC_LED_KEYS = ['comp', 'dos', 'sludge', 'out', 'in', 'aer'];
function ucLedOn(S) {
  return { comp: !!S.running, dos: S.phase === 'dosing', sludge: S.phase === 'sludge', out: S.phase === 'discharge', in: S.phase === 'filling', aer: S.phase === 'aeration' };
}

function ucSideMarkup(T) {
  const y = UC_Y;
  const [p0, p1, p2, p3] = UC_PART, [f1, f2] = UC_PART_FOOT;
  const part = `M${p0[0]} ${p0[1]} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]} Q${f1[0]} ${f1[1]} ${f2[0]} ${f2[1]}`;
  const partRev = `Q${f1[0]} ${f1[1]} ${p3[0]} ${p3[1]} C${p2[0]} ${p2[1]} ${p1[0]} ${p1[1]} ${p0[0]} ${p0[1]}`;
  const tankOuter = `M108 170 H892 Q940 170 942 222 L944 588 Q942 640 892 640${ucFloor(640, 0, 5)} H108 Q58 640 56 588 L58 222 Q60 170 108 170 Z`;
  const tankInner = `M110 174 H890 Q936 174 938 224 L940 586 Q938 636 890 636${ucFloor(636, 4, 5)} H110 Q62 636 60 586 L62 224 Q64 174 110 174 Z`;
  const P = UC_SIDE;
  const pipeD = {
    pumpIn: `M${P.pumpIn.intake} ${P.pumpIn.intakeTop} V${P.pumpIn.bot - 10} Q${P.pumpIn.intake} ${P.pumpIn.bot + 4} ${(P.pumpIn.intake + P.pumpIn.leg) / 2} ${P.pumpIn.bot + 4} Q${P.pumpIn.leg} ${P.pumpIn.bot + 4} ${P.pumpIn.leg} ${P.pumpIn.bot - 10} V${P.pumpIn.top + 8} Q${P.pumpIn.leg} ${P.pumpIn.top} ${P.pumpIn.leg + 8} ${P.pumpIn.top} H${P.pumpIn.spoutX - 8} Q${P.pumpIn.spoutX} ${P.pumpIn.top} ${P.pumpIn.spoutX} ${P.pumpIn.top + 8} V${P.pumpIn.spoutY - 18}`,
    sludge: `M${P.sludge.leg} ${P.sludge.bot} V${P.sludge.top + 8} Q${P.sludge.leg} ${P.sludge.top} ${P.sludge.leg - 8} ${P.sludge.top} H${P.sludge.spoutX + 8} Q${P.sludge.spoutX} ${P.sludge.top} ${P.sludge.spoutX} ${P.sludge.top + 8} V${P.sludge.spoutY - 20}`,
    discharge: `M${P.discharge.intake + 24} ${P.discharge.intakeTop} H${P.discharge.intake + 8} Q${P.discharge.intake} ${P.discharge.intakeTop} ${P.discharge.intake} ${P.discharge.intakeTop + 8} V${P.discharge.bot - 10} Q${P.discharge.intake} ${P.discharge.bot + 4} ${(P.discharge.intake + P.discharge.leg) / 2} ${P.discharge.bot + 4} Q${P.discharge.leg} ${P.discharge.bot + 4} ${P.discharge.leg} ${P.discharge.bot - 10} V${P.discharge.top + 8} Q${P.discharge.leg} ${P.discharge.top} ${P.discharge.leg + 8} ${P.discharge.top} H934`,
  };
  const pipe = (d) => `<path d="${d}" class="pipe-o" stroke-width="12"/><path d="${d}" class="pipe-i" stroke-width="7.5"/>`;
  // The water in a tube is painted like the tank liquid it came from: the tank's gradient, then
  // the mixed-liquor (-wm) and chemical-tint (-wt) layers when they are present at the opening.
  const tube = (x, top, bot, id, color, paint) => `
    <g class="stube" id="${id}">
      <rect x="${x - 9}" y="${top}" width="18" height="${bot - top}" rx="3" class="tube-o"/>
      <rect x="${x - 6}" y="${top + 3}" width="12" height="${bot - top - 3}" class="tube-air"/>
      <rect id="${id}-w" x="${x - 6}" y="${bot}" width="12" height="0" fill="${paint}"/>
      <rect id="${id}-wm" x="${x - 6}" y="${bot}" width="12" height="0" fill="url(#ucMixG)" opacity="0"/>
      <rect id="${id}-wt" x="${x - 6}" y="${bot}" width="12" height="0" class="w-tint" opacity="0"/>
      <path d="M${x - 5} ${top + 6} V${bot - 4}" class="tube-hl"/>
      <rect x="${x - 11}" y="${top - 6}" width="22" height="8" rx="2" class="cap"/>
      <circle cx="${x}" cy="${top - 10}" r="4" fill="#3BA3E8"/>
      <circle id="${id}-g0" cx="${x + 20}" cy="${top + 2}" r="7" class="gauge-bg"/>
      <circle id="${id}-g" cx="${x + 20}" cy="${top + 2}" r="7" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="0 44" transform="rotate(-90 ${x + 20} ${top + 2})"/>
    </g>`;
  const scale = (x, side, marks, id) => {
    let o = `<line x1="${x}" y1="${y(1210)}" x2="${x}" y2="${y(700)}" class="sc-line"/><text x="${x}" y="${y(1210) - 6}" class="sc-lbl" text-anchor="middle">mm</text>`;
    for (let h = 700; h <= 1200; h += 50) { const L = h % 100 === 0 ? 6 : 3; o += `<line x1="${x}" x2="${x + side * L}" y1="${y(h).toFixed(1)}" y2="${y(h).toFixed(1)}" class="sc-tick"/>`; }
    for (const [h, lab, dy] of marks) {
      const tx = x + side * 10, an = side > 0 ? 'start' : 'end', yy = y(h) + (dy || 0);
      o += `<line x1="${x}" x2="${x + side * 8}" y1="${y(h).toFixed(1)}" y2="${y(h).toFixed(1)}" class="sc-key"/>`;
      o += `<text x="${tx}" y="${(yy + 4).toFixed(1)}" class="sc-num" text-anchor="${an}">${h}</text><text x="${tx}" y="${(yy + 14).toFixed(1)}" class="sc-lbl" text-anchor="${an}">${lab}</text>`;
    }
    return o + `<path id="${id}" class="sc-mark ${id}" d="M0 0"/>`;
  };
  const hoseEls = Object.entries(UC_SIDE_HOSES).map(([k, d]) =>
    `<path d="${d}" class="hose-sh"/><path d="${d}" class="hose" stroke="${UC_HOSE[k]}" id="sh-${k}"/><path d="${d}" class="hose-flow" id="shf-${k}"/>`).join('');
  return `
  <svg viewBox="0 56 1000 620" class="side" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${T.sed_tank} / ${T.proc_tank}">
    <defs>
      <clipPath id="ucTank"><path d="${tankInner}"/></clipPath>
      <linearGradient id="ucSoilG" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0"><stop offset="0" stop-color="#8c6e46" stop-opacity="0"/><stop offset=".06" stop-color="#8c6e46" stop-opacity=".08"/><stop offset=".94" stop-color="#8c6e46" stop-opacity=".08"/><stop offset="1" stop-color="#8c6e46" stop-opacity="0"/></linearGradient>
      <linearGradient id="ucGroundG" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0"><stop offset="0" stop-color="#785f3c" stop-opacity="0"/><stop offset=".06" stop-color="#785f3c" stop-opacity=".5"/><stop offset=".94" stop-color="#785f3c" stop-opacity=".5"/><stop offset="1" stop-color="#785f3c" stop-opacity="0"/></linearGradient>
      <linearGradient id="ucFadeW" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".07" stop-color="#fff"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="ucSoilM"><rect x="0" y="100" width="1000" height="580" fill="url(#ucFadeW)"/></mask>
      <pattern id="ucSoilP" width="34" height="26" patternUnits="userSpaceOnUse"><g fill="#7d6240" fill-opacity=".28">
        <circle cx="4" cy="5" r="1.5"/><circle cx="17" cy="3" r="1"/><circle cx="12" cy="15" r="2"/><circle cx="27" cy="18" r="1.3"/><circle cx="4" cy="21" r=".9"/><circle cx="29" cy="7" r="2.3" fill-opacity=".14"/><circle cx="21" cy="24" r=".8"/></g></pattern>
      <linearGradient id="ucSaoG" gradientUnits="userSpaceOnUse" x1="0" y1="250" x2="0" y2="640"><stop offset="0" stop-color="#a39f8c" stop-opacity=".34"/><stop offset="1" stop-color="#6c6754" stop-opacity=".58"/></linearGradient>
      <linearGradient id="ucClearG" gradientUnits="userSpaceOnUse" x1="0" y1="260" x2="0" y2="640"><stop offset="0" stop-color="#9ccbef" stop-opacity=".24"/><stop offset="1" stop-color="#3a78b0" stop-opacity=".36"/></linearGradient>
      <linearGradient id="ucMixG" gradientUnits="userSpaceOnUse" x1="0" y1="260" x2="0" y2="640"><stop offset="0" stop-color="#957444" stop-opacity=".5"/><stop offset="1" stop-color="#553a1b" stop-opacity=".82"/></linearGradient>
      <linearGradient id="ucSludgeG" gradientUnits="userSpaceOnUse" x1="0" y1="560" x2="0" y2="640"><stop offset="0" stop-color="#6a4c26" stop-opacity=".55"/><stop offset="1" stop-color="#3f2b14" stop-opacity=".85"/></linearGradient>
      <radialGradient id="ucShadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="ucPipeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dde1e6"/><stop offset=".45" stop-color="#aab2bb"/><stop offset="1" stop-color="#858d96"/></linearGradient>
      <linearGradient id="ucChemG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e2c65a"/><stop offset=".5" stop-color="#f3dc7e"/><stop offset="1" stop-color="#d9b944"/></linearGradient>
      <clipPath id="ucL"><path d="M-10 -10 H${p0[0]} V${p0[1]} ${part.slice(part.indexOf('C'))} V700 H-10 Z"/></clipPath>
      <clipPath id="ucR"><path d="M${p0[0]} -10 H1010 V700 H${f2[0]} V${f2[1]} ${partRev} Z"/></clipPath>
      <clipPath id="ucChemC"><path d="M712 99 Q712 95 717 95 H753 Q758 95 758 99 V165 Q758 168 755 168 H715 Q712 168 712 165 Z"/></clipPath>
    </defs>
    <rect x="0" y="104" width="1000" height="576" fill="url(#ucSoilG)"/>
    <rect x="0" y="104" width="1000" height="576" fill="url(#ucSoilP)" mask="url(#ucSoilM)"/>
    <line x1="0" y1="104" x2="1000" y2="104" class="ground" stroke="url(#ucGroundG)"/>
    <!-- risers -->
    <rect x="214" y="84" width="202" height="90" class="riser-in"/>
    <rect x="569" y="84" width="202" height="90" class="riser-in"/>
    <!-- tank -->
    <ellipse cx="500" cy="647" rx="472" ry="13" fill="url(#ucShadow)"/>
    <path d="${tankOuter}" class="tank-bg"/>
    <g clip-path="url(#ucTank)">
      <g clip-path="url(#ucL)">
        <path id="s-sao" fill="url(#ucSaoG)"/>
        <g id="s-sparts"></g>
        <path id="s-sludge" fill="url(#ucSludgeG)"/>
        <g id="s-plume"></g>
        <path id="s-scum" class="w-scum"/>
        <path id="s-sao-line" class="w-line"/>
        <path id="s-sao-shine" class="shine"/>
      </g>
      <g clip-path="url(#ucR)">
        <path id="s-clear" fill="url(#ucClearG)"/>
        <path id="s-mixed" fill="url(#ucMixG)"/>
        <path id="s-tint" class="w-tint"/>
        <g id="s-flocs"></g>
        <g id="s-bubbles"></g>
        <path id="s-proc-line" class="w-line"/>
        <path id="s-proc-shine" class="shine"/>
      </g>
      <g id="s-splash"></g>
    </g>
    <path d="${tankOuter}" class="tank-edge"/>
    <path d="${tankOuter}" class="tank-wall"/>
    <path d="M221 170 H409 M576 170 H764" class="tank-open"/>
    <path d="M214 174 V84 M416 174 V84 M569 174 V84 M771 174 V84" class="wall-edge"/>
    <path d="M214 174 V84 M416 174 V84 M569 174 V84 M771 174 V84" class="wall-body"/>
    <rect x="206" y="74" width="218" height="10" rx="4" class="lid"/><rect x="561" y="74" width="218" height="10" rx="4" class="lid"/>
    <path d="M210 76.5 H420 M565 76.5 H775" class="lid-hl"/>
    <path d="${part}" class="partition"><title>${T.partition}</title></path>
    <!-- level lines and height scales -->
    <line x1="${ucPartX(y(UC_GEO.startMM))}" y1="${y(UC_GEO.startMM)}" x2="938" y2="${y(UC_GEO.startMM)}" class="lvl"/>
    <line x1="${ucPartX(y(UC_GEO.lowMM))}" y1="${y(UC_GEO.lowMM)}" x2="938" y2="${y(UC_GEO.lowMM)}" class="lvl"/>
    <line x1="62" y1="${y(UC_GEO.alarmMM)}" x2="600" y2="${y(UC_GEO.alarmMM)}" class="lvl alarm"/>
    ${scale(953, 1, [[UC_GEO.outletMM, T.outlet, -30], [UC_GEO.startMM, T.start_s], [UC_GEO.lowMM, T.low_s]], 'sc-proc')}
    ${scale(47, -1, [[UC_GEO.inletMM, T.inlet, -26], [UC_GEO.alarmMM, T.alarm_s, 8]], 'sc-sao')}
    <!-- inlet / outlet -->
    <rect x="0" y="${y(UC_GEO.inletMM) - 7}" width="66" height="14" fill="url(#ucPipeG)"/>
    <rect x="934" y="${y(UC_GEO.outletMM) - 7}" width="66" height="14" fill="url(#ucPipeG)"/>
    <path id="s-outflow" d="M858 ${y(UC_GEO.outletMM)} H1000" class="outflow"/>
    <!-- sensor tubes -->
    <g><title>${T.overflow}</title>${tube(520, 184, y(UC_GEO.blackTubeBottomMM), 'tb', '#444', 'url(#ucSaoG)')}</g>
    <g><title>${T.start_level}</title>${tube(812, 182, y(UC_GEO.greenTubeBottomMM), 'tg', UC_HOSE.green, 'url(#ucClearG)')}</g>
    <!-- aerator -->
    <path d="M756 188 V566" class="rigid"/><path d="M754.5 190 V562" class="rigid-hl"/>
    <rect x="748" y="562" width="16" height="9" rx="2" class="nut"/>
    <circle cx="756" cy="${y(140)}" r="13" class="ball"><title>${T.aerator}</title></circle>
    <circle cx="751" cy="${y(140) - 5}" r="3.5" class="ball-hl"/>
    <!-- mammoth modules -->
    <g id="m-pumpIn"><title>${T.pump_in}</title>${pipe(pipeD.pumpIn)}<path d="M${P.pumpIn.intake - 9} ${P.pumpIn.intakeTop - 6} h18" class="flare"/></g>
    <g id="m-sludge"><title>${T.sludge_ret}</title>${pipe(pipeD.sludge)}<path d="M${P.sludge.leg - 9} ${P.sludge.bot + 4} h18" class="flare"/></g>
    <g id="m-discharge"><title>${T.discharge_in}</title>${pipe(pipeD.discharge)}
      <path d="M${P.discharge.intake + 22} ${P.discharge.intakeTop - 6} L${P.discharge.intake + 40} ${P.discharge.intakeTop - 17} V${P.discharge.intakeTop + 17} L${P.discharge.intake + 22} ${P.discharge.intakeTop + 6}" class="funnel"/></g>
    <g id="s-liquid"></g>
    <g id="s-slugs"></g>
    <g class="pipe-hl" transform="translate(-2.4 -2.4)">${Object.values(pipeD).map((d) => `<path d="${d}"/>`).join('')}</g>
    <!-- hoses -->
    ${hoseEls}
    <rect x="593" y="149" width="84" height="6" rx="2" class="clamp"/>
    <circle cx="596" cy="562" r="3.2" class="inj"/><circle cx="732" cy="560" r="3.2" class="inj"/><circle cx="846" cy="566" r="3.2" class="inj"/>
    <!-- control unit -->
    <rect x="582" y="88" width="122" height="60" rx="7" class="box"/>
    <path d="M589 88 H697 Q704 88 704 95 V97 H582 V95 Q582 88 589 88 Z" class="box-lid"/>
    <g id="s-comp"><rect x="590" y="101" width="48" height="22" rx="6" class="comp"/>
      ${[0, 1, 2, 3, 4].map((i) => `<line x1="${596 + i * 6}" y1="104" x2="${596 + i * 6}" y2="120" class="fin"/>`).join('')}
      <circle cx="630" cy="112" r="5" class="comp-d"/></g>
    ${UC_LED_KEYS.map((k, i) => `<rect id="sl-${k}" x="${646 + i * 9}" y="103" width="6" height="6" rx="1" class="led-s"/>`).join('')}
    <g id="s-valves">
      ${['black', 'blue', 'brown', 'gray', 'green', 'red'].map((k, i) => `<rect x="${596 + i * 14}" y="130" width="8" height="14" rx="1.5" class="vbody"/><circle id="sv-${k}" cx="${600 + i * 14}" cy="130" r="3.6" fill="${UC_HOSE[k]}" class="valve"/>`).join('')}
      <rect x="690" y="108" width="8" height="12" rx="1.5" class="vbody"/><circle id="sv-yellow" cx="694" cy="108" r="3.6" fill="${UC_HOSE.yellow}" class="valve"/>
    </g>
    <text x="642" y="66" class="lbl" text-anchor="middle">${T.control_unit}</text>
    <!-- chemical tank in riser -->
    <path d="M712 99 Q712 95 717 95 H753 Q758 95 758 99 V165 Q758 168 755 168 H715 Q712 168 712 165 Z" class="chem-tank"/>
    <rect x="721" y="88" width="28" height="8" rx="2.5" class="chem-cap"/><path d="M725 89.5 V94.5 M729 89.5 V94.5 M733 89.5 V94.5 M737 89.5 V94.5 M741 89.5 V94.5 M745 89.5 V94.5" class="cap-rib"/>
    <path d="M758 101 H763 V113 H758" class="chem-bail"/><path d="M758 146 H763 V158 H758" class="chem-bail"/>
    <g clip-path="url(#ucChemC)"><rect id="s-chem-liq" x="712" y="120" width="46" height="48" fill="url(#ucChemG)" class="chem-liq"/></g>
    <rect x="724" y="156" width="22" height="9" rx="2" class="chem-pump"/>
    <text id="s-chem-pct" x="735" y="114" class="chem-pct" text-anchor="middle"></text>
    <path id="s-chem-drip" d="M758 118 H767 V300" class="chem-drip"/>
    <!-- labels -->
    <text x="548" y="446" class="lbl halo" text-anchor="end">${T.pump_in}</text>
    <text x="756" y="616" class="lbl halo" text-anchor="middle">${T.aerator}</text>
    <text x="340" y="668" class="tlbl" text-anchor="middle">${T.sed_tank}</text>
    <text x="790" y="668" class="tlbl" text-anchor="middle">${T.proc_tank}</text>
    <!-- value pills -->
    <g id="p-power" class="pill-g"><text x="492" y="122" class="plbl" text-anchor="middle">${T.power_lbl}</text>
      <rect x="452" y="128" width="80" height="22" rx="11" class="pill"/><text x="492" y="144" class="pval" text-anchor="middle">–</text></g>
    <g id="p-proc" class="pill-g"><text x="856" y="122" class="plbl" text-anchor="middle">${T.level_est}</text>
      <rect x="806" y="128" width="100" height="22" rx="11" class="pill blue"/><text x="856" y="144" class="pval" text-anchor="middle">–</text></g>
    <g id="p-sao" class="pill-g"><text x="315" y="198" class="plbl" text-anchor="middle">${T.sludge_layer}</text>
      <rect x="265" y="204" width="100" height="22" rx="11" class="pill brown"/><text x="315" y="220" class="pval" text-anchor="middle">–</text></g>
  </svg>`;
}

function ucInsetGroup(T, x, y, s = 1) {
  return `<g transform="translate(${x - 22 * s} ${y - 18 * s}) scale(${s})" class="inset-g">
      <rect id="i-liq" x="66" y="70" width="90" height="80" class="chem-liq2"/>
      <path d="M66 40 V150 H156 V40" class="inset-tank"/>
      <path d="M214 36 H134 V124" class="itube-o"/><path d="M214 36 H134 V124" class="itube-i"/>
      <path id="i-air" d="M214 36 H134 V124" class="hose-flow"/>
      <path d="M104 146 V30 H34 V86" class="itube-o"/><path d="M104 146 V30 H34 V86" class="itube-i"/>
      <path id="i-out" d="M104 146 V80" class="itube-liq"/>
      <circle cx="104" cy="58" r="2.4" class="hole"/>
      <rect x="86" y="124" width="60" height="24" rx="3" class="chamber"/>
      <rect id="i-ch" x="88" y="146" width="56" height="0" class="chem-liq3"/>
      <path d="M110 146 v4 M122 146 v4" class="seat"/>
      <circle id="i-ball" cx="116" cy="146" r="4.6" class="ballv"/>
      <g id="i-drops"></g>
      <text x="212" y="28" class="ilbl" text-anchor="end">← ${T.air}</text>
      <text x="98" y="62" class="ilbl" text-anchor="end">${T.hole}</text>
      <text x="116" y="166" class="ilbl" text-anchor="middle">${T.check_valve}</text>
    </g>`;
}

class UcSide {
  constructor(svg, root) {
    this.svg = svg; this.q = (id) => root.getElementById(id);
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, parent, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    this.mk = mk;
    this.flocs = []; const fg = this.q('s-flocs');
    for (let i = 0; i < 46; i++) {
      const e = mk('circle', fg, { r: (1.3 + ucHash(i, 3) * 1.8).toFixed(1), class: 'floc' });
      this.flocs.push({ e, x: 700 + ucHash(i, 1) * 220, y: 400 + ucHash(i, 2) * 200, i });
    }
    this.bubbles = []; const bg = this.q('s-bubbles');
    for (let i = 0; i < 52; i++) this.bubbles.push(mk('circle', bg, { r: 2, class: 'bubble' }));
    this.slugs = {}; const sg = this.q('s-slugs'); const lg = this.q('s-liquid');
    this.liquid = {};
    for (const k of Object.keys(UC_SIDE)) {
      this.liquid[k] = { riser: mk('path', lg, { class: 'liq', stroke: UC_SIDE[k].color }), mix: mk('path', lg, { class: 'liq', stroke: 'url(#ucMixG)' }), tint: mk('path', lg, { class: 'liq liq-tint' }), intake: mk('path', lg, { class: 'liq', stroke: UC_SIDE[k].color }), stream: mk('path', lg, { class: 'stream', stroke: UC_SIDE[k].color }), flow: mk('path', lg, { class: 'pflow' }) };
      this.slugs[k] = []; for (let j = 0; j < 6; j++) this.slugs[k].push(mk('rect', sg, { width: 6, height: 12, rx: 3, x: UC_SIDE[k].leg - 3, class: 'slug' }));
    }
    this.sparts = []; const spg = this.q('s-sparts');
    for (let i = 0; i < 28; i++) { const e = mk('circle', spg, { r: (0.9 + ucHash(i, 81) * 1.4).toFixed(1), class: 'spart' }); this.sparts.push({ e, x: 80 + ucHash(i, 82) * 540, y: 300 + ucHash(i, 83) * 200, i }); }
    this.plume = []; const plg = this.q('s-plume');
    for (let i = 0; i < 12; i++) this.plume.push(mk('circle', plg, { r: (1.4 + ucHash(i, 91) * 1.6).toFixed(1), class: 'plume' }));
    this.splashes = []; const sp = this.q('s-splash');
    for (let i = 0; i < 3; i++) this.splashes.push(mk('ellipse', sp, { rx: 4, ry: 1.5, class: 'splash' }));
    this.drops = []; const dg = this.q('i-drops');
    for (let i = 0; i < 4; i++) this.drops.push(mk('circle', dg, { r: 1.8, class: 'drop' }));
    this.pillT = 0;
  }

  _wave(x0, x1, y, amp, t, k = 1, bottom = 640) {
    let d = '', line = '';
    for (let x = x0; x <= x1; x += 8) {
      const yy = y + amp * (Math.sin(x * 0.045 * k + t * 2.1) + 0.55 * Math.sin(x * 0.11 * k - t * 3.4));
      d += (x === x0 ? 'M' : 'L') + x + ' ' + yy.toFixed(1) + ' ';
    }
    line = d;
    d += `L${x1} ${bottom} L${x0} ${bottom} Z`;
    return { fill: d, line };
  }

  update(S, t, dt, ctx) {
    const y = UC_Y; const q = this.q;
    const active = { filling: S.phase === 'filling', sludge: S.phase === 'sludge', discharge: S.phase === 'discharge',
      aer: S.phase === 'aeration', dose: S.phase === 'dosing' };
    const procY = y(S.levelMM), saoY = y(S.saoMM);
    // surfaces
    const ampP = active.aer ? 2.6 : active.filling ? 1.1 : 0.45;
    const wp = this._wave(590, 944, procY, ampP, t, 1.2);
    q('s-clear').setAttribute('d', wp.fill);
    q('s-proc-line').setAttribute('d', wp.line);
    const blY = y(S.blanketMM);
    const mixedTop = Math.max(procY, blY);
    const wm = S.clarity < 0.02 ? wp : this._wave(590, 944, mixedTop, S.mixing ? 2.2 : 0.8, S.mixing ? t * 0.9 : t * 0.3, 0.7);
    q('s-mixed').setAttribute('d', wm.fill);
    q('s-mixed').style.opacity = (0.55 + 0.35 * S.clarity).toFixed(2);
    q('s-tint').setAttribute('d', wp.fill); q('s-tint').style.opacity = S.tint.toFixed(3);
    const ws = this._wave(56, 724, saoY, active.filling ? 0.9 : 0.35, t * 0.8, 0.8);
    q('s-sao').setAttribute('d', ws.fill); q('s-sao-line').setAttribute('d', ws.line);
    const sc = this._wave(56, 724, saoY, active.filling ? 0.9 : 0.35, t * 0.8, 0.8, saoY + 5);
    q('s-scum').setAttribute('d', sc.fill);
    q('s-proc-shine').setAttribute('d', this._wave(590, 944, procY + 3.5, ampP * 0.8, t, 1.2).line);
    q('s-sao-shine').setAttribute('d', this._wave(56, 724, saoY + 3.5, active.filling ? 0.8 : 0.3, t * 0.8, 0.8).line);
    q('sc-proc').setAttribute('d', `M952.5 ${procY.toFixed(1)} l-8 -4.5 v9 z`);
    q('sc-sao').setAttribute('d', `M47.5 ${saoY.toFixed(1)} l8 -4.5 v9 z`);
    const leds = ucLedOn(S); for (const k of UC_LED_KEYS) q('sl-' + k).classList.toggle('on', leds[k]);
    const slH = ctx.sludgeMM || 120; const sly = y(slH);
    let sd = ''; for (let x = 56; x <= 724; x += 20) sd += (x === 56 ? 'M' : 'L') + x + ' ' + (sly + 2.5 * Math.sin(x * 0.05)).toFixed(1) + ' ';
    q('s-sludge').setAttribute('d', sd + 'L724 640 L56 640 Z');

    // suspended particles in the sedimentation tank; drawn towards the pump-in intake while filling
    const sTop = saoY + 12, sBot = sly - 8, P = UC_SIDE.pumpIn;
    for (const p of this.sparts) {
      const i = p.i;
      let tx = 76 + ucHash(i, 82) * 560 + 4 * Math.sin(t * 0.21 + i);
      let ty = sTop + ((ucHash(i, 83) + t * 0.0045 * (0.5 + ucHash(i, 84))) % 1) * Math.max(10, sBot - sTop);
      if (active.filling) {
        const dx = P.intake - tx, dy = P.intakeTop + 10 - ty, d = Math.hypot(dx, dy);
        const pull = ucClamp(1 - d / 260, 0, 1) * 0.55 * (S.flow || 1);
        tx += dx * pull; ty += dy * pull;
      }
      const k = Math.min(1, dt * 1.5); p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
      p.e.setAttribute('cx', p.x.toFixed(1)); p.e.setAttribute('cy', p.y.toFixed(1));
    }
    // returned sludge sinks from the spout to the bottom of the sedimentation tank
    const age = S.sludgeAge, dur = S.sludgeDur || 0;
    this.plume.forEach((e, j) => {
      const em = j * 10 + ucHash(j, 92) * 4;
      if (age === null || age === undefined || em > dur) { e.style.display = 'none'; return; }
      const f = (age - em) / 240;
      if (f < 0 || f > 1) { e.style.display = 'none'; return; }
      e.style.display = '';
      const yy = saoY + 4 + f * (sly - saoY - 2), xx = UC_SIDE.sludge.spoutX + (ucHash(j, 93) - 0.5) * 50 * Math.sqrt(f) + 3 * Math.sin(t + j);
      e.setAttribute('cx', xx.toFixed(1)); e.setAttribute('cy', yy.toFixed(1)); e.style.opacity = (0.8 * (1 - f * 0.6)).toFixed(2);
    });
    // flocs
    const top = procY + 6, bot = 628;
    const xp = 756;
    for (const f of this.flocs) {
      let tx, ty; const i = f.i;
      // settled position: sinking towards the sludge blanket as the tank clears
      const hx = 690 + ucHash(i, 1) * 235, hy = top + ucHash(i, 2) * (bot - top);
      const sy = blY + 4 + ucHash(i, 9) * (bot - blY - 6);
      let sx = hx + 2 * Math.sin(t * 0.3 + i), syy = S.clarity < 0.01 ? hy : Math.max(hy * (1 - S.clarity) + sy * S.clarity, blY + 2);
      tx = sx; ty = syy;
      if (active.aer || active.dose || (active.filling && S.clarity < 0.05)) {
        const left = i % 2 === 0;
        const xl = left ? 676 : xp + 6, xr = left ? xp - 6 : 930;
        const cx = (xl + xr) / 2, cy = (top + bot) / 2, rx = (xr - xl) / 2 * (0.35 + 0.6 * ucHash(i, 5)), ry = (bot - top) / 2 * (0.3 + 0.65 * ucHash(i, 6));
        const w = (active.aer ? 0.55 : 0.12) * (0.7 + 0.6 * ucHash(i, 7));
        const th = ucHash(i, 8) * 6.283 + (left ? -1 : 1) * w * t;
        const ccx = cx + rx * Math.cos(th), ccy = cy + ry * Math.sin(th);
        // each floc is lifted into the circulation at its own moment as the aeration stirs the tank up
        const m = 1 - S.clarity; const mi = ucClamp((m - ucHash(i, 33) * 0.7) / 0.3, 0, 1);
        tx = sx + (ccx - sx) * mi; ty = syy + (ccy - syy) * mi;
      }
      let k = Math.min(1, dt * 2.2), op = 0.72;
      if (active.sludge && ucHash(i, 31) < 0.15 + 0.45 * (S.sludgeProg || 0)) {
        tx = UC_SIDE.sludge.leg + (ucHash(i, 32) - 0.5) * 6; ty = UC_SIDE.sludge.bot + 2; k = Math.min(1, dt * 1.4);
        const dd = Math.hypot(f.x - tx, f.y - ty); op = dd < 10 ? 0 : 0.72;
        if (dd < 10) { f.x = tx; f.y = ty; }
      } else if (f.gone) { f.x = tx; f.y = ty; }
      f.gone = op === 0;
      f.x += (tx - f.x) * k; f.y += (ty - f.y) * k;
      f.e.style.opacity = op;
      f.e.setAttribute('cx', f.x.toFixed(1)); f.e.setAttribute('cy', Math.max(f.y, procY + 2).toFixed(1));
    }
    // aeration bubbles
    const bOn = active.aer || S.pulse;
    const dY = y(150), H = dY - procY;
    this.bubbles.forEach((b, i) => {
      if (!bOn || H < 20 || (S.pulse && !active.aer && i % 2)) { b.style.display = 'none'; return; }
      b.style.display = '';
      const sp = 70 + 45 * ucHash(i, 11);
      const ph = ((t * sp + ucHash(i, 12) * H) % H);
      const fr = ph / H;
      const spread = 8 + fr * 34;
      const x = xp + (ucHash(i, 13) - 0.5) * 2 * spread + 3 * Math.sin(t * 6 + i);
      b.setAttribute('cx', x.toFixed(1)); b.setAttribute('cy', (dY - ph).toFixed(1));
      b.setAttribute('r', (1.2 + fr * 2.4 * (0.6 + ucHash(i, 14))).toFixed(1));
      b.style.opacity = fr > 0.94 ? ((1 - fr) / 0.06).toFixed(2) : '0.85';
    });

    // mammoth pumps
    const srcY = { sao: saoY, proc: procY };
    // Liquid in the risers and sensor tubes is painted with the same semi-transparent gradients as
    // the tank around the opening (light and dark theme alike): the clear-water gradient, then the
    // mixed liquor when the opening is under the top of the mixed layer, then the chemical tint.
    const mixO = 0.55 + 0.35 * S.clarity;
    const inMixed = (yPx) => S.clarity < 0.02 || yPx >= mixedTop;
    for (const [k, m] of Object.entries(UC_SIDE)) {
      const on = (k === 'pumpIn' && active.filling) || (k === 'sludge' && active.sludge) || (k === 'discharge' && active.discharge);
      const L = this.liquid[k]; const lvl = srcY[m.src];
      // what fills the riser: the pumped liquid while pumping, otherwise the liquid around the intake
      // (the sludge return takes it from the bottom, which is always under the mixed layer)
      const proc = !on && m.src === 'proc';
      const mixA = proc && (k === 'sludge' || inMixed(m.intakeTop)) ? mixO : 0, tintA = proc ? S.tint : 0;
      L.riser.setAttribute('stroke', on ? m.color : m.src === 'sao' ? 'url(#ucSaoG)' : 'url(#ucClearG)');
      L.riser.style.opacity = on ? '' : '1'; L.stream.setAttribute('stroke', m.color);
      const riserTopLiquid = on ? m.top : Math.max(lvl, m.top);
      // one liquid path through the U at the bottom and round the bends at the top, like the pipe itself
      const dir = m.spoutX < m.leg ? -1 : 1;
      let d;
      if (m.intake) {
        const mid = (m.intake + m.leg) / 2;
        const funnel = k === 'discharge' && lvl <= m.intakeTop + 4;
        d = funnel ? `M${m.intake + 24} ${m.intakeTop} H${m.intake + 8} Q${m.intake} ${m.intakeTop} ${m.intake} ${m.intakeTop + 8}`
          : `M${m.intake} ${Math.max(m.intakeTop, lvl).toFixed(1)}`;
        d += ` V${m.bot - 10} Q${m.intake} ${m.bot + 4} ${mid} ${m.bot + 4} Q${m.leg} ${m.bot + 4} ${m.leg} ${m.bot - 10}`;
      } else d = `M${m.leg} ${m.bot}`;
      const top = `V${m.top + 8} Q${m.leg} ${m.top} ${m.leg + dir * 8} ${m.top}` +
        (k === 'discharge' ? ' H934' : ` H${m.spoutX - dir * 8} Q${m.spoutX} ${m.top} ${m.spoutX} ${m.top + 8} V${m.spoutY - 18}`);
      d += on ? ' ' + top : ` V${riserTopLiquid.toFixed(1)}`;
      L.riser.setAttribute('d', d);
      L.mix.setAttribute('d', mixA > 0 ? d : ''); L.mix.style.opacity = mixA.toFixed(2);
      L.tint.setAttribute('d', tintA > 0.001 ? d : ''); L.tint.style.opacity = tintA.toFixed(3);
      L.intake.setAttribute('d', '');
      // water moving over the bend and along the top pipe, in pulses
      if (on) {
        L.flow.setAttribute('d', `M${m.leg} ${m.top + 8} Q${m.leg} ${m.top} ${m.leg + dir * 8} ${m.top}` +
          (k === 'discharge' ? ' H934' : ` H${m.spoutX - dir * 8} Q${m.spoutX} ${m.top} ${m.spoutX} ${m.top + 8} V${m.spoutY - 18}`));
        L.flow.style.display = ''; L.flow.style.strokeDashoffset = (-t * 70 * S.flow).toFixed(1);
        L.flow.style.opacity = (0.5 + 0.5 * Math.abs(Math.sin(t * 5.5))).toFixed(2);
      } else L.flow.style.display = 'none';
      // stream
      if (on && k !== 'discharge') {
        const ty = k === 'pumpIn' ? procY : saoY;
        L.stream.setAttribute('d', `M${m.spoutX} ${m.spoutY - 18} V${ty.toFixed(1)}`);
        L.stream.style.display = ''; L.stream.style.strokeDashoffset = (-t * 70 * S.flow).toFixed(1);
        L.stream.style.opacity = (0.55 + 0.45 * Math.abs(Math.sin(t * 5.5))).toFixed(2);
      } else L.stream.style.display = 'none';
      // air slugs rise in the riser and release where the pipe bends over
      const yLo = m.bot - 14, yHi = m.top + 7, len = yLo - yHi;
      this.slugs[k].forEach((s, j) => {
        if (!on) { s.style.display = 'none'; return; }
        const v = 150 * (0.4 + 0.6 * S.flow);
        const hh = 9 + 16 * ucHash(j, 21 + k.length) * (1.3 - S.flow * 0.3);
        const ph = (t * v + j * (len / 6) + ucHash(j, 22) * 20) % (len + hh);
        const y1 = Math.min(yLo, yLo + hh - ph), y0 = Math.max(yHi, yLo - ph);
        if (y1 - y0 < 1.5) { s.style.display = 'none'; return; }
        s.style.display = '';
        s.setAttribute('y', y0.toFixed(1)); s.setAttribute('height', (y1 - y0).toFixed(1));
      });
    }
    // splash at targets
    const spl = [];
    if (active.filling) spl.push([UC_SIDE.pumpIn.spoutX, procY]);
    if (active.sludge) spl.push([UC_SIDE.sludge.spoutX, saoY]);
    if (S.sub === 'dose' || (S.tint > 0.12)) spl.push([767, procY]);
    this.splashes.forEach((e, i) => {
      const s = spl[i]; if (!s) { e.style.display = 'none'; return; }
      e.style.display = ''; const ph = (t * 1.6 + i * 0.37) % 1;
      e.setAttribute('cx', s[0]); e.setAttribute('cy', s[1].toFixed(1));
      e.setAttribute('rx', (3 + ph * 14).toFixed(1)); e.setAttribute('ry', (1 + ph * 2.5).toFixed(1));
      e.style.opacity = (0.8 * (1 - ph)).toFixed(2);
    });
    q('s-outflow').style.display = active.discharge ? '' : 'none';
    q('s-outflow').style.strokeDashoffset = (-t * 60 * S.flow).toFixed(1);

    // hoses & valves
    // firmware outputs: chemical filling = MV1 + MV2 without compressor (dosing chamber vents), dose = COMP + MV1,
    // pump-in = COMP + MV4 with MV5 pulses
    const hoseOn = { blue: active.filling, gray: active.aer || !!S.pulse, brown: active.sludge, red: active.discharge, yellow: active.dose, green: false, black: false };
    const valveOn = Object.assign({}, hoseOn, { brown: active.sludge || S.sub === 'fill' });
    for (const k of Object.keys(UC_SIDE_HOSES)) {
      const f = q('shf-' + k); const on = hoseOn[k] && (S.running || k === 'yellow');
      f.style.display = on ? '' : 'none';
      f.classList.toggle('rev', k === 'yellow' && S.sub === 'fill');
      q('sh-' + k).style.opacity = on || k === 'green' || k === 'black' ? '1' : '0.72';
      const v = q('sv-' + k); if (v) v.classList.toggle('on', !!valveOn[k]);
    }
    q('s-comp').classList.toggle('buzz', !!S.running);
    // sensor tubes
    const tubeUpd = (id, xBottomMM, outerMM, tripMM, mixA, tintA) => {
      const sub = outerMM - xBottomMM;
      const inner = sub > 0 ? outerMM - Math.min(10, sub * 0.02) : outerMM;
      const yb = y(xBottomMM), yi = y(Math.max(inner, xBottomMM));
      for (const s of ['-w', '-wm', '-wt']) { const w = q(id + s); w.setAttribute('y', yi.toFixed(1)); w.setAttribute('height', Math.max(0, yb - yi).toFixed(1)); }
      q(id + '-wm').style.opacity = mixA.toFixed(2); q(id + '-wt').style.opacity = tintA.toFixed(3);
      const f = ucClamp(sub / (tripMM - xBottomMM), 0, 1);
      q(id + '-g').setAttribute('stroke-dasharray', `${(f * 44).toFixed(1)} 44`);
      q(id + '-g0').classList.toggle('trip', f >= 0.999);
    };
    tubeUpd('tg', UC_GEO.greenTubeBottomMM, S.levelMM, UC_GEO.startMM, inMixed(y(UC_GEO.greenTubeBottomMM)) ? mixO : 0, S.tint);
    tubeUpd('tb', UC_GEO.blackTubeBottomMM, S.saoMM, UC_GEO.alarmMM, 0, 0);

    // chemical tank + inset
    const chemFrac = ctx.chemFrac !== null && ctx.chemFrac !== undefined ? ctx.chemFrac : 0.6;
    const cl = q('s-chem-liq'); const ch = 64 * chemFrac; cl.setAttribute('y', (168 - ch).toFixed(1)); cl.setAttribute('height', ch.toFixed(1));
    q('s-chem-pct').textContent = ctx.chemLiters !== null && ctx.chemLiters !== undefined ? `${ctx.chemLiters.toLocaleString(ctx.locale, { maximumFractionDigits: 1 })} l`
      : ctx.chemFrac !== null && ctx.chemFrac !== undefined ? `${Math.round(ctx.chemFrac * 100)} %` : '';
    q('s-chem-drip').style.display = S.sub === 'dose' || S.tint > 0.125 ? '' : 'none';
    q('s-chem-drip').setAttribute('d', `M762 118 H767 V${procY.toFixed(1)}`);
    // pills (4 Hz)
    if (t - this.pillT > 0.25 || t < this.pillT) {
      this.pillT = t;
      this._pill('p-power', S.power !== null ? `${S.power.toLocaleString(ctx.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} W` : '–', S.running ? 'run' : '');
      this._pill('p-proc', `≈ ${Math.round(S.level * 100)} %`, '');
      this._pill('p-sao', ctx.sludgeText || '–', '');
      q('p-sao').style.display = ctx.sludgeText ? '' : 'none';
    }
  }

  updateInset(S, t, ctx) {
    const q = this.q;
    const chemFrac = ctx.chemFrac !== null && ctx.chemFrac !== undefined ? ctx.chemFrac : 0.6;
    const il = q('i-liq'); const ih = 80 * chemFrac + 4; il.setAttribute('y', (150 - ih).toFixed(1)); il.setAttribute('height', ih.toFixed(1));
    const liqY = 150 - ih;
    const chm = q('i-ch'); const chH = 20 * S.chamber; chm.setAttribute('y', (146 - chH).toFixed(1)); chm.setAttribute('height', chH.toFixed(1));
    q('i-ball').setAttribute('cy', S.sub === 'fill' ? '141' : '146');
    const dosing = S.sub === 'dose';
    q('i-out').setAttribute('d', dosing ? 'M104 146 V30 H34 V86' : `M104 146 V${Math.max(liqY, 32).toFixed(1)}`);
    q('i-air').style.display = S.phase === 'dosing' ? '' : 'none';
    q('i-air').classList.toggle('rev', S.sub === 'fill');
    this.drops.forEach((e, i) => {
      if (!dosing) { e.style.display = 'none'; return; }
      e.style.display = ''; const ph = (t * 1.3 + i / 4) % 1;
      e.setAttribute('cx', '34'); e.setAttribute('cy', (90 + ph * 60).toFixed(1)); e.style.opacity = (1 - ph).toFixed(2);
    });

  }

  _pill(id, text, cls) {
    const g = this.q(id); const tx = g.querySelector('.pval'); const r = g.querySelector('rect');
    if (tx.textContent !== text) {
      tx.textContent = text;
      const w = Math.max(56, text.length * 7.4 + 22); const cx = parseFloat(tx.getAttribute('x'));
      r.setAttribute('x', (cx - w / 2).toFixed(1)); r.setAttribute('width', w.toFixed(1));
    }
    r.classList.toggle('run', cls === 'run');
  }
}
/* Uponor Clean Card – top view of the process-tank riser */
const UC_TOP = {
  cx: 430, cy: 330, R: 280,
  mod: {
    discharge: { x: 234, y: 246, n: 1, hose: 'red' },
    aerator: { x: 382, y: 236, n: 2, hose: 'gray' },
    pumpIn: { x: 643, y: 284, n: 3, hose: 'blue' },
    overflow: { x: 676, y: 352, n: 4, hose: 'black' },
    start: { x: 392, y: 404, n: 5, hose: 'green' },
    sludge: { x: 380, y: 474, n: 6, hose: 'brown' },
  },
  hoses: {
    gray: 'M196 172 C150 300 168 520 300 560 C384 586 424 470 404 332 C398 292 390 262 384 246',
    blue: 'M206 166 C158 320 196 520 330 540 C462 560 522 420 588 334 C612 304 626 292 636 288',
    black: 'M190 192 C232 332 420 384 560 366 C612 360 642 356 662 354',
    brown: 'M186 204 C198 384 288 452 362 470',
    green: 'M200 184 C222 332 298 402 376 404',
    red: 'M724 214 C642 70 420 78 330 142 C300 165 286 204 276 236',
    yellow: 'M214 160 C262 110 330 96 362 98',
  },
};

const UC_DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
function ucSeg7(x, y, w, h, th, id) {
  const hh = (h - th) / 2, o = th * 0.6, L = hh - th * 0.2;
  const S = { a: [x + o, y, w - 2 * o, th], b: [x + w - th, y + o, th, L], c: [x + w - th, y + hh + o, th, L], d: [x + o, y + h - th, w - 2 * o, th],
    e: [x, y + hh + o, th, L], f: [x, y + o, th, L], g: [x + o, y + hh, w - 2 * o, th] };
  return Object.entries(S).map(([k, r]) => `<rect id="${id}-${k}" x="${r[0].toFixed(1)}" y="${r[1].toFixed(1)}" width="${r[2].toFixed(1)}" height="${r[3].toFixed(1)}" rx="${(th / 2).toFixed(1)}" class="seg"/>`).join('');
}
/* Uponor Clean Control panel as seen from above (labels as printed on the device) */
function ucPanelMarkup(x0, y0, sc = 1) {
  const W = 230, H = 320;
  const led = (id, x, y) => `<rect id="lh-${id}" x="${x - 4}" y="${y - 4}" width="22" height="22" rx="5" class="ledh"/><rect id="led-${id}" x="${x}" y="${y}" width="14" height="14" rx="2" class="led"/>`;
  const rows = [['comp', 'Compressor', 30], ['dos', 'Dosing', 64], ['sludge', 'Sludge removal', 98], ['out', 'Pump out', 142], ['in', 'Pump in', 176], ['aer', 'Aeration', 210], ['alarm', 'Alarm', 268]];
  const st = [['chem', 'Chemical', 26], ['high', 'High water', 46], ['start', 'Start', 66]];
  return `<g transform="translate(${x0} ${y0}) scale(${sc})" class="panel">
    <rect x="0" y="0" width="${W}" height="${H}" rx="8" class="pn-frame"/>
    <rect x="12" y="10" width="${W - 24}" height="${H - 40}" rx="3" class="pn-face"/>
    ${[[22, 20], [W - 22, 20], [22, H - 40], [W - 22, H - 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" class="pn-screw"/>`).join('')}
    ${st.map(([id, lab, x]) => `<text transform="translate(${x + 11} 20) rotate(90)" class="pn-s">${lab}</text>${led(id, x, 76)}`).join('')}
    <rect x="24" y="100" width="62" height="104" rx="6" class="pn-sticker"/>
    <text transform="translate(76 108) rotate(90)" class="pn-v">VERSION</text>
    <text transform="translate(60 122) rotate(90)" class="pn-u">uponor</text>
    <text transform="translate(36 186) rotate(90)" class="pn-v">2.1.2</text>
    <rect x="24" y="214" width="80" height="34" rx="3" class="pn-disp"/>
    ${[0, 1, 2, 3].map((k) => ucSeg7(30 + k * 18.5, 219, 14, 24, 3, 'pd' + k)).join('')}
    <rect x="24" y="252" width="80" height="16" rx="2" class="pn-sticker"/><text x="64" y="264" text-anchor="middle" class="pn-cc">Clean Control</text>
    ${rows.map(([id, lab, y]) => `${led(id, 110, y)}<text x="131" y="${y + 11}" class="pn-l">${lab}</text>`).join('')}
    <text x="${W / 2}" y="${H - 11}" text-anchor="middle" class="pn-logo">uponor</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${22 + i * 40}" y="${H + 8}" width="30" height="24" rx="3" class="pn-valve"/><circle cx="${37 + i * 40}" cy="${H + 20}" r="7" class="pn-nut"/>`).join('')}
    <circle id="psw-start" cx="86" cy="${H + 56}" r="14" class="pn-psw"/><circle cx="86" cy="${H + 56}" r="5" class="pn-nut"/>
    <circle id="psw-high" cx="146" cy="${H + 56}" r="14" class="pn-psw"/><circle cx="146" cy="${H + 56}" r="5" class="pn-nut"/>
  </g>`;
}

function ucTopMarkup(T) {
  const C = UC_TOP; const { cx, cy, R } = C; const M = C.mod;
  const hoseEls = Object.entries(C.hoses).map(([k, d]) =>
    `<path d="${d}" class="those" stroke="${UC_HOSE[k]}" id="th-${k}"/><path d="${d}" class="hose-flow t" id="thf-${k}"/>`).join('');
  const badge = (m, k) => {
    const col = UC_HOSE[m.hose]; const dark = ['gray', 'yellow'].includes(m.hose);
    const bx = m.x + (k === 'overflow' ? 30 : k === 'pumpIn' ? 34 : 18), by = m.y - (k === 'discharge' ? 70 : 34);
    return `<g class="badge"><rect x="${bx}" y="${by}" width="22" height="22" rx="3" fill="${col}" stroke="#111" stroke-width="1"/>
      <text x="${bx + 11}" y="${by + 16}" text-anchor="middle" fill="${dark ? '#111' : '#fff'}">${m.n}</text></g>`;
  };
  const items = T.top_legend.map((name, i) => [['red', 'gray', 'blue', 'black', 'green', 'brown'][i], name, T.top_colors[i], i + 1])
    .concat([['yellow', T.chem_line, T.chem_line2, '']]);
  const legend = items.map(([k, name, sub, n], i) => {
    const x0 = 598 + (i % 2) * 204, y0 = 414 + Math.floor(i / 2) * 54;
    return `<g id="tl-${k}" class="tleg"><rect x="${x0}" y="${y0}" width="20" height="20" rx="3" fill="${UC_HOSE[k]}" stroke="#111" stroke-width="0.8"/>
      <text x="${x0 + 10}" y="${y0 + 15}" text-anchor="middle" class="tnum" fill="${['gray', 'yellow'].includes(k) ? '#111' : '#fff'}">${n}</text>
      <text x="${x0 + 26}" y="${y0 + 11}" class="tl-t sm">${name}</text>
      <text x="${x0 + 26}" y="${y0 + 27}" class="tl-c">${sub}${k === 'yellow' ? '<tspan id="tl-chem-v"></tspan>' : ''}<tspan class="tl-a"> ${T.active}</tspan></text></g>`;
  }).join('');
  return `
  <svg viewBox="0 26 1000 620" class="top" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${T.top_title}">
    <defs>
      <clipPath id="ucCirc"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
      <clipPath id="ucProcSide"><path d="M0 0 H594 L606 680 H0 Z"/></clipPath>
    </defs>
    <text x="24" y="50" class="tlbl">${T.top_title}</text>
    <text x="24" y="74" class="lbl">${T.to_cu}</text>
    <g transform="translate(300 352) scale(0.9) translate(-430 -330)">
    <circle cx="${cx}" cy="${cy}" r="${R + 22}" class="t-ring"/>
    <g clip-path="url(#ucCirc)">
      <rect x="0" y="0" width="1000" height="680" class="t-sao"/>
      <rect x="0" y="0" width="1000" height="680" class="t-proc" clip-path="url(#ucProcSide)" id="t-proc"/>
      <rect x="0" y="0" width="1000" height="680" class="t-foam" clip-path="url(#ucProcSide)" id="t-foam"/>
      ${[...Array(14)].map((_, i) => `<ellipse cx="${640 + ucHash(i, 41) * 80}" cy="${80 + ucHash(i, 42) * 500}" rx="${6 + ucHash(i, 43) * 14}" ry="${3 + ucHash(i, 44) * 6}" class="t-scum"/>`).join('')}
      <path d="M594 0 L606 680" class="t-part"/>
      <g id="t-ripples"></g>
      <g id="t-specks"></g>
      <!-- sludge return pipe across partition -->
      <path d="M392 478 C470 480 560 482 760 486" class="t-pipe"/>
      <!-- pump-in module pipe across partition -->
      <path d="M498 292 L${M.pumpIn.x} ${M.pumpIn.y}" class="t-black"/>
      <circle cx="${M.pumpIn.x}" cy="${M.pumpIn.y}" r="44" class="t-clamp"/>
      <circle cx="${M.pumpIn.x}" cy="${M.pumpIn.y}" r="30" class="t-pipeend"/>
      <!-- discharge module (110 mm) -->
      <circle cx="${M.discharge.x}" cy="${M.discharge.y}" r="56" class="t-clamp"/>
      <circle cx="${M.discharge.x}" cy="${M.discharge.y}" r="44" class="t-pipeend"/>
      <circle cx="${M.discharge.x + 18}" cy="${M.discharge.y - 6}" r="16" class="t-blackpipe"/>
      <!-- aerator connector -->
      <circle cx="${M.aerator.x}" cy="${M.aerator.y}" r="18" class="t-cap"/><circle cx="${M.aerator.x}" cy="${M.aerator.y}" r="8" class="t-fit"/>
      <!-- sensor tubes (Ø50) -->
      <circle cx="${M.overflow.x}" cy="${M.overflow.y}" r="25" class="t-cap"/><circle cx="${M.overflow.x}" cy="${M.overflow.y}" r="9" fill="#3BA3E8"/>
      <circle cx="${M.start.x}" cy="${M.start.y}" r="25" class="t-cap"/><circle cx="${M.start.x}" cy="${M.start.y}" r="9" fill="#3BA3E8"/>
      <!-- sludge elbow -->
      <circle cx="${M.sludge.x}" cy="${M.sludge.y}" r="34" class="t-clamp"/><circle cx="${M.sludge.x}" cy="${M.sludge.y}" r="22" class="t-pipeend"/>
      <!-- cable conduit -->
      <path d="M612 80 C700 110 742 170 760 250" class="t-conduit"/>
      <!-- chemical tank footprint (above) -->
      <g class="t-chemtank"><rect x="356" y="60" width="142" height="84" rx="16" class="t-lid"/>
        <circle cx="424" cy="104" r="29" fill="#000" opacity=".12"/><circle cx="422" cy="102" r="29" class="t-ccap"/><circle cx="422" cy="102" r="27" class="t-crib"/><circle cx="422" cy="102" r="21" class="t-ccap2"/>
        ${[...Array(9)].map((_, i) => `<circle cx="${(408 + ucHash(i, 101) * 28).toFixed(1)}" cy="${(88 + ucHash(i, 102) * 28).toFixed(1)}" r="${(1 + ucHash(i, 103) * 1.6).toFixed(1)}" class="t-capdot"/>`).join('')}
        <path d="M494 67 h9 q5 0 5 5 v22 q0 5 -5 5 h-9 M494 106 h9 q5 0 5 5 v22 q0 5 -5 5 h-9" class="t-bail"/>
${[67, 99, 106, 138].map((yy) => `<circle cx="494" cy="${yy}" r="2.8" class="t-hinge"/>`).join('')}</g>
      <g id="t-glow"></g>
      ${hoseEls}
      <text id="t-chem-l" x="474" y="134" text-anchor="middle" class="t-cheml"></text>
      ${Object.entries(M).map(([k, m]) => badge(m, k)).join('')}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${R}" class="t-rim"/>
    <text x="586" y="${cy + R - 18}" text-anchor="end" class="lbl t-on">${T.proc_side}</text>
    <text x="616" y="${cy + R - 18}" class="lbl t-on">${T.sed_side}</text>
    </g>
    ${ucPanelMarkup(598, 40, 0.9)}
    <text x="818" y="122" class="plbl">${T.chem_pump}</text>
    ${ucInsetGroup(T, 818, 134, 0.86)}
    ${legend}
  </svg>`;
}

class UcTop {
  constructor(svg) {
    this.svg = svg; this.q = (id) => svg.querySelector('#' + id);
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, parent, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    const rg = this.q('t-ripples'); this.rip = [];
    for (let i = 0; i < 28; i++) this.rip.push(mk('ellipse', rg, { class: 'ripple', rx: 2, ry: 2 }));
    const sg = this.q('t-specks'); this.specks = [];
    for (let i = 0; i < 40; i++) this.specks.push(mk('circle', sg, { class: 'speck', r: (0.8 + ucHash(i, 51) * 1.6).toFixed(1) }));
    const gg = this.q('t-glow'); this.glow = {};
    for (const [k, m] of Object.entries(UC_TOP.mod)) this.glow[k] = mk('circle', gg, { cx: m.x, cy: m.y, r: 30, class: 'glow', stroke: UC_HOSE[m.hose] });
  }

  updatePanel(S, ctx) {
    const q = this.q;
    const on = { comp: !!S.running, dos: S.phase === 'dosing', sludge: S.phase === 'sludge', out: S.phase === 'discharge', in: S.phase === 'filling',
      aer: S.phase === 'aeration', alarm: !!S.warning || !!ctx.sludgeDue, start: S.level >= 0.985, high: S.saoMM >= UC_GEO.alarmMM || S.warnKey === 'high_water',
      chem: ctx.chemFrac !== null && ctx.chemFrac !== undefined && ctx.chemFrac < 0.1 };
    const cl = ctx.chemLiters !== null && ctx.chemLiters !== undefined ? `${ctx.chemLiters.toLocaleString(ctx.locale, { maximumFractionDigits: 1 })} l` : '';
    if (cl !== this._chemTxt) { this._chemTxt = cl; q('t-chem-l').textContent = cl; q('tl-chem-v').textContent = cl ? ` · ≈ ${cl}` : ''; }
    for (const [k, v] of Object.entries(on)) { const e = q('led-' + k); if (e) { e.classList.toggle('on', v); q('lh-' + k).classList.toggle('on', v); } }
    q('psw-start').classList.toggle('on', on.start); q('psw-high').classList.toggle('on', on.high);
    const n = ctx.batchNow !== null && ctx.batchNow !== undefined && isFinite(parseFloat(ctx.batchNow)) ? String(Math.round(parseFloat(ctx.batchNow)) % 10000) : '----';
    const txt = n.padStart(4, ' ');
    if (txt !== this._disp) {
      this._disp = txt;
      for (let k = 0; k < 4; k++) { const segs = UC_DIGITS[txt[k]] || ''; for (const sg of 'abcdefg') q(`pd${k}-${sg}`).classList.toggle('on', segs.includes(sg)); }
    }
  }

  update(S, t) {
    const q = this.q; const M = UC_TOP.mod;
    const on = { red: S.phase === 'discharge', gray: S.phase === 'aeration' || !!S.pulse, blue: S.phase === 'filling', brown: S.phase === 'sludge',
      yellow: S.phase === 'dosing', green: false, black: false };
    for (const k of Object.keys(UC_TOP.hoses)) {
      const a = on[k] && (S.running || k === 'yellow');
      q('thf-' + k).style.display = a ? '' : 'none';
      q('thf-' + k).classList.toggle('rev', k === 'yellow' && S.sub === 'fill');
      q('th-' + k).style.opacity = a || k === 'green' || k === 'black' ? '1' : '0.75';
      const lg = q('tl-' + k); if (lg) lg.classList.toggle('on', !!a);
    }
    const modOn = { discharge: on.red, aerator: on.gray, pumpIn: on.blue, sludge: on.brown, overflow: false, start: false };
    for (const [k, e] of Object.entries(this.glow)) {
      if (!modOn[k]) { e.style.display = 'none'; continue; }
      e.style.display = ''; const ph = (t * 1.2) % 1; e.setAttribute('r', (30 + ph * 22).toFixed(1)); e.style.opacity = (0.8 * (1 - ph)).toFixed(2);
    }
    // water appearance
    q('t-foam').style.opacity = S.phase === 'aeration' ? '0.22' : (S.phase === 'dosing' ? '0.12' : (0.08 * (1 - S.clarity)).toFixed(2));
    q('t-proc').style.opacity = (0.92 + 0.08 * S.clarity).toFixed(2);
    // ripples
    const spots = [];
    if (on.gray) for (let i = 0; i < (S.pulse && S.phase !== 'aeration' ? 6 : 16); i++) spots.push('aer');
    if (on.blue) spots.push([498, 292], [498, 292], [498, 292]);
    if (on.brown) spots.push([700, 484], [700, 484]);
    if (on.red) spots.push(['in', M.discharge.x, M.discharge.y], ['in', M.discharge.x, M.discharge.y]);
    if (S.sub === 'dose' || S.tint > 0.12) spots.push([426, 142]);
    this.rip.forEach((e, i) => {
      const s = spots[i]; if (!s) { e.style.display = 'none'; return; }
      e.style.display = '';
      const period = 1.6 + ucHash(i, 61); const ph = ((t + ucHash(i, 62) * period) / period);
      const cyc = Math.floor(ph); const f = ph - cyc;
      let x, y, r, inward = false;
      if (s === 'aer') {
        const a = ucHash(i * 31 + cyc, 63) * 6.283, d = Math.sqrt(ucHash(i * 17 + cyc, 64)) * 190;
        x = 400 + Math.cos(a) * d * 1.05; y = 330 + Math.sin(a) * d;
        if (x > 585) x = 585 - (x - 585);
        r = 3 + f * 26;
      } else if (s[0] === 'in') { inward = true; x = s[1]; y = s[2]; r = 70 - f * 40; }
      else { x = s[0]; y = s[1]; r = 4 + ((f + i * 0.33) % 1) * 34; }
      e.setAttribute('cx', x.toFixed(1)); e.setAttribute('cy', y.toFixed(1));
      e.setAttribute('rx', r.toFixed(1)); e.setAttribute('ry', (r * 0.92).toFixed(1));
      e.style.opacity = (inward ? 0.6 * f : 0.7 * (1 - f)).toFixed(2);
      e.classList.toggle('yel', S.sub === 'dose' && i === spots.length - 1);
    });
    // foam specks drifting outward from the aeration plume
    this.specks.forEach((e, i) => {
      if (!on.gray) { e.style.display = 'none'; return; }
      e.style.display = '';
      const per = 5 + ucHash(i, 71) * 4; const f = ((t / per) + ucHash(i, 72)) % 1;
      const a = ucHash(i, 73) * 6.283 + 0.4 * Math.sin(t * 0.3 + i);
      const d = 20 + f * 200;
      let x = 400 + Math.cos(a) * d, y = 330 + Math.sin(a) * d * 0.95;
      if (x > 588) x = 588;
      e.setAttribute('cx', x.toFixed(1)); e.setAttribute('cy', y.toFixed(1)); e.style.opacity = (0.75 * (1 - f)).toFixed(2);
    });
  }
}
/* Uponor Clean Card – timeline chart */
const UC_EV_STYLE = {
  start: { c: '#2D8CE0', d: (x, y) => `M${x - 5} ${y + 4} L${x} ${y - 5} L${x + 5} ${y + 4} Z` },
  dose: { c: '#D9A400', d: (x, y) => `M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z` },
  batch: { c: '#E04A3F', d: (x, y) => `M${x - 5} ${y - 4} L${x + 5} ${y - 4} L${x} ${y + 5} Z` },
  discharge: { c: '#E04A3F', hollow: true, d: (x, y) => `M${x - 4.5} ${y - 4} L${x + 4.5} ${y - 4} L${x} ${y + 4.5} Z` },
  warning: { c: '#D93025', d: (x, y) => `M${x - 5} ${y + 4} L${x} ${y - 5} L${x + 5} ${y + 4} Z` },
  holiday_on: { c: '#8E6CD8', d: (x, y) => `M${x - 4} ${y} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0` },
  holiday_off: { c: '#8E6CD8', d: (x, y) => `M${x - 4} ${y} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0` },
  offline: { c: '#9E9E9E', hollow: true, d: (x, y) => `M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}` },
  restart: { c: '#E8710A', d: (x, y) => `M${x - 5} ${y - 5} H${x + 5} V${y + 5} H${x - 5} Z` },
};

class UcChart {
  constructor(svg, tip) { this.svg = svg; this.tip = tip; this.W = 800; this.H = 182; this.padL = 40; this.padR = 10; }

  x(t) { return this.padL + (t - this.t0) / (this.t1 - this.t0) * (this.W - this.padL - this.padR); }
  t(x) { return this.t0 + (x - this.padL) / (this.W - this.padL - this.padR) * (this.t1 - this.t0); }

  render(model, t0, t1, W, T, locale) {
    this.t0 = t0; this.t1 = t1; this.W = Math.max(320, W); this.model = model;
    const H = this.H; const pL = this.padL, pR = this.W - this.padR;
    const yP = (w) => 72 - ucClamp(w, 0, 72) / 72 * 62; // power row 10..72
    const yL = (l) => 110 - ucClamp(l, 0, 1.05) * 28;      // level row 82..110
    let s = '';
    // grid
    for (const w of [0, 30, 60]) s += `<line x1="${pL}" x2="${pR}" y1="${yP(w)}" y2="${yP(w)}" class="grid"/>` + (w ? `<text x="${pL - 6}" y="${yP(w) + 4}" class="ax" text-anchor="end">${w}</text>` : '');
    s += `<text x="${pL - 6}" y="8" class="ax" text-anchor="end">W</text>`;
    s += `<line x1="${pL}" x2="${pR}" y1="${yL(0)}" y2="${yL(0)}" class="grid"/><line x1="${pL}" x2="${pR}" y1="${yL(1)}" y2="${yL(1)}" class="grid dash"/>`;
    s += `<text x="${pL - 6}" y="${yL(1) + 4}" class="ax" text-anchor="end">100</text><text x="${pL - 6}" y="${yL(0) + 4}" class="ax" text-anchor="end">0</text>`;
    // power path with per-pixel min/max decimation
    const P = model.power; let i = Math.max(0, ucIdx(P, t0));
    let pts = []; let col = null, mn = 0, mx = 0, first = null, last = null;
    const flush = () => { if (col === null) return; pts.push([col, first]); if (mn !== first && mn !== last) pts.push([col + 0.3, mn]); if (mx !== first && mx !== last) pts.push([col + 0.6, mx]); pts.push([col + 0.9, last]); };
    for (; i < P.length; i++) {
      const e = P[i]; if (e.t > t1) break;
      const v = parseFloat(e.v); if (!isFinite(v)) { flush(); col = null; pts.push(null); continue; }
      const cx = Math.floor(this.x(Math.max(e.t, t0)));
      if (cx !== col) { flush(); col = cx; mn = mx = first = last = v; } else { mn = Math.min(mn, v); mx = Math.max(mx, v); last = v; }
    }
    flush();
    // extend last value to t1 (live)
    if (pts.length && pts[pts.length - 1]) { const lv = pts[pts.length - 1][1]; const xe = Math.min(this.x(Math.min(t1, model.now || t1)), pR); pts.push([xe, lv]); }
    let d = '', area = '', run = [];
    const flushRun = () => {
      if (run.length < 2) { run = []; return; }
      let seg = ''; let prevY = null;
      run.forEach(([x, v], k) => { const yy = yP(v).toFixed(1); seg += (k ? (prevY !== null ? `H${x.toFixed(1)} V${yy}` : `L${x.toFixed(1)} ${yy}`) : `M${x.toFixed(1)} ${yy}`); prevY = yy; });
      d += seg;
      area += seg + `V${yP(0)} H${run[0][0].toFixed(1)} Z`;
      run = [];
    };
    for (const p of pts) { if (!p) flushRun(); else run.push(p); }
    flushRun();
    s += `<path d="${area}" class="p-area"/><path d="${d}" class="p-line"/>`;
    // level (estimate)
    if (model.keys.length) {
      const tEnd = Math.min(t1, model.now || t1);
      let ld = '', la = ''; const step = 3;
      const xs = this.x(Math.max(t0, model.keys[0].t)); const xe = this.x(tEnd);
      for (let x = xs; x <= xe; x += step) { const L = model.levelAt(this.t(x)); ld += (x === xs ? 'M' : 'L') + x.toFixed(1) + ' ' + yL(L).toFixed(1); }
      if (ld) { la = ld + `L${Math.min(xe, pR).toFixed(1)} ${yL(0)} L${xs.toFixed(1)} ${yL(0)} Z`; s += `<path d="${la}" class="l-area"/><path d="${ld}" class="l-line"/>`; }
    }
    // phase bar with names in long segments
    const yB = 115, hB = 19;
    const darkText = { settling: 1, waiting: 1, mixing: 1, dosing: 1, unknown: 1 };
    for (const g of model.segs) {
      if (g.t1 < t0 || g.t0 > t1) continue;
      const xa = this.x(Math.max(g.t0, t0)), xb = Math.min(this.x(Math.min(g.t1, t1)), pR);
      if (xb - xa < 0.2) continue;
      s += `<rect x="${xa.toFixed(1)}" y="${yB}" width="${Math.max(0.6, xb - xa - 0.8).toFixed(1)}" height="${hB}" rx="2" fill="${UC_PHASE_COLORS[g.dp] || '#ccc'}"/>`;
      const lab = T.phase[g.dp] || '';
      if (lab && xb - xa > lab.length * 6.2 + 12) s += `<text x="${((xa + xb) / 2).toFixed(1)}" y="${yB + 13.5}" text-anchor="middle" class="bar-t${darkText[g.dp] ? ' dk' : ''}">${lab}</text>`;
    }
    s += `<text x="${pL - 6}" y="${yB + 12}" class="ax" text-anchor="end"></text>`;
    // holiday + warnings strip
    for (const h of model.holidays) { if (h.t1 < t0 || h.t0 > t1) continue; const xa = this.x(Math.max(h.t0, t0)), xb = this.x(Math.min(h.t1, t1)); s += `<rect x="${xa}" y="${yB + hB + 2}" width="${Math.max(1, xb - xa)}" height="4" fill="#8E6CD8"/>`; }
    for (const h of model.warnings) { if (h.t1 < t0 || h.t0 > t1) continue; const xa = this.x(Math.max(h.t0, t0)), xb = this.x(Math.min(h.t1, t1)); s += `<rect x="${xa}" y="${yB + hB + 2}" width="${Math.max(2, xb - xa)}" height="4" fill="#D93025"/>`; }
    // batch start / end as lines through the charts
    for (const e of model.events) {
      if (e.t < t0 || e.t > t1 || (e.type !== 'start' && e.type !== 'batch')) continue;
      const x = this.x(e.t).toFixed(1);
      s += `<line x1="${x}" x2="${x}" y1="8" y2="${yB + hB}" class="${e.type === 'start' ? 'bl-start' : 'bl-batch'}"/>`;
    }
    // events
    const yE = 150;
    for (const e of model.events) {
      if (e.t < t0 || e.t > t1) continue; const st = UC_EV_STYLE[e.type]; if (!st) continue;
      const x = this.x(e.t);
      s += `<path d="${st.d(x, yE)}" fill="${st.hollow ? 'none' : st.c}" stroke="${st.c}" stroke-width="${st.hollow ? 1.5 : 0.6}"/>`;
    }
    // time axis
    const span = t1 - t0; const MIN = 60e3;
    const stepM = span <= 3 * 3600e3 ? 15 : span <= 7 * 3600e3 ? 60 : span <= 26 * 3600e3 ? 180 : 360;
    const d0 = new Date(t0); d0.setSeconds(0, 0);
    let tt = d0.getTime(); while ((new Date(tt).getHours() * 60 + new Date(tt).getMinutes()) % stepM) tt += MIN;
    const fmtH = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const fmtD = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' });
    for (; tt <= t1; tt += stepM * MIN) {
      if (tt < t0) continue; const x = this.x(tt); const dd = new Date(tt);
      const lab = dd.getHours() === 0 && dd.getMinutes() === 0 ? fmtD.format(dd) : fmtH.format(dd);
      s += `<line x1="${x}" x2="${x}" y1="10" y2="${yE + 8}" class="vgrid"/><text x="${x}" y="${H - 2}" class="ax" text-anchor="middle">${lab}</text>`;
    }
    s += `<line id="hov" x1="0" x2="0" y1="6" y2="${yE + 8}" class="hov" style="display:none"/>`;
    s += `<line id="cur" x1="0" x2="0" y1="4" y2="${yE + 10}" class="cur"/><circle id="curk" cx="0" cy="4" r="4" class="curk"/>`;
    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${H}`);
    this.svg.setAttribute('height', H);
    this.svg.innerHTML = s;
    this.cur = this.svg.querySelector('#cur'); this.curk = this.svg.querySelector('#curk'); this.hov = this.svg.querySelector('#hov');
  }

  setCursor(t) {
    if (!this.cur) return;
    const vis = t >= this.t0 && t <= this.t1;
    const x = this.x(t).toFixed(1);
    this.cur.style.display = vis ? '' : 'none'; this.curk.style.display = vis ? '' : 'none';
    this.cur.setAttribute('x1', x); this.cur.setAttribute('x2', x); this.curk.setAttribute('cx', x);
  }

  hover(px, T, locale) {
    if (!this.hov || !this.model) return;
    if (px === null) { this.hov.style.display = 'none'; this.tip.style.display = 'none'; return; }
    const r = this.svg.getBoundingClientRect(); const sx = this.W / r.width;
    const x = ucClamp((px - r.left) * sx, this.padL, this.W - this.padR);
    const t = this.t(x); const m = this.model;
    if (t > (m.now || t) + 1000) { this.hov.style.display = 'none'; this.tip.style.display = 'none'; return; }
    this.hov.style.display = ''; this.hov.setAttribute('x1', x); this.hov.setAttribute('x2', x);
    const g = m.segAt(t); const p = parseFloat(ucValAt(m.power, t));
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const ph = g ? T.phase[g.dp] + (g.ctx === 'batch' ? ' · ' + T.ctx.batch : g.post ? ' · ' + T.ctx.post : g.p !== 'offline' ? ' · ' + T.ctx.wait : '') : '–';
    this.tip.innerHTML = `<b>${fmt.format(new Date(t))}</b><br><span class="dot" style="background:${g ? UC_PHASE_COLORS[g.dp] : '#ccc'}"></span>${ph}<br>${T.power} ${isFinite(p) ? p.toFixed(1) + ' W' : '–'} · ${T.level} ${Math.round(m.levelAt(t) * 100)} %`;
    this.tip.style.display = 'block';
    const left = (px - r.left); const w = this.tip.offsetWidth;
    this.tip.style.left = Math.min(Math.max(0, left + 12), r.width - w - 4) + 'px';
  }
}
/* Uponor Clean Card – the Lovelace element */
const UC_CSS = `
:host { display:block; }
ha-card, .card { display:block; padding:12px 16px 10px; overflow:hidden; box-sizing:border-box; }
.uc { --uc-fg: var(--primary-text-color, #1d1d1f); --uc-muted: var(--secondary-text-color, #6b6b70);
  --uc-line: var(--divider-color, rgba(0,0,0,.12)); --uc-chip: rgba(127,127,127,.12); --uc-accent: var(--primary-color, #0288d1);
  --uc-card: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--uc-fg); position:relative;
  --uc-wall:#d3d9df; --uc-boxf:#f2f4f6; }
.uc.dark { --uc-wall:#56606b; --uc-boxf:#2b2f34; }
.lay { display:grid; gap:10px 18px; grid-template-columns:minmax(0,1fr); grid-template-areas:"status" "schem" "tl" "log"; }
.status { grid-area:status; min-width:0; } .schem { grid-area:schem; } .log { grid-area:log; min-width:0; } .tl { grid-area:tl; }
.colL, .colR { display:contents; }
/* wide: the drawing with the timeline under it on the left, the status and the logbook on the right */
.uc.wide .lay { grid-template-columns:minmax(0,3fr) minmax(320px,2fr); grid-template-areas:"l r"; }
.uc.wide .colL, .uc.wide .colR { display:flex; flex-direction:column; gap:10px; min-width:0; }
.uc.wide .colL { grid-area:l; } .uc.wide .colR { grid-area:r; }
.uc.wide .colR .log { flex:1; }
.st-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.st-top .title { font-size:15px; font-weight:500; margin-right:auto; }
.st-top .mode { margin-left:auto; }
.st-phase { display:flex; align-items:baseline; gap:10px; margin-top:10px; flex-wrap:wrap; }
.st-phase .dot { width:12px; height:12px; border-radius:50%; flex:none; align-self:center; }
.st-name { font-size:22px; font-weight:500; line-height:1.15; }
.st-ctx { font-size:15px; color:var(--uc-muted); }
.st-bar { height:6px; border-radius:3px; background:var(--uc-chip); margin:8px 0 5px; overflow:hidden; }
.st-fill { height:100%; width:0; border-radius:3px; transition:width .6s; }
.st-meta { display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:13.5px; color:var(--uc-muted); font-variant-numeric:tabular-nums; }
.st-eta { color:#E04A3F; font-weight:500; font-size:15px; }
.banner { margin-top:8px; background:rgba(217,48,37,.12); color:#D93025; border-radius:8px; padding:6px 10px; font-size:13.5px; display:none; }
.kv { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:10px 18px; margin:12px 0 0; padding-top:10px; border-top:1px solid var(--uc-line); }
.kv > div { min-width:0; } .kv dt { font-size:12px; color:var(--uc-muted); } .kv dd { margin:2px 0 0; font-size:15px; font-weight:500; display:flex; align-items:center; gap:8px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.kv dd svg { display:block; } .kv dd.warn { color:#D93025; } .kv dd.low { color:#E8710A; }
.kv .act { cursor:pointer; border-radius:6px; margin:-3px -5px; padding:3px 5px; } .kv .act:hover { background:var(--uc-chip); }
.kv .act dd::after { content:'✎'; font-size:12px; color:var(--uc-muted); font-weight:400; }
.chemed { display:none; margin-top:10px; padding:10px 12px; border-radius:10px; background:var(--uc-chip); font-size:13.5px; }
.chemed.open { display:block; } .chemed .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.chemed label { color:var(--uc-fg); font-weight:500; } .chemed .note { color:var(--uc-muted); font-size:12.5px; margin-top:6px; }
.chemed .cap { color:var(--uc-muted); }
.chemed input { font:inherit; width:84px; padding:4px 8px; border-radius:8px; border:1px solid var(--uc-line); background:var(--uc-card); color:var(--uc-fg); font-variant-numeric:tabular-nums; }
.chemed input:focus-visible, .chemed button:focus-visible { outline:2px solid var(--uc-accent); outline-offset:1px; }
.chemed button { font:inherit; font-size:13px; padding:4px 12px; border-radius:8px; border:1px solid var(--uc-line); background:var(--uc-card); color:var(--uc-fg); cursor:pointer; }
.chemed button.pri { background:var(--uc-accent); border-color:var(--uc-accent); color:#fff; }
.t-cheml { font-size:13px; font-weight:600; fill:#6a5410; paint-order:stroke; stroke:#f2f2ee; stroke-width:3px; }
.sub { font-size:14px; font-weight:500; margin:0 0 4px; } .sub span { color:var(--uc-muted); font-weight:400; font-size:12.5px; margin-left:8px; }
.uc.wide .log { position:relative; min-height:110px; display:flex; flex-direction:column; border-top:1px solid var(--uc-line); padding-top:10px; }
.uc.wide .logbox { position:relative; flex:1; min-height:0; }
.uc.wide .logbox > .entries { position:absolute; inset:0; overflow:auto; grid-template-columns:minmax(0,1fr); align-content:start; gap:1px; }
.uc .log.row .ent > div { display:grid; grid-template-columns:128px minmax(0,1fr); column-gap:12px; align-items:baseline; }
.uc .log.row .ent .tm { font-size:12px; }
.uc.wide .logbox > .more { display:none !important; }
.title { font-size:19px; font-weight:500; letter-spacing:.1px; }
.tip .dot, .leg .sq { width:10px; height:10px; border-radius:50%; display:inline-block; }
.mode { font-size:13.5px; color:var(--uc-accent); white-space:nowrap; }
.mode.live { color:var(--uc-muted); }
.seg { display:inline-flex; border:1px solid var(--uc-line); border-radius:8px; overflow:hidden; }
.seg button, .btn { font:inherit; font-size:13px; background:none; color:var(--uc-fg); border:0; padding:4px 10px; cursor:pointer; }
.seg button.on { background:var(--uc-chip); color:var(--uc-accent); }
.btn { border:1px solid var(--uc-line); border-radius:8px; min-width:34px; }
.btn.on { border-color:var(--uc-accent); color:var(--uc-accent); }
.btn:disabled { opacity:.35; cursor:default; }
.schem { position:relative; }
.schem svg { width:100%; height:auto; display:block; max-height:max(300px, calc(100vh - 390px)); margin:0 auto; }
.schem svg.hide { display:none; }
.uc.narrow .schem { overflow-x:auto; overflow-y:hidden; -webkit-overflow-scrolling:touch; margin:0 -16px; padding:0 0 4px; }
.uc.narrow .schem svg { width:780px; max-width:none; max-height:none; }
.tl { border-top:1px solid var(--uc-line); padding-top:8px; }
.ctrl { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.ctrl .rng { color:var(--uc-muted); font-size:14px; min-width:84px; text-align:center; }
.ctrl .sp { flex:1; }
.leg { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:13px; color:var(--uc-fg); align-items:center; }
.leg i { display:inline-block; width:14px; height:3px; border-radius:2px; vertical-align:middle; margin-right:5px; }
.leg .sq { border-radius:2px; margin-right:5px; vertical-align:-1px; }
.leg svg { vertical-align:-2px; margin-right:4px; }
.chartwrap { position:relative; margin-top:4px; touch-action:pan-y; }
.chartwrap svg { width:100%; display:block; cursor:crosshair; user-select:none; }
.tip { position:absolute; top:0; display:none; background:var(--uc-card); border:1px solid var(--uc-line); border-radius:8px; padding:6px 9px; font-size:12.5px; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.12); white-space:nowrap; z-index:2; line-height:1.45; }
.scrub { width:100%; margin:2px 0 2px; accent-color:var(--uc-accent); height:6px; }
.leg2 { font-size:12px; gap:4px 12px; }
.grid { stroke:var(--uc-line); } .grid.dash { stroke-dasharray:3 4; } .vgrid { stroke:var(--uc-line); stroke-opacity:.6; }
.ax { font-size:11.5px; fill:var(--uc-muted); }
.p-line { fill:none; stroke:#D6336C; stroke-width:1; stroke-linejoin:round; } .p-area { fill:#D6336C; opacity:.08; }
.l-line { fill:none; stroke:#2D8CE0; stroke-width:1; } .l-area { fill:#2D8CE0; opacity:.13; }
.hov { stroke:var(--uc-muted); stroke-dasharray:2 3; } .cur { stroke:var(--uc-accent); stroke-width:1.2; } .curk { fill:var(--uc-accent); }
.uc:not(.wide) .log { border-top:1px solid var(--uc-line); padding-top:8px; }
.log h3 { margin:0 0 6px; font-size:16px; font-weight:500; } .log h3 span { color:var(--uc-muted); font-weight:400; font-size:13.5px; margin-left:8px; }
.entries { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 430px), 1fr)); gap:2px 24px; }
.ent { display:grid; grid-template-columns:14px minmax(0,1fr); column-gap:8px; align-items:start; padding:4px 6px; border-radius:6px; font-size:12.5px; line-height:1.35; cursor:pointer; }
.ent svg { margin-top:3px; } .ent .tm { font-size:11.5px; }
.ent:hover { background:var(--uc-chip); } .ent.first { background:rgba(2,136,209,.10); }
.ent .tm { color:var(--uc-muted); white-space:nowrap; font-variant-numeric:tabular-nums; }
.more { margin-top:6px; }
.empty { color:var(--uc-muted); font-size:13.5px; padding:6px 0; }
/* drawing */
.ground { stroke-dasharray:2 5; }
.riser-in { fill:var(--uc-card); } .wall { stroke:var(--uc-fg); stroke-opacity:.5; stroke-width:2; fill:none; }
.lid { fill:var(--uc-muted); opacity:.6; } .tank-bg { fill:var(--uc-card); }
.tank-edge { fill:none; stroke:var(--uc-fg); stroke-opacity:.5; stroke-width:8.6; stroke-linejoin:round; }
.tank-wall { fill:none; stroke:var(--uc-wall); stroke-width:6.2; stroke-linejoin:round; } .tank-open { stroke:var(--uc-card); stroke-width:11; }
.wall-edge { fill:none; stroke:var(--uc-fg); stroke-opacity:.5; stroke-width:7.4; } .wall-body { fill:none; stroke:var(--uc-wall); stroke-width:5; }
.lid-hl { stroke:#fff; stroke-opacity:.35; stroke-width:1; }
.shine { fill:none; stroke:#fff; stroke-opacity:.6; stroke-width:1.3; stroke-dasharray:12 54; animation:ucshine 7s linear infinite; }
@keyframes ucshine { to { stroke-dashoffset:-66; } }
.sc-line, .sc-tick { stroke:var(--uc-fg); stroke-opacity:.35; } .sc-key { stroke:var(--uc-fg); stroke-opacity:.7; stroke-width:1.4; }
.sc-num { font-size:11px; fill:var(--uc-fg); font-weight:500; font-variant-numeric:tabular-nums; } .sc-lbl { font-size:9.5px; fill:var(--uc-muted); }
.sc-mark.sc-proc { fill:#2D8CE0; } .sc-mark.sc-sao { fill:#8a7a55; }
.pipe-hl path { fill:none; stroke:#fff; stroke-opacity:.55; stroke-width:1.3; stroke-linejoin:round; }
.hose-sh { fill:none; stroke:#000; stroke-opacity:.25; stroke-width:5.8; stroke-linecap:round; stroke-linejoin:round; }
.clamp { fill:#2b2d30; opacity:.9; } .box-lid { fill:var(--uc-fg); opacity:.12; } .fin { stroke:#7d848c; stroke-width:1.2; }
.led-s { fill:#8a8d92; } .led-s.on { fill:#ff3b30; } .vbody { fill:#3a3d42; }
.chem-cap { fill:#f4f4f0; stroke:#b4b7b1; } .cap-rib { stroke:#c3c6c0; stroke-width:1; } .chem-bail { fill:none; stroke:#3a3a3a; stroke-width:1.4; }
.chem-pct { font-size:11px; font-weight:600; fill:#6a5410; }
.tube-hl { stroke:#fff; stroke-opacity:.5; stroke-width:1.2; } .rigid-hl { stroke:#fff; stroke-opacity:.45; stroke-width:1; } .ball-hl { fill:#fff; opacity:.25; }
.spart { fill:#6b624d; opacity:.5; } .plume { fill:#5a3d1c; }
.bar-t { font-size:10.5px; fill:#fff; font-weight:500; pointer-events:none; } .bar-t.dk { fill:#3b3326; }
.bl-start { stroke:#2D8CE0; stroke-dasharray:3 3; opacity:.55; } .bl-batch { stroke:#E04A3F; stroke-dasharray:3 3; opacity:.55; }
.t-lid { fill:#f2f2ee; stroke:#c4c6c0; stroke-width:1.5; } .t-ccap { fill:#f7f7f4; stroke:#b9bcb6; stroke-width:1.2; } .t-crib { fill:none; stroke:#c9ccc6; stroke-width:4; stroke-dasharray:1.4 2.4; } .t-ccap2 { fill:#eceeea; stroke:#d3d6d0; stroke-width:1; }
.t-bail { fill:none; stroke:#2e2e2e; stroke-width:2.4; stroke-linecap:round; } .t-hinge { fill:#d9dbd6; stroke:#8e918b; stroke-width:1; } .t-capdot { fill:#dadcd8; }
.partition { fill:none; stroke:var(--uc-fg); stroke-opacity:.42; stroke-width:5; stroke-linecap:round; }
.w-scum { fill:#6E5630; opacity:.55; }
.w-line { fill:none; stroke:#3D8BD0; stroke-width:1.6; opacity:.9; }
.w-tint { fill:#E8C21C; }
.floc { fill:#5A3D1C; opacity:.72; } .bubble { fill:rgba(255,255,255,.6); stroke:#4A8CCB; stroke-width:.8; }
.pipe-o { fill:none; stroke:#8d959e; stroke-linejoin:round; } .pipe-i { fill:none; stroke:var(--uc-card); stroke-linejoin:round; opacity:.92; }
.liq { fill:none; stroke-width:7; stroke-linejoin:round; opacity:.8; } .liq-tint { stroke:#E8C21C; }
.slug { fill:#fff; stroke:#8fb7dc; stroke-width:.8; }
.stream { fill:none; stroke-width:4; stroke-dasharray:9 5; stroke-linecap:round; }
.pflow { fill:none; stroke:#fff; stroke-opacity:.6; stroke-width:2.4; stroke-dasharray:5 11; stroke-linecap:round; stroke-linejoin:round; }
.splash { fill:none; stroke:#4A8CCB; stroke-width:1.2; }
.outflow { stroke:#7FB2DE; stroke-width:7; stroke-dasharray:10 6; fill:none; }
.pipe-h { fill:#B9BFC7; }
.hose { fill:none; stroke-width:3.4; stroke-linecap:round; stroke-linejoin:round; transition:opacity .4s; }
.hose-flow { fill:none; stroke:#fff; stroke-width:1.9; stroke-dasharray:2 9; stroke-linecap:round; animation:ucflow .55s linear infinite; }
.hose-flow.t { stroke-width:3.2; stroke-dasharray:3 13; animation-name:ucflowT; }
.hose-flow.rev { animation-direction:reverse; animation-duration:1.5s; }
@keyframes ucflow { to { stroke-dashoffset:-11; } } @keyframes ucflowT { to { stroke-dashoffset:-16; } }
.inj { fill:#fff; stroke:#555; stroke-width:1; }
.box { fill:var(--uc-boxf); stroke:var(--uc-fg); stroke-opacity:.35; }
.comp { fill:#D7DBE0; stroke:#7d848c; } .comp-d { fill:none; stroke:#7d848c; stroke-width:1.5; }
.buzz { animation:ucbuzz .08s linear infinite; }
@keyframes ucbuzz { 0%{transform:translate(0,0)} 25%{transform:translate(.7px,-.4px)} 50%{transform:translate(-.6px,.5px)} 75%{transform:translate(.4px,.4px)} }
.valve { opacity:.35; stroke:#333; stroke-width:.6; } .valve.on { opacity:1; stroke:#fff; stroke-width:1.6; }
.chem-tank { fill:rgba(250,250,246,.9); stroke:#b8bbb5; stroke-width:1.2; } .chem-liq { opacity:.82; } .chem-pump { fill:#8a8f96; }
.chem-drip { fill:none; stroke:#E8C21C; stroke-width:2; stroke-dasharray:3 5; animation:ucflow .5s linear infinite; }
.tube-o { fill:#B9BFC7; } .tube-air { fill:var(--uc-card); } .cap { fill:#7d848c; }
.gauge-bg { fill:var(--uc-card); stroke:rgba(127,127,127,.35); stroke-width:3; } .gauge-bg.trip { fill:rgba(46,160,67,.3); }
.rigid { stroke:#8E959E; stroke-width:5; fill:none; } .nut { fill:#4a4f55; } .ball { fill:#3c4046; }
.flare, .funnel { fill:none; stroke:#9AA2AC; stroke-width:3; stroke-linejoin:round; }
.lvl { stroke:var(--uc-fg); stroke-opacity:.35; stroke-dasharray:5 4; } .lvl.alarm { stroke:#D93025; stroke-opacity:.55; }
.lbl { font-size:13px; fill:var(--uc-muted); } .lbl.halo { paint-order:stroke; stroke:var(--uc-card); stroke-width:3.5; stroke-opacity:.75; stroke-linejoin:round; } .tlbl { font-size:15px; fill:var(--uc-fg); font-weight:500; }
.plbl { font-size:12.5px; fill:var(--uc-muted); } .pval { font-size:14px; font-weight:500; fill:var(--uc-fg); }
.pill { fill:rgba(127,127,127,.10); stroke:rgba(127,127,127,.45); } .pill.run { fill:rgba(224,74,63,.10); stroke:rgba(224,74,63,.65); }
.pill.blue { fill:rgba(45,140,224,.10); stroke:rgba(45,140,224,.6); } .pill.brown { fill:rgba(139,90,43,.10); stroke:rgba(139,90,43,.55); }
.inset { fill:var(--uc-card); stroke:var(--uc-line); stroke-width:1.2; }
.inset-tank { fill:none; stroke:var(--uc-fg); stroke-opacity:.6; stroke-width:1.6; }
.chem-liq2 { fill:#EADBA0; opacity:.85; } .chem-liq3 { fill:#D9B94A; }
.itube-o { fill:none; stroke:var(--uc-fg); stroke-opacity:.5; stroke-width:6; } .itube-i { fill:none; stroke:var(--uc-card); stroke-width:3; }
.itube-liq { fill:none; stroke:#C9A21A; stroke-width:3; }
.hole { fill:var(--uc-fg); } .chamber { fill:var(--uc-card); stroke:#7d848c; stroke-width:1.4; }
.ballv { fill:#9fd3f0; stroke:#3b86b8; } .seat { stroke:#7d848c; stroke-width:2; } .drop { fill:#C9A21A; }
.ilbl { font-size:11px; fill:var(--uc-muted); }
.t-ring { fill:#2f2f2f; } .t-sao { fill:#1d1912; } .t-proc { fill:#2e2418; } .t-foam { fill:#efe7d6; opacity:.1; transition:opacity 1s; }
.t-scum { fill:#4b4030; opacity:.85; } .t-part { stroke:#0d0d0d; stroke-width:12; }
.t-pipe { stroke:#C9CDD2; stroke-width:26; fill:none; stroke-linecap:round; } .t-black { stroke:#151515; stroke-width:30; stroke-linecap:round; }
.t-clamp { fill:#9AA0A8; stroke:#6f757c; } .t-pipeend { fill:#555b62; } .t-blackpipe { fill:#141414; stroke:#333; }
.t-cap { fill:#6f757c; stroke:#4a4f55; stroke-width:2; } .t-fit { fill:#111; }
.t-conduit { stroke:#151515; stroke-width:34; fill:none; stroke-linecap:round; }
.t-chem { fill:rgba(242,194,27,.10); stroke:#F2C21B; stroke-width:2; stroke-dasharray:6 5; }
.those { fill:none; stroke-width:9; stroke-linecap:round; transition:opacity .4s; }
.ripple { fill:none; stroke:rgba(255,255,255,.55); stroke-width:1.4; } .ripple.yel { stroke:#F2C21B; }
.speck { fill:#f5efe0; } .glow { fill:none; stroke-width:3; } .t-rim { fill:none; stroke:#111; stroke-width:3; }
.badge text { font-size:15px; font-weight:600; }
.tl-t { font-size:14px; fill:var(--uc-fg); font-weight:500; } .tl-t.sm { font-size:13px; } .tl-c { font-size:11.5px; fill:var(--uc-muted); } .tl-a { fill:var(--uc-accent); display:none; } .tleg.on .tl-a { display:inline; }
.t-on { fill:#cfc8b8; }
.tnum { font-size:12px; font-weight:600; }
.pn-frame { fill:#E7E8EA; stroke:#bfc3c8; } .pn-face { fill:#3a3e44; } .pn-screw { fill:#1b1d20; }
.pn-s { font-size:9.5px; fill:#e8e8e8; } .pn-l { font-size:10.5px; fill:#ececec; font-weight:500; }
.pn-sticker { fill:#f3f3f3; } .pn-v { font-size:7.5px; fill:#666; letter-spacing:.5px; } .pn-u { font-size:13px; fill:#2f6db5; font-weight:700; }
.pn-cc { font-size:9.5px; fill:#333; font-weight:700; } .pn-logo { font-size:13px; fill:#6b6f75; font-weight:700; letter-spacing:.5px; }
.pn-disp { fill:#170707; stroke:#2b2b2b; } .seg { fill:#3c1210; } .seg.on { fill:#ff3d2e; }
.led { fill:#878a8f; } .led.on { fill:#ff3b30; } .ledh { fill:#ff3b30; opacity:0; transition:opacity .3s; } .ledh.on { opacity:.35; }
.pn-valve { fill:#1f2124; } .pn-nut { fill:#b9bdc2; stroke:#7d8288; } .pn-psw { fill:#d9dadc; stroke:#9a9ea3; stroke-width:1.5; } .pn-psw.on { stroke:#2EA043; stroke-width:3; }
@media (prefers-reduced-motion: reduce) { .hose-flow, .buzz, .chem-drip { animation:none; } }
`;

class UponorCleanCard extends HTMLElement {
  /* New card from the card picker: finds the entities of the Shelly script v3 (the Phase sensor
     and the other entities of the same device). */
  static getStubConfig(hass) {
    const cfg = { name: UC_DEFAULTS.name, entities: { ...UC_DEFAULTS.entities } };
    const st = (hass && hass.states) || {}; const reg = (hass && hass.entities) || {};
    const phase = Object.keys(st).find((id) => /^sensor\..*_phase$/.test(id) && ((st[id].attributes || {}).options || []).includes('Pump-in'));
    if (!phase) return cfg;
    const base = phase.slice('sensor.'.length, -'_phase'.length);
    const has = (id) => (st[id] ? id : null);
    Object.assign(cfg.entities, {
      phase, cycle: has(`sensor.${base}_cycle`), message: has(`sensor.${base}_status`), status: null,
      warning: has(`sensor.${base}_warning`), next_pumpout: has(`sensor.${base}_next_pump_out`),
      batch_counter: has(`number.${base}_batches`), chemical: has(`number.${base}_chemical`), sludge: has(`number.${base}_sludge`),
    });
    const dev = reg[phase] && reg[phase].device_id;
    const sameDev = (dc) => Object.keys(st).find((id) => id.startsWith('sensor.') && (st[id].attributes || {}).device_class === dc && (!dev || (reg[id] && reg[id].device_id === dev)));
    cfg.entities.power = sameDev('power') || cfg.entities.power;
    cfg.entities.energy = sameDev('energy') || null;
    return cfg;
  }

  /* Visual editor (Home Assistant builds the form from this schema) */
  static getConfigForm() {
    const fi = /^fi/i.test((document.querySelector('home-assistant') || {}).hass ? document.querySelector('home-assistant').hass.language || '' : navigator.language || '');
    const L = fi ? UC_FORM_LABELS.fi : UC_FORM_LABELS.en;
    const ent = (name, domain) => ({ name, selector: { entity: domain ? { domain } : {} } });
    return {
      schema: [
        { name: 'name', selector: { text: {} } },
        { type: 'grid', name: '', schema: [
          { name: 'language', selector: { select: { mode: 'dropdown', options: [{ value: 'auto', label: L.lang_auto }, { value: 'fi', label: 'Suomi' }, { value: 'en', label: 'English' }] } } },
          { name: 'view', selector: { select: { mode: 'dropdown', options: [{ value: 'side', label: L.view_side }, { value: 'top', label: L.view_top }] } } },
          { name: 'hours', selector: { select: { mode: 'dropdown', options: ['2', '6', '48'].map((v) => ({ value: v, label: v + ' h' })) } } },
          { name: 'sludge_emptied', selector: { date: {} } },
        ] },
        { type: 'expandable', name: 'entities', title: L.entities, schema: [
          ent('power', 'sensor'), ent('phase', 'sensor'), ent('cycle', 'sensor'), ent('message', 'sensor'), ent('warning', 'sensor'),
          ent('next_pumpout', 'sensor'), ent('batch_counter'), ent('chemical', 'number'), ent('sludge', 'number'), ent('energy', 'sensor'),
        ] },
        { type: 'expandable', name: 'more', flatten: true, title: L.more, schema: [
          { name: 'batch_volume', selector: { number: { min: 50, max: 500, step: 10, mode: 'box', unit_of_measurement: 'l' } } },
          { name: 'sludge_reminder_batches', selector: { number: { min: 100, max: 2000, step: 50, mode: 'box' } } },
          { name: 'chemical_capacity', selector: { number: { min: 5, max: 50, step: 1, mode: 'box', unit_of_measurement: 'l' } } },
          { name: 'history_days', selector: { number: { min: 2, max: 10, step: 1, mode: 'box', unit_of_measurement: 'd' } } },
        ] },
      ],
      computeLabel: (s) => L[s.name] || undefined,
      computeHelper: (s) => (L.help && L.help[s.name]) || undefined,
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._model = new UcModel();
    this._view = null; this._hours = null; this._winEnd = null; this._cursor = null; this._playing = false; this._speed = 30;
    this._logOpen = false; this._loaded = false; this._dirty = true; this._lastBuild = 0; this._seen = {};
    this._anim = 0; this._lastFrame = 0; this._lastChart = 0; this._lastChips = 0; this._lastS = null; this._sT = 0;
    this._visible = true;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const ent = { ...UC_DEFAULTS.entities, ...(config.entities || {}) };
    // legacy belongs at the top level; accept it inside entities too
    const legacy = config.legacy || (config.entities && config.entities.legacy) || null; delete ent.legacy;
    this._cfg = { ...UC_DEFAULTS, ...config, entities: ent, legacy };
    this._model.batchVolume = +this._cfg.batch_volume || 170; this._model.sludgeLpm = +this._cfg.sludge_return_lpm || 12;
    if (this._view === null) this._view = this._cfg.view === 'top' ? 'top' : 'side';
    if (this._hours === null) this._hours = [2, 6, 48].includes(+this._cfg.hours) ? +this._cfg.hours : 6;
    if (this._built) { this._built = false; this._render(); }
  }

  set hass(hass) {
    const first = !this._hass; this._hass = hass;
    if (!this._built) this._render();
    const uc = this.shadowRoot.querySelector('.uc'); if (uc) uc.classList.toggle('dark', !!(hass.themes && hass.themes.darkMode));
    this._ingestLive();
    if (first || (!this._loaded && !this._loading && Date.now() - (this._lastTry || 0) > 60e3)) this._loadHistory();
  }
  get hass() { return this._hass; }

  getCardSize() { return 14; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  connectedCallback() {
    this._io = new IntersectionObserver((e) => { this._visible = e.some((x) => x.isIntersecting); }, { threshold: 0 });
    this._io.observe(this);
    this._ro = new ResizeObserver(() => { this._lastChart = 0; this._layout(); });
    this._ro.observe(this);
    this._onWin = () => this._layout(); window.addEventListener('resize', this._onWin);
    this._startLoop();
    this._refreshTimer = setInterval(() => this._loadHistory(true), 20 * 60e3);
  }
  disconnectedCallback() {
    if (this._io) this._io.disconnect(); if (this._ro) this._ro.disconnect(); window.removeEventListener('resize', this._onWin);
    cancelAnimationFrame(this._raf); this._raf = null; clearInterval(this._refreshTimer);
  }

  _now() { return typeof window.__ucNow === 'function' ? window.__ucNow() : Date.now(); }
  get T() {
    let lang = this._cfg && this._cfg.language !== 'auto' ? this._cfg.language : null;
    if (!lang && this._hass) lang = (this._hass.locale && this._hass.locale.language) || this._hass.language;
    lang = (lang || 'en').toLowerCase().startsWith('fi') ? 'fi' : 'en';
    this._lang = lang;
    return UC_I18N[lang];
  }
  get _locale() { return this._lang === 'fi' ? 'fi-FI' : ((this._hass && this._hass.locale && this._hass.locale.language) || 'en-GB'); }

  /* ---------- data ---------- */
  async _ws(start, end, ids) {
    const res = await this._hass.callWS({ type: 'history/history_during_period', start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false });
    return res || {};
  }

  async _loadHistory(refresh) {
    if (!this._hass || !this._hass.callWS || this._loading) return;
    this._loading = true; this._lastTry = Date.now();
    try {
      const E = this._cfg.entities; const L = this._cfg.legacy || {}; const now = this._now();
      const stId = E.phase || E.status;
      const longIds = [...new Set([stId, E.message, E.batch_counter, E.energy, E.cycle, E.warning, E.next_pumpout, E.chemical, E.sludge,
        L.status, L.message, L.batch_counter].filter(Boolean))];
      const start = now - (this._cfg.history_days || 8) * 86400e3;
      const r = await this._ws(start, now, longIds);
      const m = this._model;
      // legacy history is used only before the first value of the current entity
      const join = (cur, old) => { const a = ucFromHA(r[cur]); if (!old || old === cur) return a; const b = ucFromHA(r[old]); const t0 = a.length ? a[0].t : Infinity; return ucMergeSeries(b.filter((e) => e.t < t0 && e.v !== 'unavailable'), a); };
      m.status = join(stId, L.status); m.message = join(E.message, L.message); m.batch = join(E.batch_counter, L.batch_counter);
      m.energy = E.energy ? ucFromHA(r[E.energy]) : [];
      m.cycle = E.cycle ? ucFromHA(r[E.cycle]) : []; m.warn3 = E.warning ? ucFromHA(r[E.warning]) : []; m.next = E.next_pumpout ? ucFromHA(r[E.next_pumpout]) : [];
      m.chem = E.chemical ? ucFromHA(r[E.chemical]) : []; m.sludge = E.sludge ? ucFromHA(r[E.sludge]) : [];
      const pStart = Math.min(now - 49 * 3600e3, this._winStart() - 3600e3);
      const rp = await this._ws(pStart, now, [E.power]);
      m.power = ucFromHA(rp[E.power]); this._powerFrom = pStart;
      this._loaded = true; this._dirty = true; this._lastChart = 0; this._lastChips = 0;
    } catch (e) {
      this._error = String(e && e.message ? e.message : e);
      console.warn('uponor-clean-card: history load failed', e);
    } finally { this._loading = false; }
  }

  async _ensurePower(t0) {
    if (!this._loaded || this._loadingP || t0 >= this._powerFrom) return;
    this._loadingP = true;
    try {
      const E = this._cfg.entities; const s = t0 - 3600e3;
      const r = await this._ws(s, this._powerFrom, [E.power]);
      this._model.power = ucMergeSeries(ucFromHA(r[E.power]), this._model.power); this._powerFrom = s; this._lastChart = 0;
    } catch (e) { console.warn(e); } finally { this._loadingP = false; }
  }

  _ingestLive() {
    if (!this._hass) return;
    const E = this._cfg.entities; const m = this._model;
    const take = (key, series, numeric) => {
      const id = E[key]; if (!id) return; const st = this._hass.states[id]; if (!st) return;
      const t = Date.parse(numeric ? st.last_updated || st.last_changed : st.last_changed);
      const sig = st.state + '|' + t;
      if (this._seen[key] === sig) return; this._seen[key] = sig;
      const arr = m[series]; const last = arr[arr.length - 1];
      if (last && t < last.t) return;
      if (last && last.v === st.state && !numeric) return;
      if (last && Math.abs(last.t - t) < 1) arr[arr.length - 1] = { t, v: st.state }; else arr.push({ t, v: st.state });
      if (!numeric) this._dirty = true;
    };
    if (E.phase) { const st = this._hass.states[E.phase]; if (st) { const t = Date.parse(st.last_changed); const sig = st.state + '|' + t;
      if (this._seen.phase !== sig) { this._seen.phase = sig; const arr = m.status; const last = arr[arr.length - 1];
        if (!(last && t < last.t) && !(last && last.v === st.state)) { arr.push({ t, v: st.state }); this._dirty = true; } } } }
    else take('status', 'status');
    take('message', 'message'); take('batch_counter', 'batch'); take('power', 'power', true);
    if (E.energy) take('energy', 'energy', true);
    if (E.cycle) take('cycle', 'cycle'); if (E.warning) take('warning', 'warn3'); if (E.next_pumpout) take('next_pumpout', 'next');
    if (E.chemical) take('chemical', 'chem', true); if (E.sludge) take('sludge', 'sludge', true);
  }

  /* ---------- time window ---------- */
  _span() { return this._hours * 3600e3; }
  _winStart() { return (this._winEnd !== null ? this._winEnd : this._now()) - this._span(); }
  _displayT() { return this._cursor !== null ? this._cursor : this._now(); }

  /* ---------- render ---------- */
  _render() {
    const T = this.T; const cfg = this._cfg;
    const root = this.shadowRoot;
    const tag = customElements.get('ha-card') ? 'ha-card' : 'div';
    root.innerHTML = `<style>${UC_CSS}</style>
      <${tag} class="card"><div class="uc">
        <div class="lay">
          <div class="colR">
          <div class="status" id="status">
            <div class="st-top">${cfg.name ? `<span class="title">${cfg.name}</span>` : ''}<span class="mode live" id="mode"></span>
              <div class="seg" id="views"><button data-v="side">${T.side}</button><button data-v="top">${T.top}</button></div></div>
            <div class="st-phase"><span class="dot" id="st-dot"></span><span class="st-name" id="st-name">–</span><span class="st-ctx" id="st-ctx"></span></div>
            <div class="st-bar"><div class="st-fill" id="st-fill"></div></div>
            <div class="st-meta"><span id="st-prog"></span><span class="st-eta" id="st-eta"></span></div>
            <div class="banner" id="banner"></div>
            <dl class="kv" id="kv"></dl>
            <div class="chemed" id="chemed"></div>
          </div>
          <div class="log"><div class="sub">${T.logbook}<span id="logn"></span></div>
            <div class="logbox"><div class="entries" id="entries"></div><button class="btn more" id="more"></button></div></div>
          </div>
          <div class="colL">
          <div class="schem" id="schem">${ucSideMarkup(T)}${ucTopMarkup(T)}</div>
          <div class="tl">
            <div class="ctrl">
              <div class="seg" id="ranges"><button data-h="2">2 h</button><button data-h="6">6 h</button><button data-h="48">48 h</button></div>
              <button class="btn" id="prev" aria-label="previous">‹</button><span class="rng" id="rng"></span><button class="btn" id="next" aria-label="next">›</button>
              <div class="leg" id="leg1"></div><span class="sp"></span>
              <button class="btn" id="play" aria-label="play">▶</button><button class="btn" id="speed"></button><button class="btn" id="nowb">${T.now}</button>
            </div>
            <div class="chartwrap" id="cw"><svg id="chart"></svg><div class="tip" id="tip"></div></div>
            <input type="range" class="scrub" id="scrub" min="0" max="1000" value="1000" step="1">
            <div class="leg leg2" id="leg2"></div>
          </div>
          </div>
        </div>
      </div></${tag}>`;
    const $ = (id) => root.getElementById(id);
    this.$ = $;
    this._side = new UcSide(root.querySelector('svg.side'), root);
    this._top = new UcTop(root.querySelector('svg.top'));
    this._chart = new UcChart($('chart'), $('tip'));
    $('views').addEventListener('click', (e) => { const v = e.target.dataset.v; if (v) { this._view = v; this._applyView(); } });
    $('ranges').addEventListener('click', (e) => { const h = +e.target.dataset.h; if (h) { this._hours = h; this._lastChart = 0; this._syncWindow(); this._ctrlState(); } });
    $('prev').addEventListener('click', () => { this._winEnd = this._winStart(); this._cursorIntoWindow(); this._lastChart = 0; this._ctrlState(); });
    $('next').addEventListener('click', () => {
      const now = this._now(); if (this._winEnd === null) return;
      this._winEnd = this._winEnd + this._span(); if (this._winEnd >= now - 60e3) { this._winEnd = null; }
      this._cursorIntoWindow(); this._lastChart = 0; this._ctrlState();
    });
    $('play').addEventListener('click', () => {
      if (this._playing) { this._playing = false; }
      else { if (this._cursor === null) { this._cursor = this._winStart(); this._winEnd = this._winEnd === null ? null : this._winEnd; } this._playing = true; }
      this._ctrlState();
    });
    $('speed').addEventListener('click', () => { const s = [1, 10, 30, 60, 300]; this._speed = s[(s.indexOf(this._speed) + 1) % s.length]; this._ctrlState(); });
    $('nowb').addEventListener('click', () => { this._goLive(); });
    const cw = $('cw'); let drag = false;
    const setFromX = (cx) => {
      const r = this._chart.svg.getBoundingClientRect(); const sx = this._chart.W / r.width;
      const x = ucClamp((cx - r.left) * sx, this._chart.padL, this._chart.W - this._chart.padR);
      const t = Math.min(this._chart.t(x), this._now());
      if (t >= this._now() - 5000) { this._goLive(); return; }
      this._cursor = t; this._playing = false; this._ctrlState();
    };
    cw.addEventListener('pointerdown', (e) => { drag = true; cw.setPointerCapture(e.pointerId); setFromX(e.clientX); });
    cw.addEventListener('pointermove', (e) => { if (drag) setFromX(e.clientX); this._chart.hover(e.clientX, this.T, this._locale); });
    cw.addEventListener('pointerup', () => { drag = false; });
    cw.addEventListener('pointerleave', () => { this._chart.hover(null); });
    $('scrub').addEventListener('input', (e) => {
      const t0 = this._winStart(), t1 = Math.min(t0 + this._span(), this._now());
      const t = t0 + (t1 - t0) * (+e.target.value / 1000);
      if (+e.target.value >= 999 && this._winEnd === null) { this._goLive(); return; }
      this._cursor = t; this._playing = false; this._ctrlState();
    });
    $('more').addEventListener('click', () => { this._logOpen = !this._logOpen; this._renderLog(); });
    $('kv').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="chem"]')) this._openChem(); else if (e.target.closest('[data-act="sludge"]')) this._openSludge();
    });
    const save = () => (this._edMode === 'sludge' ? this._saveSludge() : this._saveChem());
    $('chemed').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'cancel') this._closeChem(); else if (b.dataset.a === 'save') save();
    });
    $('chemed').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') this._closeChem(); });
    $('entries').addEventListener('click', (e) => {
      const el = e.target.closest('.ent'); if (!el) return; const t = +el.dataset.t;
      this._cursor = t; this._playing = false;
      if (t < this._winStart() || t > this._winStart() + this._span()) { this._winEnd = Math.min(t + this._span() / 2, this._now()); if (this._winEnd >= this._now() - 60e3) this._winEnd = null; this._lastChart = 0; }
      this._ctrlState();
    });
    this._built = true;
    this._applyView(); this._ctrlState(); this._layout();
  }

  _layout() {
    const uc = this.shadowRoot && this.shadowRoot.querySelector('.uc'); if (!uc) return;
    const cw = this.clientWidth; const wide = cw >= 980;
    uc.classList.toggle('wide', wide);
    const svgs = this.shadowRoot.querySelectorAll('.schem svg');
    if (wide) {
      // The drawing and the timeline under it fit the window height: the drawing gets the height
      // left over (at least 220 px) and at most the width of its column. A page can reserve room
      // under the card with the CSS variable --uc-fit-bottom (default 14 px).
      const colL = this.shadowRoot.querySelector('.colL'), tl = this.shadowRoot.querySelector('.tl');
      const lw = (colL && colL.clientWidth) || Math.round((cw - 50) * 0.6);
      const top = this.getBoundingClientRect().top + window.scrollY;
      const below = parseFloat(getComputedStyle(this).getPropertyValue('--uc-fit-bottom')) || 14;
      const hAvail = window.innerHeight - top - (tl ? tl.offsetHeight : 270) - 12 - 10 - 10 - below;
      const h = Math.round(Math.max(220, Math.min(lw * 0.62, hAvail)));
      svgs.forEach((e) => { e.style.width = Math.round(h / 0.62) + 'px'; e.style.height = h + 'px'; e.style.maxHeight = 'none'; });
    } else svgs.forEach((e) => { e.style.width = ''; e.style.height = ''; e.style.maxHeight = ''; });
    const narrow = cw > 0 && cw < 680;
    if (narrow !== uc.classList.contains('narrow')) {
      uc.classList.toggle('narrow', narrow);
      if (narrow) requestAnimationFrame(() => { const sc = this.$('schem'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * 0.8; });
    }
    const lg = this.shadowRoot.querySelector('.log'); if (lg) lg.classList.toggle('row', lg.clientWidth >= 440);
    this._lastChart = 0;
  }

  _goLive() { this._cursor = null; this._playing = false; this._winEnd = null; this._lastChart = 0; this._ctrlState(); }
  _cursorIntoWindow() {
    if (this._cursor === null) return; const a = this._winStart(), b = a + this._span();
    if (this._cursor < a || this._cursor > b) this._cursor = this._winEnd === null && this._cursor > a ? null : ucClamp(this._cursor, a, b);
  }
  _syncWindow() {
    if (this._cursor !== null && this._winEnd !== null) {
      const a = this._winStart(); if (this._cursor < a || this._cursor > this._winEnd) { this._winEnd = Math.min(this._cursor + this._span() / 2, this._now()); if (this._winEnd >= this._now() - 60e3) this._winEnd = null; }
    }
  }
  _applyView() {
    const r = this.shadowRoot;
    r.querySelector('svg.side').classList.toggle('hide', this._view !== 'side');
    r.querySelector('svg.top').classList.toggle('hide', this._view !== 'top');
    this.$('views').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === this._view));
  }
  _ctrlState() {
    if (!this.$) return; const T = this.T;
    this.$('ranges').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.h === this._hours));
    this.$('next').disabled = this._winEnd === null;
    this.$('play').textContent = this._playing ? '❚❚' : '▶';
    this.$('play').classList.toggle('on', this._playing);
    this.$('speed').textContent = this._speed < 60 ? `${this._speed} s/s` : `${this._speed / 60} min/s`;
    this.$('speed').title = T.speed_title;
    this.$('nowb').classList.toggle('on', this._cursor === null);
    const rng = this.$('rng');
    if (this._winEnd === null) rng.textContent = ucFmt(T.last_h, { n: this._hours });
    else { const f = new Intl.DateTimeFormat(this._locale, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); rng.textContent = f.format(new Date(this._winEnd)); }
    this._lastChart = 0;
  }

  /* ---------- loop ---------- */
  _startLoop() {
    if (this._raf) return;
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      const dt = this._lastFrame ? Math.min(0.1, (ts - this._lastFrame) / 1000) : 0.016; this._lastFrame = ts;
      if (!this._built || !this._visible || document.hidden) return;
      try { this._frame(dt); } catch (e) { if (!this._errLogged) { console.error('uponor-clean-card', e); this._errLogged = true; } }
    };
    this._raf = requestAnimationFrame(step);
  }

  _frame(dt) {
    const now = this._now(); const m = this._model;
    this._anim += dt;
    if (this._playing && this._cursor !== null) {
      this._cursor += dt * this._speed * 1000;
      if (this._winEnd !== null && this._cursor > this._winEnd) { this._winEnd = Math.min(this._cursor + this._span() * 0.8, now); if (this._winEnd >= now - 60e3) this._winEnd = null; this._lastChart = 0; this._ctrlState(); }
      if (this._cursor >= now) this._goLive();
    }
    if (this._dirty && (now - this._lastBuild > 1500 || !this._lastBuild)) { m.build(now); this._lastBuild = now; this._dirty = false; this._lastChart = 0; this._lastChips = 0; }
    else if (now - this._lastBuild > 20e3) { m.build(now); this._lastBuild = now; }
    const t = this._displayT();
    if (!this._lastS || this._anim - this._sT > 0.12) { this._lastS = m.stateAt(t); this._sT = this._anim; }
    const S = this._lastS;
    const ctx = this._ctx(now);
    if (this._view === 'side') this._side.update(S, this._anim, dt, ctx); else this._top.update(S, this._anim);
    if (this._view === 'top') { ctx.batchNow = ucValAt(this._model.batch, t); this._top.updatePanel(S, ctx); this._side.updateInset(S, this._anim, ctx); }
    if (!this._lastChart || this._anim - this._lastChart > (this._cursor === null ? 15 : 60)) this._renderChart();
    this._chart.setCursor(t);
    const sc = this.$('scrub'); if (document.activeElement !== this && !this._scrubbing) {
      const a = this._winStart(), b = Math.min(a + this._span(), now); sc.value = String(Math.round(ucClamp((t - a) / Math.max(1, b - a), 0, 1) * 1000));
    }
    if (!this._lastChips || this._anim - this._lastChips > 1) { this._renderHead(S, now); this._renderChips(S, now); this._renderLog(); this._lastChips = this._anim; }
  }

  _ctx(now) {
    const cfg = this._cfg; const T = this.T; const c = { T, locale: this._locale };
    const sr = this._sludgeRem(); if (sr) { c.sludgeDue = sr.n >= sr.m; c.sludgeRem = sr; }
    let days = null, est = false;
    const d0 = cfg.sludge_emptied ? Date.parse(cfg.sludge_emptied) : NaN;
    if (isFinite(d0)) days = Math.max(0, (now - d0) / 86400e3);
    if (cfg.entities.sludge && sr) {
      // the Shelly sludge counter is the reference: a reset seen in the history wins, and a configured
      // date that no longer fits the counter (emptied again later) is replaced by an estimate
      const hs = this._model.sludge || []; let tReset = null;
      for (let i = 1; i < hs.length; i++) { const a = parseFloat(hs[i - 1].v), b = parseFloat(hs[i].v); if (isFinite(a) && isFinite(b) && b < a - 3 && hs[i].t <= now) tReset = hs[i].t; }
      if (tReset !== null && (days === null || (now - tReset) / 86400e3 < days)) days = Math.max(0, (now - tReset) / 86400e3);
      const perDay = (this._model.stats || {}).perDay;
      if (perDay > 0.2) {
        const e = sr.n / perDay; c.sludgeToRem = Math.max(0, (sr.m - sr.n) / perDay);
        if (days === null || days > e * 2 + 30) { days = e; est = true; }
      }
      c.sludgeMM = 60 + 300 * Math.min(1, sr.n / sr.m);
    } else if (days !== null) c.sludgeMM = 60 + 300 * Math.min(1, days / 365);
    if (days !== null) {
      c.sludgeDays = Math.round(days); c.sludgeEst = est;
      c.sludgeText = ucFmt(est ? T.emptied_est : T.emptied, { n: Math.round(days) });
    }
    const ch = this._chem(); c.chemFrac = ch ? ch.frac : null; c.chemLiters = ch ? ch.liters : null;
    return c;
  }
  /* config value that is either a number or an entity id */
  _entNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/i.test(v)) {
      const st = this._hass && this._hass.states[v]; const n = st ? parseFloat(st.state) : NaN;
      return { val: isFinite(n) ? n : null, ent: v };
    }
    const n = parseFloat(v); return { val: isFinite(n) ? n : null, ent: null };
  }
  _batchAt() {
    const id = this._cfg.entities.batch_counter;
    const v = this._cursor === null ? (this._hass && this._hass.states[id] ? this._hass.states[id].state : null) : ucValAt(this._model.batch, this._cursor);
    const n = parseFloat(v); return isFinite(n) ? n : null;
  }
  /* Chemical left = amount set at the reference batch counter - 0.4 dl per batch since then */
  _chem() {
    const cfg = this._cfg;
    if (cfg.entities.chemical) {
      // v3: the Shelly script keeps the amount (0.04 l per dose); 0 = not set yet
      const id = cfg.entities.chemical;
      const v = this._cursor === null ? (this._hass && this._hass.states[id] ? this._hass.states[id].state : null) : ucValAt(this._model.chem, this._cursor);
      const liters = parseFloat(v); if (!isFinite(liters) || liters <= 0) return null;
      const dose = (+cfg.chemical_dose_dl || 0.4) / 10, cap = +cfg.chemical_capacity || 20;
      return { liters, frac: ucClamp(liters / cap, 0, 1), left: Math.floor(liters / dose + 1e-9), dose, cap };
    }
    const rc = this._entNum(cfg.chemical_refill_counter);
    const am = cfg.chemical_amount !== null && cfg.chemical_amount !== undefined && cfg.chemical_amount !== '' ? this._entNum(cfg.chemical_amount) : { val: +cfg.chemical_fill_liters || 15, ent: null };
    const bc = this._batchAt();
    if (!rc || rc.val === null || !am || am.val === null || bc === null) return null;
    const dose = (+cfg.chemical_dose_dl || 0.4) / 10, cap = +cfg.chemical_capacity || 20;
    const liters = Math.max(0, am.val - Math.max(0, bc - rc.val) * dose);
    return { liters, frac: ucClamp(liters / cap, 0, 1), left: Math.floor(liters / dose + 1e-9), dose, cap, bc };
  }
  _sludgeRem() {
    const sid = this._cfg.entities.sludge;
    if (sid) {
      const v = this._cursor === null ? (this._hass && this._hass.states[sid] ? this._hass.states[sid].state : null) : ucValAt(this._model.sludge, this._cursor);
      const n = parseFloat(v); if (!isFinite(n)) return null;
      return { n: Math.round(n), m: +this._cfg.sludge_reminder_batches || 800 };
    }
    const r = this._entNum(this._cfg.sludge_reset_counter); const bc = this._batchAt();
    if (!r || r.val === null || bc === null) return null;
    return { n: Math.max(0, Math.round(bc - r.val)), m: +this._cfg.sludge_reminder_batches || 800 };
  }
  /* Sludge counter of the Shelly script (v3): set to 0 after emptying */
  _openSludge() {
    const T = this.T; const ed = this.$('chemed'); this._edMode = 'sludge';
    ed.innerHTML = `<div class="row"><label for="sl-in">${T.sludge_now}</label><input id="sl-in" type="number" min="0" max="5000" step="1" value="0">
        <button class="pri" data-a="save">${T.chem_save}</button><button data-a="cancel">${T.chem_cancel}</button></div>
       <div class="note">${T.sludge_note}</div>`;
    ed.classList.add('open');
    const inp = ed.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
  }
  async _saveSludge() {
    const ed = this.$('chemed'); const inp = ed.querySelector('input'); if (!inp) return;
    const v = Math.round(parseFloat(String(inp.value).replace(',', '.'))); if (!isFinite(v) || v < 0) { inp.focus(); return; }
    try {
      await this._hass.callService('number', 'set_value', { entity_id: this._cfg.entities.sludge, value: v });
      ed.innerHTML = `<div class="note">${this.T.chem_saved}</div>`; setTimeout(() => this._closeChem(), 1500); this._lastChips = 0;
    } catch (e) { const n = ed.querySelector('.note'); if (n) n.textContent = String(e && e.message ? e.message : e); }
  }
  _openChem() {
    const T = this.T; const cfg = this._cfg; const ed = this.$('chemed'); this._edMode = 'chem';
    const am = this._entNum(cfg.chemical_amount), rc = this._entNum(cfg.chemical_refill_counter);
    const live = this._hass && this._hass.states[cfg.entities.batch_counter] ? Math.round(parseFloat(this._hass.states[cfg.entities.batch_counter].state)) : null;
    const ch = this._chem(); const cap = +cfg.chemical_capacity || 20;
    const can = !!cfg.entities.chemical || (am && am.ent && rc && rc.ent && live !== null && isFinite(live));
    const val = ch ? Math.round(ch.liters * 10) / 10 : (+cfg.chemical_fill_liters || 15);
    ed.innerHTML = can
      ? `<div class="row"><label for="chem-in">${T.chem_now}</label><input id="chem-in" type="number" min="0" max="${cap}" step="0.1" value="${Math.min(val, cap)}"> ${T.chem_l}
          <span class="cap">(${ucFmt(T.chem_full, { n: this._num(cap, 0) })})</span>
          <button class="pri" data-a="save">${T.chem_save}</button><button data-a="cancel">${T.chem_cancel}</button></div>
         <div class="note">${ucFmt(T.chem_cap, { n: this._num(cap, 0) })} ${cfg.entities.chemical ? T.chem_note3 : ucFmt(T.chem_note, { n: live, d: this._num(+cfg.chemical_dose_dl || 0.4, 1) })}</div>`
      : `<div class="note">${T.chem_need}</div><div class="row" style="margin-top:6px"><button data-a="cancel">${T.chem_cancel}</button></div>`;
    ed.classList.add('open');
    const inp = ed.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
  }
  _closeChem() { const ed = this.$('chemed'); ed.classList.remove('open'); ed.innerHTML = ''; }
  async _saveChem() {
    const cfg = this._cfg; const ed = this.$('chemed'); const inp = ed.querySelector('input'); if (!inp) return;
    let v = parseFloat(String(inp.value).replace(',', '.')); if (!isFinite(v) || v < 0) { inp.focus(); return; }
    v = Math.min(v, +cfg.chemical_capacity || 20);      // more than a full tank is a full tank
    if (cfg.entities.chemical) {
      try {
        await this._hass.callService('number', 'set_value', { entity_id: cfg.entities.chemical, value: Math.round(v * 10) / 10 });
        ed.innerHTML = `<div class="note">${this.T.chem_saved}</div>`; setTimeout(() => this._closeChem(), 1500); this._lastChips = 0;
      } catch (e) { ed.querySelector('.note').textContent = String(e && e.message ? e.message : e); }
      return;
    }
    const am = this._entNum(cfg.chemical_amount), rc = this._entNum(cfg.chemical_refill_counter);
    const live = Math.round(parseFloat(this._hass.states[cfg.entities.batch_counter].state));
    try {
      await this._hass.callService('input_number', 'set_value', { entity_id: am.ent, value: Math.round(v * 10) / 10 });
      await this._hass.callService('input_number', 'set_value', { entity_id: rc.ent, value: live });
      ed.innerHTML = `<div class="note">${this.T.chem_saved}</div>`; setTimeout(() => this._closeChem(), 1500);
      this._lastChips = 0;
    } catch (e) { ed.querySelector('.note').textContent = String(e && e.message ? e.message : e); }
  }

  _renderHead(S, now) {
    const T = this.T; const $ = this.$;
    const dp = S.dp || S.phase; const col = UC_PHASE_COLORS[dp] || '#ccc';
    $('st-dot').style.background = col;
    const sub = S.sub ? T.sub[S.sub] : (S.restart && S.phase === 'aeration' ? T.sub.restart : '');
    $('st-name').textContent = this._loaded ? (T.phase[dp] || dp) + (sub ? ` (${sub})` : '') : T.no_data;
    $('st-ctx').textContent = !this._loaded ? '' : S.holiday ? T.ctx.holiday : (S.phase === 'offline' ? '' : T.ctx[S.ctx]);
    $('st-ctx').style.color = S.holiday ? '#7a55cf' : '';
    const f = this._loaded && S.typical ? ucClamp(S.elapsed / S.typical, 0, 1) : 0;
    $('st-fill').style.width = (f * 100).toFixed(1) + '%'; $('st-fill').style.background = col;
    $('st-prog').textContent = this._loaded && S.typical ? ucFmt(T.phase_of, { a: Math.floor(S.elapsed / 60), b: Math.round(S.typical / 60) }) : '';
    $('st-eta').textContent = S.eta !== null && S.eta !== undefined ? `${T.eta} ${S.etaEst ? '≈ ' : ''}${S.eta >= 60 ? Math.round(S.eta / 60) + ' ' + T.minutes : S.eta + ' ' + T.seconds}` : '';
    const md = $('mode');
    if (this._cursor === null) { md.className = 'mode live'; md.textContent = '● ' + T.live; }
    else { const fm = new Intl.DateTimeFormat(this._locale, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); md.className = 'mode'; md.textContent = `${T.history} · ${fm.format(new Date(this._cursor))}`; }
    const wt = S.warning ? (T.warn[S.warnKey] || S.warning) : '';
    const b = $('banner'); b.style.display = wt ? 'block' : 'none'; if (wt && b.textContent !== wt) b.textContent = wt;
  }

  _num(v, d) { return Number(v).toLocaleString(this._locale, { minimumFractionDigits: d, maximumFractionDigits: d }); }

  _renderChips(S, now) {
    const T = this.T; const st = this._model.stats || {}; const cfg = this._cfg; const h = this._hass;
    const kv = []; const add = (k, v, cls) => kv.push(`<div><dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd></div>`);
    const bc = this._cursor === null ? (h && h.states[cfg.entities.batch_counter] ? h.states[cfg.entities.batch_counter].state : null) : ucValAt(this._model.batch, this._cursor);
    if (bc !== null && bc !== undefined) add(T.batches, bc);
    if (st.days) {
      const mx = Math.max(1, ...st.days.map((d) => d.n));
      const bars = st.days.map((d, i) => `<rect x="${i * 6}" y="${14 - (d.n / mx) * 12}" width="4.5" height="${Math.max(1, (d.n / mx) * 12)}" rx="1" fill="${i === 6 ? 'var(--uc-accent)' : 'var(--uc-muted)'}" opacity="${i === 6 ? 1 : .7}"><title>${new Date(d.t0).toLocaleDateString(this._locale)}: ${d.n}</title></rect>`).join('');
      add(T.week, `${st.count7}${st.perDay ? ' · ' + this._num(st.perDay, 1) + T.per_day : ''}<svg width="42" height="15" viewBox="0 0 42 15">${bars}</svg>`);
      if (st.perDay) add(T.wastewater, `≈ ${Math.round(st.perDay * cfg.batch_volume / 10) * 10} l${T.per_day}`);
    }
    if (st.lastBatch) { const fm = new Intl.DateTimeFormat(this._locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }); add(T.last_batch, fm.format(new Date(st.lastBatch.t))); }
    if (S.power !== null) add(T.power, `${this._num(S.power, 1)} W`);
    if (st.kwhDay) add(T.energy, `${this._num(st.kwhDay, 2)} kWh${T.per_day}`);
    add(T.level_est, `≈ ${Math.round(S.level * 100)} %`);
    const ch = this._chem();
    if (ch) kv.push(`<div class="act" data-act="chem" title="${T.chem_title} · ${ucFmt(T.chem_left, { n: ch.left })}"><dt>${T.chemical}</dt><dd class="${ch.frac < 0.1 ? 'warn' : ch.frac < 0.2 ? 'low' : ''}">≈ ${this._num(ch.liters, 1)} ${T.chem_l} · ${Math.round(ch.frac * 100)} %</dd></div>`);
    else if (cfg.entities.chemical || cfg.chemical_amount || cfg.chemical_refill_counter) kv.push(`<div class="act" data-act="chem"><dt>${T.chemical}</dt><dd>–</dd></div>`);
    const c = this._ctx(now); if (c.sludgeDays !== undefined) add(T.sludge_emptied_lbl, ucFmt(c.sludgeEst ? T.days_ago_est : T.days_ago, { n: c.sludgeDays }));
    if (c.sludgeRem) {
      const cls = c.sludgeDue ? 'warn' : c.sludgeRem.n > c.sludgeRem.m * 0.9 ? 'low' : '';
      const v = ucFmt(T.sludge_rem_v, { n: c.sludgeRem.n, m: c.sludgeRem.m });
      if (cfg.entities.sludge) {
        const tip = T.sludge_title + (c.sludgeToRem !== undefined ? ' · ' + ucFmt(T.sludge_to_rem, { n: Math.round(c.sludgeToRem) }) : '');
        kv.push(`<div class="act" data-act="sludge" title="${tip}"><dt>${T.sludge_rem}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd></div>`);
      } else add(T.sludge_rem, v, cls);
    }
    const html = kv.join('');
    if (html !== this._kvHtml) { this.$('kv').innerHTML = html; this._kvHtml = html; }
  }

  _renderChart() {
    const now = this._now(); const t0 = this._winStart(); const t1 = t0 + this._span();
    this._ensurePower(t0);
    const W = this.$('cw').clientWidth || 800;
    this._chart.render(this._model, t0, t1, W, this.T, this._locale);
    this._lastChart = this._anim || 1e-6;
    const T = this.T;
    const evIcon = (type) => { const st = UC_EV_STYLE[type]; return `<svg width="12" height="12" viewBox="-6 -6 12 12"><path d="${st.d(0, 0)}" fill="${st.hollow ? 'none' : st.c}" stroke="${st.c}" stroke-width="1.3"/></svg>`; };
    this.$('leg1').innerHTML = `<span><i style="background:#D6336C"></i>${T.legend_power}</span><span><i style="background:#2D8CE0"></i>${T.legend_level}</span>`;
    const seen = new Set(this._model.segs.filter((g) => g.t1 >= t0 && g.t0 <= t1).map((g) => g.dp));
    const order = ['filling', 'aeration', 'dosing', 'mixing', 'settling', 'waiting', 'sludge', 'discharge', 'offline', 'unknown'];
    let l2 = order.filter((p) => seen.has(p)).map((p) => `<span><span class="sq" style="background:${UC_PHASE_COLORS[p]}"></span>${T.phase[p]}</span>`).join('');
    if (this._model.holidays.some((h) => h.t1 >= t0 && h.t0 <= t1)) l2 += `<span><span class="sq" style="background:#8E6CD8"></span>${T.legend_holiday}</span>`;
    l2 += `<span style="margin-left:6px">${evIcon('start')}${T.ev_legend_start}</span><span>${evIcon('dose')}${T.ev_legend_dose}</span><span>${evIcon('batch')}${T.ev_legend_batch}</span>`;
    const inWin = (type) => this._model.events.some((e) => e.type === type && e.t >= t0 && e.t <= t1);
    if (inWin('restart')) l2 += `<span>${evIcon('restart')}${T.ev_legend_restart}</span>`;
    if (inWin('warning')) l2 += `<span>${evIcon('warning')}${T.ev_legend_warn}</span>`;
    this.$('leg2').innerHTML = l2;
  }

  _evText(e) {
    const T = this.T;
    const dur = (s) => s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`;
    switch (e.type) {
      case 'start': return e.waits ? ucFmt(T.ev_start, { d: dur(e.dur), n: e.waits }) : ucFmt(T.ev_start_short, { d: dur(e.dur) });
      case 'dose': return T.ev_dose; case 'discharge': return T.ev_discharge; case 'batch': return ucFmt(T.ev_batch, { n: e.n });
      case 'holiday_on': return T.ev_holiday_on; case 'holiday_off': return T.ev_holiday_off; case 'warning': return T.warn[e.key] || e.text;
      case 'offline': return T.ev_offline; case 'restart': return T.ev_restart; default: return e.type;
    }
  }
  _renderLog() {
    const T = this.T; const m = this._model; const now = this._now();
    const ev = m.events.filter((e) => e.t <= now && e.t >= now - 7 * 86400e3).slice().reverse();
    const wide = this.shadowRoot.querySelector('.uc').classList.contains('wide'); const n = wide ? 80 : (this._logOpen ? 40 : 5);
    const f = new Intl.DateTimeFormat(this._locale, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    const sel = this._cursor;
    let firstIdx = 0; if (sel !== null) { firstIdx = ev.findIndex((e) => e.t <= sel); }
    const html = ev.slice(0, n).map((e, i) => {
      const st = UC_EV_STYLE[e.type];
      return `<div class="ent${i === firstIdx ? ' first' : ''}" data-t="${e.t}"><svg width="12" height="12" viewBox="-6 -6 12 12"><path d="${st.d(0, 0)}" fill="${st.hollow ? 'none' : st.c}" stroke="${st.c}" stroke-width="1.3"/></svg>
        <div><div class="tm">${f.format(new Date(e.t))}</div><div>${this._evText(e)}</div></div></div>`;
    }).join('') || `<div class="empty">${this._loaded ? '–' : T.no_data}</div>`;
    if (html !== this._logHtml) { this.$('entries').innerHTML = html; this._logHtml = html; }
    this.$('logn').textContent = ucFmt(T.entries, { n: ev.length });
    const more = this.$('more'); more.style.display = !wide && ev.length > 5 ? '' : 'none'; more.textContent = this._logOpen ? T.show_less : T.show_more;
  }
}

if (!customElements.get('uponor-clean-card')) customElements.define('uponor-clean-card', UponorCleanCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'uponor-clean-card')) {
  window.customCards.push({ type: 'uponor-clean-card', name: 'Uponor Clean Card', description: 'Animated Uponor Clean I wastewater treatment plant with timeline (Shelly phase detection).', preview: false });
}
console.info(`%c UPONOR-CLEAN-CARD %c ${UC_VERSION} `, 'color:#fff;background:#2D8CE0;border-radius:3px 0 0 3px;padding:2px 4px', 'color:#2D8CE0;background:#e8f2fc;border-radius:0 3px 3px 0;padding:2px 4px');
})();
