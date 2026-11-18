/* @meta {"vc": {
"phase": {"type": "enum", "access": "rc", "config": {"name": "Phase", "options": ["unknown"]}},
"cycle": {"type": "enum", "access": "rc", "config": {"name": "Cycle", "options": ["unknown"]}},
"status": {"type": "text", "access": "rc", "config": {"name": "Status"}},
"warning": {"type": "enum", "access": "rc", "config": {"name": "Warning", "options": ["none"]}},
"next_pumpout": {"type": "text", "access": "rc", "config": {"name": "Next pump-out"}},
"batches": {"type": "number", "config": {"name": "Batches"}},
"chemical": {"type": "number", "config": {"name": "Chemical"}},
"sludge": {"type": "number", "config": {"name": "Sludge"}},
"plant": {"type": "group", "config": {"name": "Uponor Clean"}, "members": ["@phase", "@cycle", "@status", "@warning", "@next_pumpout", "@batches", "@chemical", "@sludge"]}
}} */

/*
 * Uponor Clean I - process monitoring for Shelly (version 3)
 *
 * Follows the control unit's firmware cycle from the power consumption alone:
 * cleaning, waiting, holiday and test cycles with their phases, the next
 * pump-out time, batches, chemical use and sludge. Works without Home
 * Assistant; the components above are created by the script itself.
 *
 * Requirements: Shelly with an em1 / pm1 power meter, firmware 2.2.0 or newer,
 * the device time zone set. The @meta block above must stay first and within
 * the first 1024 bytes of the file (the firmware reads no further); the full
 * component settings are applied with setConfig() at start.
 *
 * Persistent data lives in KVS (keys uc_*), so it survives code updates and
 * deleting the script. Settings can be overridden in KVS key "uc_cfg" (JSON).
 *
 * Engine rules (verified on the device): no recursion, small RPC responses,
 * at most 5 timers / 5 RPC calls, functions defined before they are called.
 */

let VERSION = "3.0.0";

// ------------------------------------------------------------------ settings
let CFG = {
    // power bands (W, normalized to 230 V)
    off_max: 2.0, idle_max: 10.0, valve_max: 24.0, dosing_max: 38.5, comp_max: 52.0, aer_max: 64.0,
    idle_power: 4.0, nominal_voltage: 230,
    debounce_s: 6,            // shorter levels are ignored: self-tests between phases, and
    valve_debounce_s: 10,     // intermediate readings while the compressor starts or stops
    dosing_debounce_s: 6,
    peak_max_s: 12,           // a boost (pump-in MV5 pulse) shorter than this is a peak
    tol_s: 90,                // tolerance when a duration is matched to a firmware time
    restart_aeration_s: 1860, // aeration longer than this after idle = new cleaning cycle
    pumpout_detect_s: 540,    // compressor without peaks this long = pump-out
    holiday_wait_detect_s: 1200,
    holiday_min_since_batch_s: 252000,
    pause_margin_s: 300,
    boot_window_s: 300, boot_aer_wait_s: 360,
    dose_l: 0.04, chem_warn_days: 10, default_doses_per_day: 2,
    sludge_limit: 800,
    emptying_hint: true, emptying_delta_w: 0.7, emptying_count: 3, emptying_min_sludge: 100,
    fault_high_w: 62.0, fault_high_s: 120, fault_off_s: 60, fault_signal_s: 600, fault_idle_s: 14400,
    legacy_kvs: true
};

// firmware times (s), control unit board A
let FW = {
    pre: 600, aer: 5400, chem: 90, dose: 10, mix: 120, sed1: 2700, sludge: 120, sed2: 900, out: 780, in_max: 1020,
    wait: 1080, w_sludge: 60, w_aer: 1800, w_in: 600, holiday_after: 256200,
    h_wait1: 3000, h_aer: 600, h_in: 600, h_wait2: 6000, h_sludge: 60
};
// seconds from the start of a phase to the start of the pump-out (incl. self-tests)
let ETA_FROM = { pre_aeration: 9950, aeration: 9350, chem_filling: 3940, dosing: 3850, mixing: 3840, sedimentation_1: 3720, sludge_removal: 1020, sedimentation_2: 900 };

let PHASES = ["unknown", "pre_aeration", "aeration", "chem_filling", "dosing", "mixing", "sedimentation_1", "sludge_removal", "sedimentation_2", "pump_out", "pump_in", "waiting", "off"];
let CYCLES = ["unknown", "cleaning", "waiting", "holiday", "test"];
let WARNINGS = ["none", "no_power", "air_leak", "no_signal", "compressor_idle", "outlet_blocked", "high_water", "paused", "chemical_low", "sludge_due", "sludge_emptied"];
let W_TITLE = {
    none: "OK", no_power: "No power to plant", air_leak: "High power, check air hoses", no_signal: "Power reading missing",
    compressor_idle: "Compressor not running", outlet_blocked: "Outlet blocked?", high_water: "High water",
    paused: "Process paused?", chemical_low: "Chemical low", sludge_due: "Sludge emptying due",
    sludge_emptied: "Sludge emptied? Set Sludge to 0"
};
let S_CODE = {
    cleaning: { pre_aeration: "S102", aeration: "S103", chem_filling: "S104", dosing: "S105", mixing: "S106", sedimentation_1: "S107", sludge_removal: "S108", sedimentation_2: "S109", pump_out: "S110", pump_in: "S112" },
    waiting: { waiting: "S201", sludge_removal: "S202", aeration: "S204", pump_in: "S205" }
};

let VC_CONFIG = {
    phase: { options: PHASES, default_value: "unknown", persisted: false, meta: { ui: { view: "label", titles: {
        unknown: "Unknown", pre_aeration: "Pre-aeration", aeration: "Aeration", chem_filling: "Chemical filling",
        dosing: "Dosing", mixing: "Mixing", sedimentation_1: "Sedimentation I", sludge_removal: "Sludge removal",
        sedimentation_2: "Sedimentation II", pump_out: "Pump-out", pump_in: "Pump-in", waiting: "Waiting", off: "No power" } } } },
    cycle: { options: CYCLES, default_value: "unknown", persisted: false, meta: { ui: { view: "label", titles: {
        unknown: "Unknown", cleaning: "Cleaning", waiting: "Waiting", holiday: "Holiday", test: "Test" } } } },
    status: { max_len: 255, default_value: "", persisted: false, meta: { ui: { view: "label" } } },
    warning: { options: WARNINGS, default_value: "none", persisted: false, meta: { ui: { view: "label", titles: W_TITLE } } },
    next_pumpout: { max_len: 32, default_value: "", persisted: false, meta: { ui: { view: "label" } } },
    batches: { min: 0, max: 999999, default_value: 0, persisted: true, meta: { ui: { view: "field", step: 1 } } },
    chemical: { min: 0, max: 30, default_value: 0, persisted: true, meta: { ui: { view: "field", unit: "l", step: 0.1 } } },
    sludge: { min: 0, max: 9999, default_value: 0, persisted: true, meta: { ui: { view: "field", step: 1 } } }
};
let ROLES = ["phase", "cycle", "status", "warning", "next_pumpout", "batches", "chemical", "sludge"];

// ------------------------------------------------------------------ state
let H = {};                      // component handles by role
let shown = {};                  // last value written to each component
let fieldWritten = { batches: null, chemical: null, sludge: null };

let st = {
    cyc: "unknown", ph: "unknown", phStart: 0, sub: "",      // sub: holiday waiting "w1" / "w2"
    etaUp: null, aerStart: null, afterPumpOut: false,
    pumpOutStart: null, pumpOutExact: false, pumpOutCounted: false,
    waitEntryUnix: null, holidayUnix: null, restart: null, restarted: false,
    resumeCheck: false, offSinceUnix: null, hold: null
};
// band tracking: stable level and its start, candidate level, mixing pulses in the current level
let bs = {
    stable: "UNKNOWN", since: 0, partial: false, cand: "UNKNOWN", candSince: 0, candStart: 0,
    peaks: 0, firstPeak: null, boostSince: null, boostStart: -100, boostEnd: -100, sumP: 0, nP: 0, lastAvg: null
};
let cnt = { batches: 0, lastBatchUnix: null, sludge: 0, sludgeReset: null, chem: null, chemDay: 0, doses: [] };
let base = { pin: null, elevated: 0, hintSince: null };
let warn = {};
let topWarning = "none";
let pw = { p: null, pn: null, u: null, lastSeenUp: null, comp: null, highSince: null, offSince: null, lastCompUp: null };
let lastStatusUp = -1000;
let lastNextIso = "";

// ------------------------------------------------------------------ helpers
function log(s) {
    print("[uc] " + s);
}

function upS() {
    return Shelly.getUptimeMs() / 1000;
}

function sysStatus() {
    return Shelly.getComponentStatus("sys");
}

function nowUnix() {
    let s = sysStatus();
    if (s && typeof s.unixtime === "number") return s.unixtime;
    return null;
}

function unixAt(tUp) {
    let n = nowUnix();
    if (n === null) return null;
    return Math.round(n - (upS() - tUp));
}

function upAt(unix) {
    let n = nowUnix();
    if (n === null || unix === null) return null;
    return upS() - (n - unix);
}

// a measured length matches a firmware time (an unknown length, -1, never matches)
function near(x, target) {
    return x >= 0 && Math.abs(x - target) <= CFG.tol_s;
}

function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

function localOffsetMin() {
    let s = sysStatus();
    if (!s || typeof s.unixtime !== "number" || typeof s.time !== "string") return null;
    let parts = s.time.split(":");
    let d = Number(parts[0]) * 60 + Number(parts[1]) - Math.floor((s.unixtime % 86400) / 60);
    if (d > 840) d -= 1440;
    if (d < -720) d += 1440;
    return Math.round(d / 15) * 15;
}

// local civil time parts for a unix time: [y, m, d, hh, mm, ss, offsetMin]
function civil(unix) {
    let off = localOffsetMin();
    if (off === null || unix === null) return null;
    let t = Math.floor(unix) + off * 60;
    let days = Math.floor(t / 86400);
    let secs = t - days * 86400;
    let z = days + 719468;
    let era = Math.floor(z / 146097);
    let doe = z - era * 146097;
    let yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    let mp = Math.floor((5 * doy + 2) / 153);
    let d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    let m = mp < 10 ? mp + 3 : mp - 9;
    if (m <= 2) y += 1;
    return [y, m, d, Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60, off];
}

function isoLocal(unix) {
    let c = civil(unix);
    if (!c) return "";
    let ao = Math.abs(c[6]);
    return c[0] + "-" + pad2(c[1]) + "-" + pad2(c[2]) + "T" + pad2(c[3]) + ":" + pad2(c[4]) + ":" + pad2(c[5]) +
        (c[6] < 0 ? "-" : "+") + pad2(Math.floor(ao / 60)) + ":" + pad2(ao % 60);
}

function hhmm(unix) {
    let c = civil(unix);
    return c ? pad2(c[3]) + ":" + pad2(c[4]) : "";
}

function dateTime(unix) {
    let c = civil(unix);
    return c ? c[0] + "-" + pad2(c[1]) + "-" + pad2(c[2]) + " " + pad2(c[3]) + ":" + pad2(c[4]) : "";
}

function localDay(unix) {
    let off = localOffsetMin();
    if (off === null || unix === null) return null;
    return Math.floor((unix + off * 60) / 86400);
}

function durText(s) {
    let m = Math.max(0, Math.round(s / 60));
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h " + (m % 60) + " min";
}

function emit(type, data) {
    data.v = 1;
    data.type = type;
    data.ts = nowUnix();
    Shelly.emitEvent("uponor", data);
}

// ------------------------------------------------------------------ KVS (one write at a time, latest value wins)
let kvsPending = {};
let kvsOrder = [];
let kvsBusy = false;

function kvsPump() {
    let k = null;
    let v = null;
    while (!kvsBusy && kvsOrder.length > 0 && v === null) {
        k = kvsOrder.shift();
        v = kvsPending[k];
        kvsPending[k] = null;
        if (v === undefined) v = null;
    }
    if (v === null) return;
    kvsBusy = true;
    Shelly.call("KVS.Set", { key: k, value: v }, function (res, err, msg) {
        kvsBusy = false;
        if (err) log("KVS.Set " + k + " failed: " + err + " " + msg);
        kvsPump();
    });
}

function kvsSave(key, value) {
    let s = typeof value === "string" ? value : JSON.stringify(value);
    if (kvsPending[key] === null || kvsPending[key] === undefined) kvsOrder.push(key);
    kvsPending[key] = s;
    kvsPump();
}

function saveBatch() {
    kvsSave("uc_batch", { n: cnt.batches, ts: cnt.lastBatchUnix });
    if (CFG.legacy_kvs) {
        kvsSave("puhdistamo_batch_count", JSON.stringify(cnt.batches));
        let c = civil(cnt.lastBatchUnix);
        if (c) {
            kvsSave("puhdistamo_process_message", JSON.stringify("Last: " + pad2(c[2]) + "." + pad2(c[1]) + "." + c[0] + " " +
                pad2(c[3]) + ":" + pad2(c[4]) + ":" + pad2(c[5])));
        }
    }
}

function saveChem() {
    kvsSave("uc_chem", { l: cnt.chem, day: cnt.chemDay, d: cnt.doses });
}

function saveSludge() {
    kvsSave("uc_sludge", { n: cnt.sludge, reset: cnt.sludgeReset });
}

function saveBase() {
    if (base.pin !== null) kvsSave("uc_base", { pin: Math.round(base.pin * 100) / 100 });
}

function saveCycle() {
    kvsSave("uc_cycle", { c: st.cyc, p: st.ph, s: st.sub, ps: unixAt(st.phStart), we: st.waitEntryUnix, hd: st.holidayUnix });
}

// ------------------------------------------------------------------ outputs
function setVc(role, v) {
    if (!H[role] || shown[role] === v) return;
    shown[role] = v;
    H[role].setValue(v);
}

function setField(role, v) {
    fieldWritten[role] = v;
    shown[role] = v;
    if (H[role]) H[role].setValue(v);
}

function etaUnix() {
    if (st.etaUp === null) return null;
    return unixAt(st.etaUp);
}

function phaseCode() {
    let t = S_CODE[st.cyc];
    return t && t[st.ph] ? t[st.ph] : "";
}

function statusText() {
    let now = upS();
    let synced = nowUnix() !== null;
    let last = cnt.lastBatchUnix ? dateTime(cnt.lastBatchUnix) : "unknown";
    let s;
    if (st.ph === "off") s = "No power" + (st.offSinceUnix ? " since " + hhmm(st.offSinceUnix) : "");
    else if (st.restart) s = "Starting after power cut";
    else if (st.ph === "unknown") s = "Synchronising";
    else if (st.cyc === "test") s = "Test cycle";
    else if (st.ph === "pump_out") s = "Pumping out" + (synced ? ", ends " + hhmm(unixAt(st.pumpOutStart + FW.out)) : "");
    else if (st.etaUp !== null) {
        let left = st.etaUp - now;
        s = (st.restarted ? "Restarted after power cut | " : "") +
            (synced ? "Pump-out at " + hhmm(etaUnix()) + " (in " + durText(left) + ")" : "Pump-out in " + durText(left));
    }
    else if (st.ph === "pump_in") s = "Pumping in | last pump-out " + last;
    else if (st.cyc === "holiday") s = "Holiday mode" + (st.holidayUnix ? " since " + dateTime(st.holidayUnix) : "") + " | last pump-out " + last;
    else if (st.cyc === "waiting") s = "Waiting for wastewater | last pump-out " + last;
    else s = "Last pump-out " + last;
    if (topWarning !== "none") s += " | " + W_TITLE[topWarning];
    return s;
}

function refreshOutputs(force) {
    let now = upS();
    if (force || now - lastStatusUp >= 60) {
        lastStatusUp = now;
        setVc("status", statusText());
    }
    let e = etaUnix();
    let iso = e === null ? "" : isoLocal(e);
    if (iso !== lastNextIso) {
        lastNextIso = iso;
        setVc("next_pumpout", iso);
    }
}

function setPhase(cyc, ph, startUp) {
    if (cyc === st.cyc && ph === st.ph) return;
    st.cyc = cyc;
    st.ph = ph;
    st.phStart = startUp;
    if (ph !== "pump_out") st.afterPumpOut = false;
    setVc("phase", ph);
    setVc("cycle", cyc);
    emit("phase", { cycle: cyc, phase: ph, code: phaseCode(), eta: etaUnix() });
    saveCycle();
    refreshOutputs(true);
}

function anchorEta(ph, startUp) {
    st.etaUp = ETA_FROM[ph] !== undefined ? startUp + ETA_FROM[ph] : null;
}

// ------------------------------------------------------------------ warnings
function setWarning(key, on) {
    on = !!on;
    if (!!warn[key] === on) return;
    warn[key] = on;
    emit("warning", { key: key, on: on });
    let top = "none";
    for (let i = 1; i < WARNINGS.length; i++) {
        if (warn[WARNINGS[i]]) {
            top = WARNINGS[i];
            break;
        }
    }
    if (top !== topWarning) {
        topWarning = top;
        setVc("warning", top);
        refreshOutputs(true);
    }
}

function dosesPerDay() {
    let sum = 0;
    let n = 0;
    for (let i = 1; i < cnt.doses.length; i++) {
        sum += cnt.doses[i];
        n++;
    }
    if (n < 3) return CFG.default_doses_per_day;
    return Math.max(0.2, sum / n);
}

function chemDaysLeft() {
    if (cnt.chem === null) return null;
    return cnt.chem / (CFG.dose_l * dosesPerDay());
}

function checkCounters() {
    let d = chemDaysLeft();
    setWarning("chemical_low", d !== null && d < CFG.chem_warn_days);
    setWarning("sludge_due", CFG.sludge_limit > 0 && cnt.sludge >= CFG.sludge_limit);
    if (base.hintSince !== null && (cnt.sludge < CFG.emptying_min_sludge || upS() - base.hintSince > 259200)) {
        base.hintSince = null;
        setWarning("sludge_emptied", false);
    }
}

// ------------------------------------------------------------------ counters
function rollChemDay() {
    let day = localDay(nowUnix());
    if (day === null) return;
    if (cnt.chemDay === 0) cnt.chemDay = day;
    let shift = day - cnt.chemDay;
    if (shift <= 0) return;
    if (shift > 14) shift = 14;
    for (let i = 0; i < shift; i++) {
        cnt.doses.unshift(0);
        if (cnt.doses.length > 14) cnt.doses.pop();
    }
    cnt.chemDay = day;
    saveChem();
}

function onDose() {
    rollChemDay();
    if (cnt.doses.length === 0) cnt.doses.push(0);
    cnt.doses[0]++;
    if (cnt.chem !== null) {
        cnt.chem = Math.max(0, Math.round((cnt.chem - CFG.dose_l) * 100) / 100);
        setField("chemical", cnt.chem);
    }
    saveChem();
    emit("chemical", { l: cnt.chem, days: chemDaysLeft() });
    checkCounters();
}

function countBatch(tUp) {
    cnt.batches++;
    cnt.sludge++;
    cnt.lastBatchUnix = unixAt(tUp);
    setField("batches", cnt.batches);
    setField("sludge", cnt.sludge);
    saveBatch();
    saveSludge();
    emit("batch", { n: cnt.batches, ts: cnt.lastBatchUnix });
    emit("sludge", { n: cnt.sludge, reset: cnt.sludgeReset });
    checkCounters();
    log("batch " + cnt.batches);
}

// Sludge emptying hint: after the sludge is emptied the pump-in power of the waiting and
// holiday cycles rises about 1 W above its baseline (seen in Sept 2026). The new level then
// becomes the baseline.
function pumpInSample(avgW) {
    if (!CFG.emptying_hint || avgW === null) return;
    log("pump-in " + Math.round(avgW * 10) / 10 + " W, baseline " + (base.pin === null ? "-" : Math.round(base.pin * 10) / 10));
    if (base.pin === null) {
        base.pin = avgW;
        return;
    }
    if (avgW >= base.pin + CFG.emptying_delta_w) {
        base.elevated++;
        if (base.elevated >= CFG.emptying_count) {
            if (cnt.sludge >= CFG.emptying_min_sludge && base.hintSince === null) {
                base.hintSince = upS();
                setWarning("sludge_emptied", true);
            }
            base.pin = avgW;
            base.elevated = 0;
            saveBase();
        }
    } else {
        base.elevated = 0;
        base.pin = base.pin * 0.9 + avgW * 0.1;
    }
}

// ------------------------------------------------------------------ firmware mirror
// The handlers below get the band that ended (from), its length in seconds (dur, -1 when
// it was seen only partly after the script started), the mixing pulses seen in it (peaks)
// and the start time of the new band (t, uptime seconds).

function startCleaning(tUp, reason) {
    st.aerStart = tUp;
    st.afterPumpOut = false;
    st.restarted = false;
    anchorEta("pre_aeration", tUp);
    setWarning("outlet_blocked", false);
    setWarning("high_water", false);
    setPhase("cleaning", "pre_aeration", tUp);
    log("cleaning cycle (" + reason + ")");
}

// newEntry: the waiting cycle starts now (the holiday timer starts), otherwise the next waiting loop
function enterWaiting(tUp, newEntry) {
    if (newEntry) st.waitEntryUnix = unixAt(tUp);
    st.etaUp = null;
    st.restarted = false;
    st.sub = "";
    setWarning("high_water", false);
    setPhase("waiting", "waiting", tUp);
}

// firmware: the holiday check is made after each waiting-cycle pump-in
function holidayDue(tUp) {
    let e = unixAt(tUp);
    return e !== null && st.waitEntryUnix !== null && e - st.waitEntryUnix >= FW.holiday_after - 60;
}

// a long wait has been seen: is it plausible that the holiday cycle has started?
function holidayPossible() {
    let n = nowUnix();
    if (n !== null && st.waitEntryUnix !== null) return n - st.waitEntryUnix >= FW.holiday_after - 3600;
    if (n !== null && cnt.lastBatchUnix !== null) return n - cnt.lastBatchUnix >= CFG.holiday_min_since_batch_s;
    return cnt.lastBatchUnix === null;
}

// sub: "w1" = Waiting I (ends with aeration), "w2" = Waiting II (ends with sludge removal), "" = not known
function enterHoliday(sub, tUp) {
    if (st.cyc !== "holiday") st.holidayUnix = unixAt(tUp);
    st.sub = sub;
    st.etaUp = null;
    st.cyc = "holiday";
    st.ph = "";
    setPhase("holiday", "waiting", tUp);
}

function holidayStep(ph, tUp, sinceUp) {
    if (st.cyc !== "holiday") st.holidayUnix = unixAt(sinceUp);
    st.sub = "";
    st.etaUp = null;
    setPhase("holiday", ph, tUp);
}

function chemFilling(tUp, hw, blocked) {
    if (hw) setWarning("high_water", true);
    if (blocked) setWarning("outlet_blocked", true);
    st.afterPumpOut = false;
    anchorEta("chem_filling", tUp);
    setPhase("cleaning", "chem_filling", tUp);
}

function cleaningStep(ph, tUp) {
    anchorEta(ph, tUp);
    setPhase("cleaning", ph, tUp);
}

function pumpOutStarts(tUp, exact) {
    st.pumpOutStart = tUp;
    st.pumpOutExact = exact;
    st.pumpOutCounted = false;
    st.etaUp = null;
    setPhase("cleaning", "pump_out", tUp);
}

// batch at the end of the pump-out (780 s from its start), counted once
function finishPumpOut(dur) {
    if (st.pumpOutStart === null || st.pumpOutCounted) return;
    if (dur >= 0 && dur < FW.out - 80) return;
    st.pumpOutCounted = true;
    countBatch(st.pumpOutStart + FW.out);
}

function pumpInEnded() {
    if (st.cyc === "waiting" || st.cyc === "holiday") pumpInSample(bs.lastAvg);
}

function unknownPhase(tUp, why) {
    st.etaUp = null;
    st.sub = "";
    st.afterPumpOut = false;
    setPhase("unknown", "unknown", tUp);
    if (why) log("sync lost: " + why);
}

function isWait() {
    return st.ph === "waiting" && (st.cyc === "waiting" || st.cyc === "holiday");
}

// The process stopped in the middle of a phase (a stop from the radio panel). The phase is
// kept aside and continued, shifted by the length of the stop, when the same level returns.
function holdPhase(t, why) {
    st.hold = { cyc: st.cyc, ph: st.ph, sub: st.sub, at: t, ps: st.phStart, eta: st.etaUp, aer: st.aerStart, po: st.pumpOutStart };
    unknownPhase(t, why);
}

function resumeHeld(to, t) {
    let h = st.hold;
    st.hold = null;
    if (!h || to !== bandOfPhase(h.ph) || t - h.at > 3 * 3600) return false;
    let d = t - h.at;
    st.etaUp = h.eta === null ? null : h.eta + d;
    st.aerStart = h.aer === null ? null : h.aer + d;
    if (h.po !== null) st.pumpOutStart = h.po + d;
    st.sub = h.sub;
    setPhase(h.cyc, h.ph, h.ps + d);
    log("continued after a stop of " + Math.round(d) + " s");
    return true;
}

function toIdle(from, dur, peaks, t) {
    let short = dur >= 0;      // a level that ended before its firmware time: stopped
    if (from === "AER") {
        if (st.ph === "mixing" && !(short && dur < 90)) cleaningStep("sedimentation_1", t);
        else if (st.ph === "unknown" && near(dur, FW.mix)) cleaningStep("sedimentation_1", t);
        else if (st.cyc === "test") enterWaiting(t, true);
        else if (st.ph === "pre_aeration" || st.ph === "aeration" || st.ph === "mixing") holdPhase(t, "aeration stopped");
        else unknownPhase(t, "aeration stopped");
        return;
    }
    if (from !== "COMP") {
        unknownPhase(t, from + " ended to idle");
        return;
    }
    if (st.ph === "sludge_removal" && st.cyc === "cleaning") {
        if (short && dur < 90) holdPhase(t, "sludge removal stopped");
        else cleaningStep("sedimentation_2", t);
    } else if (st.ph === "pump_out") {
        if (short && dur < FW.out - 80) holdPhase(t, "pump-out stopped");
        else {
            finishPumpOut(dur);
            st.afterPumpOut = true;         // pump-in or a new chemical filling follows
        }
    } else if (st.ph === "pump_in") {
        if (short && dur < (st.cyc === "cleaning" ? FW.in_max : FW.w_in) - 60) {
            holdPhase(t, "pump-in stopped");
            return;
        }
        pumpInEnded();
        if (st.cyc === "holiday") enterHoliday("w2", t);
        else if (st.cyc === "waiting") {
            if (holidayDue(t)) enterHoliday("w1", t);
            else enterWaiting(t, false);
        }
        // cleaning-cycle pump-in runs up to 1020 s, waiting and holiday pump-ins 600 s
        else enterWaiting(t, st.cyc === "cleaning" || near(dur, FW.in_max));
    } else if (st.ph === "sludge_removal") enterHoliday("w1", t);   // a wait after sludge removal: holiday cycle
    else if (st.ph === "unknown" && peaks === 0 && dur > 90 && near(dur, FW.sludge)) cleaningStep("sedimentation_2", t);
    else if (st.ph === "unknown" && peaks === 0 && near(dur, FW.h_sludge)) enterHoliday("w1", t);
    else unknownPhase(t, "");
}

function toComp(from, dur, peaks, t) {
    if (from === "IDLE") {
        let w = isWait();
        if (st.ph === "sedimentation_1") cleaningStep("sludge_removal", t);
        else if (st.ph === "sedimentation_2") pumpOutStarts(t, true);
        else if (st.afterPumpOut) {
            st.afterPumpOut = false;
            setPhase("cleaning", "pump_in", t);
        } else if (w && near(dur, FW.wait)) setPhase("waiting", "sludge_removal", t);
        else if (w && (st.sub === "w2" || near(dur, FW.h_wait2))) holidayStep("sludge_removal", t, t);
        else if (w && st.cyc === "waiting") setPhase("waiting", "sludge_removal", t);
        else if (w) holidayStep("sludge_removal", t, t);
        else if (near(dur, FW.sed1)) cleaningStep("sludge_removal", t);
        else if (near(dur, FW.sed2)) pumpOutStarts(t, true);
        else if (near(dur, FW.wait)) setPhase("waiting", "sludge_removal", t);
        else if (near(dur, FW.h_wait2)) holidayStep("sludge_removal", t, t);
        else unknownPhase(t, "");
        return;
    }
    if (from === "AER") {
        if ((st.cyc === "waiting" || st.cyc === "holiday") && st.ph === "aeration") setPhase(st.cyc, "pump_in", t);
        else if (near(dur, FW.w_aer)) {
            st.etaUp = null;
            setPhase("waiting", "pump_in", t);
        } else if (near(dur, FW.h_aer) && st.ph !== "pre_aeration") holidayStep("pump_in", t, t);
        else unknownPhase(t, "aeration ended to compressor");
        return;
    }
    unknownPhase(t, from + " ended to compressor");
}

function toAer(from, dur, peaks, t) {
    if (from === "COMP") {
        if (st.ph === "pump_out" || st.ph === "pump_in" || (st.ph === "unknown" && peaks > 0)) {
            // start-up level reached during the pump-in: new cleaning cycle
            if (st.ph === "pump_out") finishPumpOut(dur);
            else pumpInEnded();
            startCleaning(t, "start level reached");
        } else if (st.ph === "sludge_removal" && st.cyc !== "cleaning") setPhase("waiting", "aeration", t);
        else if (st.ph === "unknown" && near(dur, FW.w_sludge)) setPhase("waiting", "aeration", t);
        else if (st.ph === "unknown" && dur >= 100) startCleaning(t, "start level reached");
        else unknownPhase(t, "compressor ended to aeration");
        return;
    }
    if (from === "DOSING" || (from === "VALVE" && st.ph === "chem_filling")) {
        if (from === "VALVE") onDose();     // the dosing level was too short to be seen
        if (st.cyc === "test") setPhase("test", "aeration", t);
        else cleaningStep("mixing", t);
        return;
    }
    if (from === "IDLE") {
        let w = isWait();
        if (st.afterPumpOut) startCleaning(t, "start level reached");
        else if (w && st.cyc === "holiday" && st.sub !== "w2") holidayStep("aeration", t, t);
        else if (w && (st.cyc === "holiday" || dur >= CFG.holiday_wait_detect_s)) holidayStep("aeration", t, t - dur);
        else if (near(dur, FW.h_wait1)) holidayStep("aeration", t, t - dur);
        else unknownPhase(t, "");
        return;
    }
    unknownPhase(t, from + " ended to aeration");
}

function toValve(from, dur, peaks, t) {
    // test cycle: three short compressor steps (45 s) before the chemical filling
    if (from === "COMP" && dur >= 30 && dur <= 52 && st.ph !== "pump_out") {
        st.etaUp = null;
        st.afterPumpOut = false;
        setPhase("test", "chem_filling", t);
        return;
    }
    if (from === "AER") {
        let hw = false;
        if (st.cyc === "cleaning" && (st.ph === "pre_aeration" || st.ph === "aeration")) {
            hw = st.aerStart !== null && t - st.aerStart < FW.pre + FW.aer - 300;
        } else if (st.ph === "aeration") hw = true;          // waiting or holiday aeration cut by high water
        else if (st.ph === "unknown") hw = dur >= 0 && dur < FW.pre + FW.aer - 300;
        chemFilling(t, hw, false);
        return;
    }
    if (from === "COMP") {
        if (st.ph === "pump_out") {
            // start-up level still on after the pump-out: outlet blocked, new dosing round
            finishPumpOut(dur);
            chemFilling(t, false, true);
        } else if (st.ph === "pump_in") {
            pumpInEnded();
            chemFilling(t, true, false);                     // start level and high water: no aeration
        } else if (st.ph === "sludge_removal" && st.cyc !== "cleaning") chemFilling(t, true, false);
        else if (st.ph === "unknown" && near(dur, FW.w_sludge)) chemFilling(t, true, false);
        else chemFilling(t, false, false);
        return;
    }
    if (from === "IDLE") {
        if (st.afterPumpOut) chemFilling(t, false, true);
        else chemFilling(t, st.ph === "waiting", false);
        return;
    }
    chemFilling(t, false, false);
}

function toDosing(from, dur, peaks, t) {
    if (st.cyc === "test") setPhase("test", "dosing", t);
    else cleaningStep("dosing", t);
}

// after a power cut the control unit always starts a new cleaning cycle
function restartTransition(to, t) {
    if (t - st.restart.since > CFG.boot_aer_wait_s) {
        st.restart = null;
        return false;
    }
    if (to === "IDLE") return true;      // the control unit is still starting (radio panel)
    let reason = st.restart.reason;
    st.restart = null;
    if (to === "AER") startCleaning(t, reason);
    else if (to === "VALVE") chemFilling(t, true, false);
    else return false;
    st.restarted = true;
    refreshOutputs(true);
    return true;
}

function onTransition(from, to, dur, peaks, t) {
    if (from === "DOSING" && (dur < 0 || dur >= 5)) onDose();
    if (to === "OFF") {
        st.offSinceUnix = unixAt(t);
        st.etaUp = null;
        st.afterPumpOut = false;
        setPhase(st.cyc, "off", t);
        return;
    }
    if (from === "OFF") {
        st.offSinceUnix = null;
        st.hold = null;
        st.restart = { since: t, reason: "power_cut" };
        emit("start", { reason: "power_cut", version: VERSION });
        unknownPhase(t, "");
    }
    if (st.restart && restartTransition(to, t)) return;
    if (st.hold && from === "IDLE" && resumeHeld(to, t)) return;
    st.hold = null;
    if (to === "IDLE") toIdle(from, dur, peaks, t);
    else if (to === "COMP") toComp(from, dur, peaks, t);
    else if (to === "AER") toAer(from, dur, peaks, t);
    else if (to === "VALVE") toValve(from, dur, peaks, t);
    else if (to === "DOSING") toDosing(from, dur, peaks, t);
}

function bandOfPhase(ph) {
    if (ph === "pre_aeration" || ph === "aeration" || ph === "mixing") return "AER";
    if (ph === "chem_filling") return "VALVE";
    if (ph === "dosing") return "DOSING";
    if (ph === "sludge_removal" || ph === "pump_out" || ph === "pump_in") return "COMP";
    if (ph === "off") return "OFF";
    return "IDLE";
}

// ------------------------------------------------------------------ power input
function readPower() {
    let s = null;
    if (pw.comp === null) {
        let keys = ["em1:0", "pm1:0", "switch:0"];
        for (let i = 0; i < keys.length; i++) {
            s = Shelly.getComponentStatus(keys[i]);
            if (s && (typeof s.act_power === "number" || typeof s.apower === "number")) {
                pw.comp = keys[i];
                log("power meter " + pw.comp);
                break;
            }
        }
        if (pw.comp === null) return false;
    } else s = Shelly.getComponentStatus(pw.comp);
    if (!s) return false;
    let p = typeof s.act_power === "number" ? s.act_power : s.apower;
    if (typeof p !== "number") return false;
    pw.p = p;
    pw.u = typeof s.voltage === "number" && s.voltage > 50 ? s.voltage : CFG.nominal_voltage;
    let pn = p;
    if (p > CFG.idle_max) {
        let r = CFG.nominal_voltage / pw.u;
        pn = (p - CFG.idle_power) * r * r + CFG.idle_power;
    }
    pw.pn = Math.round(pn * 10) / 10;
    pw.lastSeenUp = upS();
    return true;
}

function classify(pn) {
    if (pn < CFG.off_max) return "OFF";
    if (pn < CFG.idle_max) return "IDLE";
    if (pn <= CFG.valve_max) return "VALVE";
    if (pn <= CFG.dosing_max) return "DOSING";
    if (pn <= CFG.comp_max) return "COMP";
    if (pn <= CFG.aer_max) return "AER";
    return "BOOST";
}

// Levels shorter than debounce_s (the self-test between phases) are ignored. A boost shorter
// than peak_max_s is a mixing pulse of the pump-in; a longer one is aeration.
function updateBand(t) {
    let b = classify(pw.pn);
    // above the compressor level: a pulse if it ends within peak_max_s, otherwise aeration
    if (b === "BOOST" || (b === "AER" && bs.stable === "COMP")) {
        if (bs.boostSince === null) bs.boostSince = t;
        if (t - bs.boostSince < CFG.peak_max_s) return;
        b = "AER";
        if (bs.cand !== "AER") {
            bs.cand = "AER";
            bs.candSince = bs.boostSince;
            bs.candStart = bs.boostSince;
        }
    } else if (bs.boostSince !== null) {
        if (t - bs.boostSince < CFG.peak_max_s) {
            if (bs.stable === "COMP") {
                bs.peaks++;
                if (bs.firstPeak === null) bs.firstPeak = bs.boostSince;
            }
            bs.boostStart = bs.boostSince;
            bs.boostEnd = t;
        }
        bs.boostSince = null;
    }
    if (b === "COMP") {
        bs.sumP += pw.pn;
        bs.nP++;
    }
    if (b !== bs.cand) {
        // a short intermediate level between two other levels (the compressor starting or
        // stopping): the change is dated to its start
        let ramp = bs.cand !== bs.stable && b !== bs.stable;
        bs.cand = b;
        bs.candSince = t;
        if (!ramp) bs.candStart = t;
    }
    let need = bs.cand === "VALVE" ? CFG.valve_debounce_s : (bs.cand === "DOSING" ? CFG.dosing_debounce_s : CFG.debounce_s);
    if (bs.cand === bs.stable || t - bs.candSince < need) return;
    let from = bs.stable;
    let start = bs.candStart;
    let peaks = bs.peaks;
    // a pulse just before the compressor level is the first mixing pulse of a pump-in
    let pulseFirst = bs.cand === "COMP" && start - bs.boostEnd <= 8;
    if (pulseFirst) start = Math.max(bs.since, bs.boostStart);
    let dur = (bs.partial || from === "UNKNOWN") ? -1 : start - bs.since;
    bs.stable = bs.cand;
    bs.since = start;
    bs.partial = false;
    bs.peaks = pulseFirst ? 1 : 0;
    bs.firstPeak = pulseFirst ? start : null;
    bs.lastAvg = bs.nP > 0 ? bs.sumP / bs.nP : null;     // mean compressor power of the level that ended
    bs.sumP = 0;
    bs.nP = 0;
    if (from === "UNKNOWN") firstBand(bs.stable, start);
    else onTransition(from, bs.stable, dur, peaks, start);
}

// the phase that follows each phase in the firmware sequence, and the phase lengths
let NEXT = {
    cleaning: { pre_aeration: "aeration", aeration: "chem_filling", chem_filling: "dosing", dosing: "mixing",
        mixing: "sedimentation_1", sedimentation_1: "sludge_removal", sludge_removal: "sedimentation_2",
        sedimentation_2: "pump_out", pump_out: "pump_in" },
    waiting: { waiting: "sludge_removal", sludge_removal: "aeration", aeration: "pump_in" },
    holiday: { aeration: "pump_in", sludge_removal: "waiting" }
};

function nextPhase(cyc, ph, sub) {
    if (cyc === "holiday" && ph === "waiting") return sub === "w2" ? "sludge_removal" : "aeration";
    return NEXT[cyc] ? NEXT[cyc][ph] : undefined;
}

function phaseDur(cyc, ph, sub) {
    if (ph === "sludge_removal") return cyc === "cleaning" ? FW.sludge : FW.w_sludge;
    if (ph === "aeration") return cyc === "cleaning" ? FW.aer : (cyc === "waiting" ? FW.w_aer : FW.h_aer);
    if (ph === "waiting") return cyc === "waiting" ? FW.wait : (sub === "w2" ? FW.h_wait2 : FW.h_wait1);
    if (ph === "pump_in") return cyc === "cleaning" ? FW.in_max : FW.w_in;
    return PHASE_MAX[ph];
}

// The script was stopped for a while (an update): the stored phase may have ended and the
// next one or two phases begun. Their start is estimated from the firmware times.
function resumeNext(b, t) {
    let ph = st.ph;
    let sub = st.sub;
    let ps = st.phStart;
    for (let i = 0; i < 2; i++) {
        let nx = nextPhase(st.cyc, ph, sub);
        if (!nx) return false;
        ps += phaseDur(st.cyc, ph, sub);
        if (st.cyc === "holiday" && ph === "sludge_removal") sub = "w1";
        else if (st.cyc === "holiday") sub = "";
        ph = nx;
        if (bandOfPhase(ph) === b) {
            if (ps > t + 60 || t - ps > phaseDur(st.cyc, ph, sub) + CFG.pause_margin_s) return false;
            if (st.ph === "pump_out") finishPumpOut(-1);
            if (st.cyc === "cleaning") anchorEta(ph, ps);
            if (ph === "pump_out") {
                st.pumpOutStart = ps;
                st.pumpOutExact = false;
                st.pumpOutCounted = false;
            }
            st.sub = sub;
            setPhase(st.cyc, ph, ps);
            log("resumed " + st.cyc + " / " + ph + " (next phase)");
            return true;
        }
    }
    return false;
}

// the first stable level after the script started
function firstBand(b, t) {
    bs.partial = true;
    if (st.restart) {
        if (b === "IDLE") return;
        if (b === "OFF") {
            st.restart = null;
            onTransition("IDLE", "OFF", -1, 0, t);
            return;
        }
        if (restartTransition(b, t)) return;
        st.restart = null;
    }
    if (st.resumeCheck) {
        st.resumeCheck = false;
        if (bandOfPhase(st.ph) === b) {
            bs.since = (b === "AER" && st.cyc === "cleaning" && st.aerStart !== null) ? st.aerStart : st.phStart;
            bs.partial = false;
            log("resumed " + st.cyc + " / " + st.ph);
            return;
        }
        if (resumeNext(b, t)) return;
        unknownPhase(t, "stored phase does not match the power");
    }
    if (b === "VALVE") chemFilling(t, false, false);
    else if (b === "DOSING") toDosing("UNKNOWN", -1, 0, t);
    else if (b === "OFF") onTransition("IDLE", "OFF", -1, 0, t);
}

// ------------------------------------------------------------------ periodic checks
function timeRules(t) {
    // pre-aeration turns into aeration after 600 s
    if (st.ph === "pre_aeration" && t - st.phStart >= FW.pre) setPhase("cleaning", "aeration", st.phStart + FW.pre);

    // unidentified compressor run: mixing pulses = pump-in, a long run without them = pump-out
    if (bs.stable === "COMP" && st.ph === "unknown") {
        if (bs.firstPeak !== null && bs.firstPeak - bs.since >= 130) {
            // a run without pulses before the first pulse: pump-out followed by pump-in
            pumpOutStarts(bs.partial ? bs.firstPeak - 1 - FW.out : bs.since, !bs.partial);
        } else if (bs.peaks > 0) setPhase(st.cyc, "pump_in", bs.since);
        else if (t - bs.since >= CFG.pumpout_detect_s) pumpOutStarts(bs.since, !bs.partial);
    }

    // batch at the end of the pump-out; the pump-in follows without a visible break
    if (bs.stable === "COMP" && st.ph === "pump_out" && st.pumpOutStart !== null) {
        let pulse = bs.firstPeak !== null ? bs.firstPeak - 1 : null;
        if (!st.pumpOutCounted && (t - st.pumpOutStart >= FW.out || pulse !== null)) {
            st.pumpOutCounted = true;
            countBatch(st.pumpOutExact || pulse === null ? st.pumpOutStart + FW.out : pulse);
        }
        if (st.pumpOutCounted && (pulse !== null || (bs.cand === "COMP" && t - st.pumpOutStart >= FW.out + 15))) {
            setPhase("cleaning", "pump_in", pulse !== null ? pulse : st.pumpOutStart + FW.out + 2);
            bs.sumP = 0;
            bs.nP = 0;
        }
    }

    // aeration longer than any waiting or holiday aeration = cleaning cycle (e.g. after an unseen power cut)
    if (bs.stable === "AER" && t - bs.since >= CFG.restart_aeration_s &&
        (st.ph === "unknown" || ((st.cyc === "waiting" || st.cyc === "holiday") && st.ph === "aeration"))) {
        if (bs.partial) {
            st.aerStart = null;
            st.etaUp = null;
            setPhase("cleaning", "aeration", bs.since);
        } else {
            startCleaning(bs.since, "long aeration");
            if (t - bs.since >= FW.pre) setPhase("cleaning", "aeration", bs.since + FW.pre);
        }
    }

    // a wait longer than the waiting-cycle wait: holiday cycle, or a stop from the radio panel
    let idleFor = bs.stable === "IDLE" ? t - bs.since : 0;
    if (st.cyc === "waiting" && st.ph === "waiting" && idleFor >= CFG.holiday_wait_detect_s && holidayPossible()) {
        enterHoliday(st.waitEntryUnix !== null ? "w1" : "", bs.since);
    }
    let expected = 0;
    if (st.ph === "sedimentation_1") expected = FW.sed1;
    else if (st.ph === "sedimentation_2") expected = FW.sed2;
    else if (st.ph === "waiting" && st.cyc === "waiting") expected = FW.wait;
    else if (st.ph === "waiting" && st.cyc === "holiday") expected = st.sub === "w1" ? FW.h_wait1 : FW.h_wait2;
    else if (st.ph === "unknown" && !st.restart) expected = FW.h_wait2;
    setWarning("paused", (expected > 0 && idleFor > expected + CFG.pause_margin_s) ||
        (st.hold !== null && idleFor > CFG.pause_margin_s));
    if (warn.paused) st.etaUp = null;

    // a stale estimate is dropped
    if (st.etaUp !== null && t > st.etaUp + 600 && st.ph !== "pump_out") st.etaUp = null;
}

function faultRules(t) {
    let pn = pw.pn;
    if (pn !== null && pn > CFG.fault_high_w) {
        if (pw.highSince === null) pw.highSince = t;
    } else pw.highSince = null;
    setWarning("air_leak", pw.highSince !== null && t - pw.highSince >= CFG.fault_high_s);
    if (pn !== null && pn < CFG.off_max) {
        if (pw.offSince === null) pw.offSince = t;
    } else pw.offSince = null;
    setWarning("no_power", pw.offSince !== null && t - pw.offSince >= CFG.fault_off_s);
    if (pw.lastCompUp === null || (pn !== null && pn > CFG.valve_max)) pw.lastCompUp = t;
    setWarning("compressor_idle", pn !== null && pw.offSince === null && t - pw.lastCompUp >= CFG.fault_idle_s);
    if (pw.lastSeenUp === null) pw.lastSeenUp = t;
    setWarning("no_signal", t - pw.lastSeenUp >= CFG.fault_signal_s);
}

let lastDayCheck = 0;

function tick() {
    let t = upS();
    if (readPower()) updateBand(t);
    faultRules(t);
    if (bs.stable !== "UNKNOWN") timeRules(t);
    if (t - lastDayCheck >= 600) {
        lastDayCheck = t;
        rollChemDay();
        checkCounters();
    }
    refreshOutputs(false);
}

// ------------------------------------------------------------------ user edits of the fields
function onFieldChange(role) {
    return function (ev) {
        let v = (ev && typeof ev.value === "number") ? ev.value : H[role].getValue();
        if (typeof v !== "number") return;
        if (fieldWritten[role] !== null && Math.abs(v - fieldWritten[role]) < 0.000001) return;
        fieldWritten[role] = v;
        shown[role] = v;
        if (role === "batches") {
            cnt.batches = Math.round(v);
            saveBatch();
            emit("batch", { n: cnt.batches, ts: cnt.lastBatchUnix, user: true });
        } else if (role === "chemical") {
            cnt.chem = Math.round(v * 100) / 100;
            saveChem();
            emit("chemical", { l: cnt.chem, days: chemDaysLeft(), user: true });
        } else if (role === "sludge") {
            if (v < cnt.sludge) cnt.sludgeReset = nowUnix();
            cnt.sludge = Math.round(v);
            if (cnt.sludge < CFG.emptying_min_sludge) base.elevated = 0;
            saveSludge();
            emit("sludge", { n: cnt.sludge, reset: cnt.sludgeReset, user: true });
        }
        log("user set " + role + " = " + v);
        checkCounters();
        refreshOutputs(true);
    };
}

// ------------------------------------------------------------------ state endpoint
function stateObject() {
    let w = [];
    for (let i = 1; i < WARNINGS.length; i++) if (warn[WARNINGS[i]]) w.push(WARNINGS[i]);
    let hd = null;
    if (st.cyc === "waiting" && st.waitEntryUnix !== null) hd = st.waitEntryUnix + FW.holiday_after;
    return {
        version: VERSION, cycle: st.cyc, phase: st.ph, code: phaseCode(), since: unixAt(st.phStart),
        eta: etaUnix(), last_pumpout: cnt.lastBatchUnix, batches: cnt.batches,
        chemical: { l: cnt.chem, days: chemDaysLeft() }, sludge: { n: cnt.sludge, reset: cnt.sludgeReset },
        warnings: w, holiday_at: hd, holiday_since: st.cyc === "holiday" ? st.holidayUnix : null,
        power: pw.pn, band: bs.stable, time_synced: nowUnix() !== null, uptime: Math.floor(upS())
    };
}

function registerEndpoint() {
    HTTPServer.registerEndpoint("state", function (req, res) {
        res.code = 200;
        res.headers = [["Content-Type", "application/json"]];
        res.body = JSON.stringify(stateObject());
        res.send();
    });
}

// ------------------------------------------------------------------ start
function initHandles() {
    for (let i = 0; i < ROLES.length; i++) {
        let r = ROLES[i];
        H[r] = Script.getVcHandle(r);
        if (!H[r]) {
            log("component " + r + " missing");
            continue;
        }
        H[r].setConfig(VC_CONFIG[r]);
    }
    VC_CONFIG = null;       // not needed after start (memory)
    let f = ["batches", "chemical", "sludge"];
    for (let j = 0; j < f.length; j++) if (H[f[j]]) H[f[j]].on("change", onFieldChange(f[j]));
}

function applyLoaded(key, v) {
    if (key === "uc_cfg" && v) {
        let ks = Object.keys(v);
        for (let i = 0; i < ks.length; i++) if (CFG[ks[i]] !== undefined) CFG[ks[i]] = v[ks[i]];
    } else if (key === "uc_batch" && v) {
        cnt.batches = v.n || 0;
        cnt.lastBatchUnix = v.ts || null;
    } else if (key === "puhdistamo_batch_count" && v !== null) {
        cnt.batches = Number(v) || 0;
    } else if (key === "puhdistamo_process_message" && typeof v === "string" && v.indexOf("Last: ") === 0) {
        let m = v.slice(6).split(" ");
        let d = m[0].split(".");
        let h = m[1] ? m[1].split(":") : ["0", "0", "0"];
        let off = localOffsetMin();
        if (d.length === 3 && off !== null) {
            let ms = Date.UTC(Number(d[2]), Number(d[1]) - 1, Number(d[0]), Number(h[0]), Number(h[1]), Number(h[2] || 0));
            cnt.lastBatchUnix = Math.round(ms / 1000) - off * 60;
        }
    } else if (key === "uc_chem" && v) {
        cnt.chem = typeof v.l === "number" ? v.l : null;
        cnt.chemDay = v.day || 0;
        cnt.doses = v.d || [];
    } else if (key === "uc_sludge" && v) {
        cnt.sludge = v.n || 0;
        cnt.sludgeReset = v.reset || null;
    } else if (key === "uc_base" && v) {
        base.pin = typeof v.pin === "number" ? v.pin : null;
    } else if (key === "uc_cycle" && v) {
        st.waitEntryUnix = v.we || null;
        st.holidayUnix = v.hd || null;
        // the stored phase is used only if it can still be running (script or Shelly restart)
        let ps = upAt(v.ps || null);
        let max = PHASE_MAX[v.p];
        let age = ps === null ? -1000 : upS() - ps;
        if (max !== undefined && age > -60 && age <= max + CFG.pause_margin_s) {
            st.cyc = v.c;
            st.ph = v.p;
            st.sub = v.s || "";
            st.phStart = ps;
            st.resumeCheck = true;
            if (st.cyc === "cleaning") anchorEta(st.ph, ps);
            if (st.ph === "pre_aeration") st.aerStart = ps;
            if (st.ph === "aeration") st.aerStart = ps - FW.pre;
            if (st.ph === "pump_out") {
                st.pumpOutStart = ps;
                st.pumpOutExact = true;
                st.pumpOutCounted = age >= FW.out;
            }
        }
    }
}

let PHASE_MAX = {
    pre_aeration: 600, aeration: 5400, chem_filling: 90, dosing: 10, mixing: 120, sedimentation_1: 2700,
    sludge_removal: 120, sedimentation_2: 900, pump_out: 780, pump_in: 1020, waiting: 6000
};

let LOAD = ["uc_cfg", "uc_batch", "uc_chem", "uc_sludge", "uc_base", "uc_cycle"];

function loadNext(i) {
    if (i >= LOAD.length) {
        finishStart();
        return;
    }
    let key = LOAD[i];
    Shelly.call("KVS.Get", { key: key }, function (res, err) {
        let v = null;
        if (res && typeof res.value === "string") {
            try {
                v = JSON.parse(res.value);
            } catch (e) {
                v = null;
            }
        }
        if (key === "uc_batch" && v === null) {
            LOAD.push("puhdistamo_batch_count");
            LOAD.push("puhdistamo_process_message");
        }
        applyLoaded(key, v);
        loadNext(i + 1);
    });
}

// Shelly and the plant share the supply: a power-on reset of the Shelly means the control
// unit also restarted and begins a new cleaning cycle. A software reset (update, reboot)
// leaves the plant running. Without reset_reason a recent start is taken as a power cut.
function powerOnReset(up) {
    if (up >= CFG.boot_window_s) return false;
    let rr = sysStatus().reset_reason;
    if (typeof rr !== "number") return true;
    return rr === 1 || rr === 9 || rr === 14;
}

function finishStart() {
    let up = upS();
    let boot = powerOnReset(up);
    if (boot) {
        st.restart = { since: 0, reason: "power_cut" };
        st.resumeCheck = false;
        st.cyc = "unknown";
        st.ph = "unknown";
        st.etaUp = null;
    }
    if (!boot && st.resumeCheck) log("stored phase " + st.cyc + " / " + st.ph);
    setField("batches", cnt.batches);
    setField("sludge", cnt.sludge);
    if (cnt.chem !== null) setField("chemical", cnt.chem);
    else {
        let v = H.chemical ? H.chemical.getValue() : 0;
        if (typeof v === "number" && v > 0) cnt.chem = v;
        fieldWritten.chemical = v;
    }
    setVc("phase", st.ph);
    setVc("cycle", st.cyc);
    setVc("warning", "none");
    checkCounters();
    emit("start", { reason: boot ? "power_cut" : "restart", version: VERSION });
    log("version " + VERSION + " started, uptime " + Math.round(up) + " s, batches " + cnt.batches);
    refreshOutputs(true);
    Timer.set(1000, true, tick);
    Timer.set(86400000, true, saveBase);
}

function start() {
    initHandles();
    registerEndpoint();
    loadNext(0);
}

Timer.set(300, false, start);
