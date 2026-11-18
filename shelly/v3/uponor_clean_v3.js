/*
 * Uponor Clean I - process monitoring for Shelly (version 3)
 *
 * Follows the control unit's firmware cycle from the power consumption alone:
 * cleaning, waiting, holiday and test cycles with their phases, the next
 * pump-out time, batches, chemical use and sludge. Works without Home
 * Assistant.
 *
 * The script creates its virtual components at the first start (Virtual.Add)
 * and stores their keys in KVS "uc_vc". They are ordinary components, not
 * owned by the script (@meta), because Home Assistant's Shelly integration
 * does not show script-owned components. 9 of the 10 component slots are used.
 *
 * Requirements: Shelly with an em1 / pm1 power meter, firmware 2.2.0 or newer,
 * the device time zone set.
 *
 * Events: Shelly.emitEvent("uponor", {v, type, ...}) on phase, batch, warning,
 * chemical and sludge changes. Home Assistant reads only the first 5 kB of a
 * script to find its event types, so this line keeps the event entity there.
 *
 * Persistent data lives in KVS (keys uc_*), so it survives code updates and
 * deleting the script. Settings can be overridden in KVS key "uc_cfg" (JSON).
 *
 * Engine rules (verified on the device): no recursion, small RPC responses,
 * at most 5 timers / 5 RPC calls, functions defined before they are called,
 * no Array shift / unshift / concat, no Date.UTC.
 */

let VERSION = "3.0.0";

// ------------------------------------------------------------------ settings
// Can be overridden in KVS key "uc_cfg", e.g. {"sludge_limit": 600}. Script memory is
// small (about 25 kB for all scripts), so fixed values are written in the code instead.
let CFG = {
    off_max: 2.0, idle_max: 10.0, valve_max: 24.0, dosing_max: 38.5, comp_max: 52.0, aer_max: 64.0,  // W at 230 V
    debounce_s: 6,            // shorter levels are ignored (self-tests, compressor start and stop)
    dose_l: 0.04,             // chemical per dose
    chem_warn_days: 10,       // warning when the chemical lasts less than this
    sludge_limit: 800,        // sludge emptying reminder (firmware default), 0 = off
    emptying_hint: true,      // hint when the pump-in power shows that the sludge was emptied
    fault_high_w: 62.0,       // air_leak warning above this for 2 min
    legacy_kvs: true          // also write the v2 KVS keys (puhdistamo_*)
};

// firmware times (s), control unit board A
let FW = {
    pre: 600, aer: 5400, chem: 90, dose: 10, mix: 120, sed1: 2700, sludge: 120, sed2: 900, out: 780, in_max: 1020,
    wait: 1080, w_sludge: 60, w_aer: 1800, w_in: 600, holiday_after: 256200,
    h_wait1: 3000, h_aer: 600, h_wait2: 6000
};

// cleaning-cycle phases in firmware order
function cleaningSeq() {
    return ["pre_aeration", "aeration", "chem_filling", "dosing", "mixing", "sedimentation_1", "sludge_removal", "sedimentation_2", "pump_out", "pump_in"];
}

// seconds from the start of a cleaning phase to the start of the pump-out (incl. self-tests)
function etaFrom(ph) {
    let i = cleaningSeq().indexOf(ph);
    return i >= 0 && i < 8 ? [9950, 9350, 3940, 3850, 3840, 3720, 1020, 900][i] : null;
}

// warnings, most important first
function warnKeys() {
    return ["none", "no_power", "air_leak", "no_signal", "compressor_idle", "outlet_blocked", "high_water", "paused", "chemical_low", "sludge_due", "sludge_emptied"];
}

function warnTitle(k) {
    let t = ["OK", "No power to plant", "High power, check air hoses", "Power reading missing", "Compressor not running",
        "Outlet blocked?", "High water", "Process paused?", "Chemical low", "Sludge emptying due", "Sludge emptied? Set Sludge to 0"];
    return t[warnKeys().indexOf(k)];
}

// settings of the components (Virtual.Add at the first start, SetConfig after a version change)
function vcConfig(role) {
    let label = { ui: { view: "label" } };
    if (role === "phase") {
        let ph = ["unknown", "pre_aeration", "aeration", "chem_filling", "dosing", "mixing", "sedimentation_1",
            "sludge_removal", "sedimentation_2", "pump_out", "pump_in", "waiting", "off"];
        let tt = ["Unknown", "Pre-aeration", "Aeration", "Chemical filling", "Dosing", "Mixing", "Sedimentation I",
            "Sludge removal", "Sedimentation II", "Pump-out", "Pump-in", "Waiting", "No power"];
        let titles = {};
        for (let i = 0; i < ph.length; i++) titles[ph[i]] = tt[i];
        return { options: ph, default_value: "unknown", persisted: false, meta: { ui: { view: "label", titles: titles } } };
    }
    if (role === "cycle") {
        return { options: ["unknown", "cleaning", "waiting", "holiday", "test"], default_value: "unknown", persisted: false,
            meta: { ui: { view: "label", titles: { unknown: "Unknown", cleaning: "Cleaning", waiting: "Waiting", holiday: "Holiday", test: "Test" } } } };
    }
    if (role === "warning") {
        let ks = warnKeys();
        let wt = {};
        for (let j = 0; j < ks.length; j++) wt[ks[j]] = warnTitle(ks[j]);
        return { options: ks, default_value: "none", persisted: false, meta: { ui: { view: "label", titles: wt } } };
    }
    if (role === "status") return { max_len: 255, default_value: "", persisted: false, meta: label };
    if (role === "next_pumpout") return { max_len: 32, default_value: "", persisted: false, meta: label };
    if (role === "batches") return { min: 0, max: 999999, default_value: 0, persisted: true, meta: { ui: { view: "field", step: 1 } } };
    if (role === "chemical") return { min: 0, max: 30, default_value: 0, persisted: true, meta: { ui: { view: "field", unit: "l", step: 0.1 } } };
    return { min: 0, max: 9999, default_value: 0, persisted: true, meta: { ui: { view: "field", step: 1 } } };
}

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

function nowUnix() {
    let s = Shelly.getComponentStatus("sys");
    if (s && typeof s.unixtime === "number") return s.unixtime;
    return null;
}

function unixAt(tUp) {
    let n = nowUnix();
    if (n === null) return null;
    return Math.round(n - (upS() - tUp));
}

// a measured length matches a firmware time (an unknown length, -1, never matches)
function near(x, target) {
    return x >= 0 && Math.abs(x - target) <= 90;
}

function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

function localOffsetMin() {
    let s = Shelly.getComponentStatus("sys");
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

// "HH:MM", or "YYYY-MM-DD HH:MM" with full
function timeText(unix, full) {
    let c = civil(unix);
    if (!c) return "";
    return (full ? c[0] + "-" + pad2(c[1]) + "-" + pad2(c[2]) + " " : "") + pad2(c[3]) + ":" + pad2(c[4]);
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
        k = kvsOrder[0];
        kvsOrder.splice(0, 1);      // Array shift, unshift and concat are not available on the device
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

// S-code shown on the control unit display (Test button pressed briefly)
function phaseCode() {
    let i = st.cyc === "cleaning" ? cleaningSeq().indexOf(st.ph) : -1;
    if (i >= 0) return "S1" + pad2(i === 9 ? 12 : i + 2);
    i = st.cyc === "waiting" ? ["waiting", "sludge_removal", "", "aeration", "pump_in"].indexOf(st.ph) : -1;
    return i >= 0 ? "S20" + (i + 1) : "";
}

function statusText() {
    let now = upS();
    let synced = nowUnix() !== null;
    let last = cnt.lastBatchUnix ? timeText(cnt.lastBatchUnix, true) : "unknown";
    let s;
    if (st.ph === "off") s = "No power" + (st.offSinceUnix ? " since " + timeText(st.offSinceUnix) : "");
    else if (st.restart) s = "Starting after power cut";
    else if (st.ph === "unknown") s = "Synchronising";
    else if (st.cyc === "test") s = "Test cycle";
    else if (st.ph === "pump_out") s = "Pumping out" + (synced ? ", ends " + timeText(unixAt(st.pumpOutStart + FW.out)) : "");
    else if (st.etaUp !== null) {
        let m = Math.max(0, Math.round((st.etaUp - now) / 60));
        let left = (m >= 60 ? Math.floor(m / 60) + " h " : "") + (m % 60) + " min";
        s = (st.restarted ? "Restarted after power cut | " : "") +
            (synced ? "Pump-out at " + timeText(etaUnix()) + " (in " + left + ")" : "Pump-out in " + left);
    }
    else if (st.ph === "pump_in") s = "Pumping in | last pump-out " + last;
    else if (st.cyc === "holiday") s = "Holiday mode" + (st.holidayUnix ? " since " + timeText(st.holidayUnix, true) : "") + " | last pump-out " + last;
    else if (st.cyc === "waiting") s = "Waiting for wastewater | last pump-out " + last;
    else s = "Last pump-out " + last;
    if (topWarning !== "none") s += " | " + warnTitle(topWarning);
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
    let e = etaFrom(ph);
    st.etaUp = e === null ? null : startUp + e;
}

// ------------------------------------------------------------------ warnings
function setWarning(key, on) {
    on = !!on;
    if (!!warn[key] === on) return;
    warn[key] = on;
    emit("warning", { key: key, on: on });
    let top = "none";
    let ks = warnKeys();
    for (let i = 1; i < ks.length; i++) {
        if (warn[ks[i]]) {
            top = ks[i];
            break;
        }
    }
    if (top !== topWarning) {
        topWarning = top;
        setVc("warning", top);
        refreshOutputs(true);
    }
}

// days the chemical lasts at the mean dose rate of the last full days (2 a day until 3 days are known)
function chemDaysLeft() {
    if (cnt.chem === null) return null;
    let sum = 0;
    let n = cnt.doses.length - 1;
    for (let i = 1; i <= n; i++) sum += cnt.doses[i];
    return cnt.chem / (CFG.dose_l * (n < 3 ? 2 : Math.max(0.2, sum / n)));
}

function checkCounters() {
    let d = chemDaysLeft();
    setWarning("chemical_low", d !== null && d < CFG.chem_warn_days);
    setWarning("sludge_due", CFG.sludge_limit > 0 && cnt.sludge >= CFG.sludge_limit);
    if (base.hintSince !== null && (cnt.sludge < 100 || upS() - base.hintSince > 259200)) {
        base.hintSince = null;
        setWarning("sludge_emptied", false);
    }
}

// ------------------------------------------------------------------ counters
function rollChemDay() {
    let off = localOffsetMin();
    let n = nowUnix();
    if (off === null || n === null) return;
    let day = Math.floor((n + off * 60) / 86400);
    if (cnt.chemDay === 0) cnt.chemDay = day;
    let shift = day - cnt.chemDay;
    if (shift <= 0) return;
    if (shift > 14) shift = 14;
    let nd = [];
    for (let i = 0; i < shift; i++) nd.push(0);
    for (let j = 0; j < cnt.doses.length && nd.length < 14; j++) nd.push(cnt.doses[j]);
    cnt.doses = nd;
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
    if (avgW >= base.pin + 0.7) {
        base.elevated++;
        if (base.elevated >= 3) {
            if (cnt.sludge >= 100 && base.hintSince === null) {
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

// a long wait has been seen: is it plausible that the holiday cycle has started?
function holidayPossible() {
    let n = nowUnix();
    if (n !== null && st.waitEntryUnix !== null) return n - st.waitEntryUnix >= FW.holiday_after - 3600;
    if (n !== null && cnt.lastBatchUnix !== null) return n - cnt.lastBatchUnix >= 252000;
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
            // firmware: the holiday check is made after each waiting-cycle pump-in
            let e = unixAt(t);
            if (e !== null && st.waitEntryUnix !== null && e - st.waitEntryUnix >= FW.holiday_after - 60) enterHoliday("w1", t);
            else enterWaiting(t, false);
        }
        // cleaning-cycle pump-in runs up to 1020 s, waiting and holiday pump-ins 600 s
        else enterWaiting(t, st.cyc === "cleaning" || near(dur, FW.in_max));
    } else if (st.ph === "sludge_removal") enterHoliday("w1", t);   // a wait after sludge removal: holiday cycle
    else if (st.ph === "unknown" && peaks === 0 && dur > 90 && near(dur, FW.sludge)) cleaningStep("sedimentation_2", t);
    else if (st.ph === "unknown" && peaks === 0 && near(dur, FW.w_sludge)) enterHoliday("w1", t);
    else unknownPhase(t, "");
}

function toComp(from, dur, peaks, t) {
    if (from === "IDLE") {
        let w = st.ph === "waiting" && (st.cyc === "waiting" || st.cyc === "holiday");
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
        let w = st.ph === "waiting" && (st.cyc === "waiting" || st.cyc === "holiday");
        if (st.afterPumpOut) startCleaning(t, "start level reached");
        else if (w && st.cyc === "holiday" && st.sub !== "w2") holidayStep("aeration", t, t);
        else if (w && (st.cyc === "holiday" || dur >= 1200)) holidayStep("aeration", t, t - dur);
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

// after a power cut the control unit always starts a new cleaning cycle
function restartTransition(to, t) {
    if (t - st.restart.since > 360) {
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
    else if (to === "DOSING") {
        if (st.cyc === "test") setPhase("test", "dosing", t);
        else cleaningStep("dosing", t);
    }
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
    pw.u = typeof s.voltage === "number" && s.voltage > 50 ? s.voltage : 230;
    let pn = p;
    if (p > CFG.idle_max) {
        let r = 230 / pw.u;
        pn = (p - 4) * r * r + 4;
    }
    pw.pn = Math.round(pn * 10) / 10;
    pw.lastSeenUp = upS();
    return true;
}

// Levels shorter than debounce_s (the self-test between phases) are ignored. A boost shorter
// than 12 s is a mixing pulse of the pump-in; a longer one is aeration.
function updateBand(t) {
    let pn = pw.pn;
    let b = pn < CFG.off_max ? "OFF" : pn < CFG.idle_max ? "IDLE" : pn <= CFG.valve_max ? "VALVE" :
        pn <= CFG.dosing_max ? "DOSING" : pn <= CFG.comp_max ? "COMP" : pn <= CFG.aer_max ? "AER" : "BOOST";
    // above the compressor level: a pulse if it ends within 12 s, otherwise aeration
    if (b === "BOOST" || (b === "AER" && bs.stable === "COMP")) {
        if (bs.boostSince === null) bs.boostSince = t;
        if (t - bs.boostSince < 12) return;
        b = "AER";
        if (bs.cand !== "AER") {
            bs.cand = "AER";
            bs.candSince = bs.boostSince;
            bs.candStart = bs.boostSince;
        }
    } else if (bs.boostSince !== null) {
        if (t - bs.boostSince < 12) {
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
    let need = bs.cand === "VALVE" ? CFG.debounce_s + 4 : CFG.debounce_s;
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

// the phase that follows a phase in the firmware sequence, and the phase lengths
function nextPhase(cyc, ph, sub) {
    if (cyc === "cleaning") {
        let seq = cleaningSeq();
        let i = seq.indexOf(ph);
        return i >= 0 && i < 9 ? seq[i + 1] : null;
    }
    if (cyc === "waiting") return ph === "waiting" ? "sludge_removal" : (ph === "sludge_removal" ? "aeration" : (ph === "aeration" ? "pump_in" : null));
    if (cyc === "holiday") {
        if (ph === "waiting") return sub === "w2" ? "sludge_removal" : "aeration";
        return ph === "aeration" ? "pump_in" : (ph === "sludge_removal" ? "waiting" : null);
    }
    return null;
}

function phaseDur(cyc, ph, sub) {
    if (ph === "sludge_removal") return cyc === "cleaning" ? FW.sludge : FW.w_sludge;
    if (ph === "aeration") return cyc === "cleaning" ? FW.aer : (cyc === "waiting" ? FW.w_aer : FW.h_aer);
    if (ph === "waiting") return cyc === "waiting" ? FW.wait : (sub === "w2" ? FW.h_wait2 : FW.h_wait1);
    if (ph === "pump_in") return cyc === "cleaning" ? FW.in_max : FW.w_in;
    let i = cleaningSeq().indexOf(ph);
    return i >= 0 ? [FW.pre, FW.aer, FW.chem, FW.dose, FW.mix, FW.sed1, FW.sludge, FW.sed2, FW.out][i] : null;
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
            if (ps > t + 60 || t - ps > phaseDur(st.cyc, ph, sub) + 300) return false;
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
    else if (b === "DOSING") cleaningStep("dosing", t);
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
        else if (t - bs.since >= 540) pumpOutStarts(bs.since, !bs.partial);
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
    if (bs.stable === "AER" && t - bs.since >= 1860 &&
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
    if (st.cyc === "waiting" && st.ph === "waiting" && idleFor >= 1200 && holidayPossible()) {
        enterHoliday(st.waitEntryUnix !== null ? "w1" : "", bs.since);
    }
    let expected = 0;
    if (st.ph === "sedimentation_1") expected = FW.sed1;
    else if (st.ph === "sedimentation_2") expected = FW.sed2;
    else if (st.ph === "waiting" && st.cyc === "waiting") expected = FW.wait;
    else if (st.ph === "waiting" && st.cyc === "holiday") expected = st.sub === "w1" ? FW.h_wait1 : FW.h_wait2;
    else if (st.ph === "unknown" && !st.restart) expected = FW.h_wait2;
    setWarning("paused", (expected > 0 && idleFor > expected + 300) || (st.hold !== null && idleFor > 300));
    if (warn.paused) st.etaUp = null;

    // a stale estimate is dropped
    if (st.etaUp !== null && t > st.etaUp + 600 && st.ph !== "pump_out") st.etaUp = null;
}

function faultRules(t) {
    let pn = pw.pn;
    if (pn !== null && pn > CFG.fault_high_w) {
        if (pw.highSince === null) pw.highSince = t;
    } else pw.highSince = null;
    setWarning("air_leak", pw.highSince !== null && t - pw.highSince >= 120);
    if (pn !== null && pn < CFG.off_max) {
        if (pw.offSince === null) pw.offSince = t;
    } else pw.offSince = null;
    setWarning("no_power", pw.offSince !== null && t - pw.offSince >= 60);
    if (pw.lastCompUp === null || (pn !== null && pn > CFG.valve_max)) pw.lastCompUp = t;
    setWarning("compressor_idle", pn !== null && pw.offSince === null && t - pw.lastCompUp >= 14400);
    if (pw.lastSeenUp === null) pw.lastSeenUp = t;
    setWarning("no_signal", t - pw.lastSeenUp >= 600);
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
            if (cnt.sludge < 100) base.elevated = 0;
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
    let ks = warnKeys();
    for (let i = 1; i < ks.length; i++) if (warn[ks[i]]) w.push(ks[i]);
    let hd = null;
    if (st.cyc === "waiting" && st.waitEntryUnix !== null) hd = st.waitEntryUnix + FW.holiday_after;
    return {
        version: VERSION, cycle: st.cyc, phase: st.ph, code: phaseCode(), since: st.phStart > 0 ? unixAt(st.phStart) : null,
        eta: etaUnix(), last_pumpout: cnt.lastBatchUnix, batches: cnt.batches,
        chemical: { l: cnt.chem, days: chemDaysLeft() }, sludge: { n: cnt.sludge, reset: cnt.sludgeReset },
        warnings: w, holiday_at: hd, holiday_since: st.cyc === "holiday" ? st.holidayUnix : null,
        power: pw.pn, band: bs.stable, time_synced: nowUnix() !== null, uptime: Math.floor(upS())
    };
}

// ------------------------------------------------------------------ start
// ------------------------------------------------------------------ components
let vcMap = {};     // role -> component key ("enum:200"), stored in KVS uc_vc

function roleList() {
    return ["phase", "cycle", "status", "warning", "next_pumpout", "batches", "chemical", "sludge"];
}

function roleType(r) {
    if (r === "status" || r === "next_pumpout") return "text";
    return r === "batches" || r === "chemical" || r === "sludge" ? "number" : "enum";
}

function vcExists(key) {
    return !!key && !!Shelly.getComponentStatus(key);
}

// Creates the missing components one call at a time, then the group. Existing
// components get the current settings when the script version changes.
function ensureComponents(done) {
    let rs = roleList();
    let names = ["Phase", "Cycle", "Status", "Warning", "Next pump-out", "Batches", "Chemical", "Sludge"];
    let update = vcMap.v !== VERSION;
    let i = 0;
    let added = false;
    function step() {
        while (i < rs.length && vcExists(vcMap[rs[i]]) && !update) i++;
        if (i >= rs.length) {
            ensureGroup(added || update, done);
            return;
        }
        let r = rs[i];
        let cfg = vcConfig(r);
        cfg.name = names[i];
        i++;
        if (vcExists(vcMap[r])) {
            let t = roleType(r);
            let m = t === "text" ? "Text.SetConfig" : (t === "number" ? "Number.SetConfig" : "Enum.SetConfig");
            Shelly.call(m, { id: Number(vcMap[r].split(":")[1]), config: cfg }, function () {
                step();
            });
            return;
        }
        Shelly.call("Virtual.Add", { type: roleType(r), config: cfg }, function (res, err, msg) {
            if (res && typeof res.id === "number") {
                vcMap[r] = roleType(r) + ":" + res.id;
                added = true;
                log("created " + vcMap[r] + " (" + r + ")");
            } else log("Virtual.Add " + r + " failed: " + err + " " + msg);
            step();
        });
    }
    step();
}

function ensureGroup(changed, done) {
    let rs = roleList();
    let members = [];
    for (let i = 0; i < rs.length; i++) if (vcMap[rs[i]]) members.push(vcMap[rs[i]]);
    vcMap.v = VERSION;
    function setMembers() {
        Shelly.call("Group.Set", { id: Number(vcMap.group.split(":")[1]), value: members }, function () {
            kvsSave("uc_vc", vcMap);
            done();
        });
    }
    if (vcExists(vcMap.group)) {
        if (changed) setMembers();
        else done();
        return;
    }
    Shelly.call("Virtual.Add", { type: "group", config: { name: "Uponor Clean" } }, function (res) {
        if (res && typeof res.id === "number") {
            vcMap.group = "group:" + res.id;
            setMembers();
        } else {
            kvsSave("uc_vc", vcMap);
            done();
        }
    });
}

function initHandles() {
    let rs = roleList();
    for (let i = 0; i < rs.length; i++) {
        let r = rs[i];
        H[r] = vcExists(vcMap[r]) ? Virtual.getHandle(vcMap[r]) : null;
        if (!H[r]) log("component " + r + " missing");
    }
    let f = ["batches", "chemical", "sludge"];
    for (let j = 0; j < f.length; j++) if (H[f[j]]) H[f[j]].on("change", onFieldChange(f[j]));
}

function applyLoaded(key, v) {
    if (key === "uc_vc" && v) {
        vcMap = v;
    } else if (key === "uc_cfg" && v) {
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
            // days from 1970-01-01 to the civil date (Date.UTC is not available on the device)
            let y = Number(d[2]) - (Number(d[1]) <= 2 ? 1 : 0);
            let era = Math.floor(y / 400);
            let yoe = y - era * 400;
            let mo = Number(d[1]);
            let doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + Number(d[0]) - 1;
            let days = era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
            cnt.lastBatchUnix = days * 86400 + Number(h[0]) * 3600 + Number(h[1]) * 60 + Number(h[2] || 0) - off * 60;
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
        let n = nowUnix();
        let ps = n === null || !v.ps ? null : upS() - (n - v.ps);
        let max = v.p === "waiting" ? FW.h_wait2 : phaseDur(v.c, v.p, v.s);
        let age = ps === null ? -1000 : upS() - ps;
        if (max && age > -60 && age <= max + 300) {
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

let LOAD = ["uc_vc", "uc_cfg", "uc_batch", "uc_chem", "uc_sludge", "uc_base", "uc_cycle"];

function loadNext(i) {
    if (i >= LOAD.length) {
        ensureComponents(function () {
            initHandles();
            finishStart();
        });
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

function finishStart() {
    // Shelly and the plant share the supply: a power-on reset of the Shelly means the control
    // unit also restarted and begins a new cleaning cycle. A software reset (update, reboot)
    // leaves the plant running. Without reset_reason a recent start is taken as a power cut.
    let up = upS();
    let rr = Shelly.getComponentStatus("sys").reset_reason;
    let boot = up < 300 && (typeof rr !== "number" || rr === 1 || rr === 9 || rr === 14);
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

Timer.set(300, false, function () {
    HTTPServer.registerEndpoint("state", function (req, res) {
        res.code = 200;
        res.headers = [["Content-Type", "application/json"]];
        res.body = JSON.stringify(stateObject());
        res.send();
    });
    loadNext(0);
});
