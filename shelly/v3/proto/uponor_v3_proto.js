/* @meta {
  "vc": {
    "phase": {"type": "enum", "access": "rc", "config": {"name": "Phase", "options": ["unknown", "pre_aeration", "aeration", "chem_filling", "dosing", "mixing", "sedimentation_1", "sludge_removal", "sedimentation_2", "pump_out", "pump_in", "waiting", "off"], "default_value": "unknown", "persisted": false, "meta": {"ui": {"view": "label", "titles": {"unknown": "Unknown", "pre_aeration": "Pre-aeration", "aeration": "Aeration", "chem_filling": "Chemical filling", "dosing": "Dosing", "mixing": "Mixing", "sedimentation_1": "Sedimentation I", "sludge_removal": "Sludge removal", "sedimentation_2": "Sedimentation II", "pump_out": "Pump-out", "pump_in": "Pump-in", "waiting": "Waiting", "off": "No power"}}}}},
    "cycle": {"type": "enum", "access": "rc", "config": {"name": "Cycle", "options": ["unknown", "cleaning", "waiting", "holiday", "test"], "default_value": "unknown", "persisted": false, "meta": {"ui": {"view": "label", "titles": {"unknown": "Unknown", "cleaning": "Cleaning", "waiting": "Waiting", "holiday": "Holiday", "test": "Test"}}}}},
    "status": {"type": "text", "access": "rc", "config": {"name": "Status", "max_len": 255, "default_value": "", "persisted": false, "meta": {"ui": {"view": "label"}}}},
    "warning": {"type": "enum", "access": "rc", "config": {"name": "Warning", "options": ["none", "no_power", "air_leak", "no_signal", "compressor_idle", "outlet_blocked", "high_water", "paused", "chemical_low", "sludge_due", "sludge_emptied"], "default_value": "none", "persisted": false, "meta": {"ui": {"view": "label", "titles": {"none": "OK", "no_power": "No power to plant", "air_leak": "High power, check air hoses", "no_signal": "Power reading missing", "compressor_idle": "Compressor not running", "outlet_blocked": "Outlet blocked?", "high_water": "High water", "paused": "Process paused?", "chemical_low": "Chemical low", "sludge_due": "Sludge emptying due", "sludge_emptied": "Sludge emptied? Set Sludge to 0"}}}}},
    "next_pumpout": {"type": "text", "access": "rc", "config": {"name": "Next pump-out", "max_len": 32, "default_value": "", "persisted": false, "meta": {"ui": {"view": "label"}}}},
    "batches": {"type": "number", "config": {"name": "Batches", "min": 0, "max": 999999, "default_value": 0, "persisted": true, "meta": {"ui": {"view": "field", "step": 1}}}},
    "chemical": {"type": "number", "config": {"name": "Chemical", "min": 0, "max": 30, "default_value": 0, "persisted": true, "meta": {"ui": {"view": "field", "unit": "l", "step": 0.1}}}},
    "sludge": {"type": "number", "config": {"name": "Sludge", "min": 0, "max": 9999, "default_value": 0, "persisted": true, "meta": {"ui": {"view": "field", "step": 1}}}},
    "plant": {"type": "group", "config": {"name": "Uponor Clean"}, "members": ["@phase", "@cycle", "@status", "@warning", "@next_pumpout", "@batches", "@chemical", "@sludge"]}
  }
} */

/*
 * Uponor Clean v3 - device prototype 1
 *
 * Does NOT detect anything. It checks on the real device that the v3 building
 * blocks work: components declared in @meta, read-only access, user edits of
 * fields, KVS persistence, events to other scripts, the HTTP state endpoint,
 * memory use and the EM1Data history after a reboot.
 * The demo cycles through all phases and warnings every 10 s and simulates a
 * batch every 5 minutes (Batches +1, Sludge +1, Chemical -0.04 l).
 */

let VERSION = "3.0-proto1";
let TAG = "[uc-proto] ";
let KVS_KEY = "uc_proto";

let ROLES = ["phase", "cycle", "status", "warning", "next_pumpout", "batches", "chemical", "sludge", "plant"];
let FIELDS = ["batches", "chemical", "sludge"];
let PHASES = ["unknown", "pre_aeration", "aeration", "chem_filling", "dosing", "mixing", "sedimentation_1", "sludge_removal", "sedimentation_2", "pump_out", "pump_in", "waiting", "off"];
let CYCLES = ["unknown", "cleaning", "waiting", "holiday", "test"];
let WARNINGS = ["none", "no_power", "air_leak", "no_signal", "compressor_idle", "outlet_blocked", "high_water", "paused", "chemical_low", "sludge_due", "sludge_emptied"];

let H = {};
let val = { phase: "unknown", cycle: "unknown", status: "", warning: "none", next_pumpout: "", batches: 0, chemical: 0, sludge: 0 };
let written = { batches: null, chemical: null, sludge: null };
let store = { starts: 0, first_ts: null, batches: null, chemical: null, sludge: null, user_edits: 0 };
let changeEvents = 0;
let tick = 0;
let endpoint = "";
let em1Checked = false;

function log(s) {
    print(TAG + s);
}

function sysStatus() {
    return Shelly.getComponentStatus("sys");
}

function nowUnix() {
    let s = sysStatus();
    if (s && typeof s.unixtime === "number") return s.unixtime;
    return null;
}

function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

// Local offset in minutes from Sys.time ("HH:MM", local) and Sys.unixtime (UTC).
function localOffsetMin() {
    let s = sysStatus();
    if (!s || typeof s.unixtime !== "number" || typeof s.time !== "string") return null;
    let parts = s.time.split(":");
    let localMin = Number(parts[0]) * 60 + Number(parts[1]);
    let utcMin = Math.floor((s.unixtime % 86400) / 60);
    let d = localMin - utcMin;
    if (d > 840) d -= 1440;
    if (d < -720) d += 1440;
    return Math.round(d / 15) * 15;
}

// ISO 8601 local time with offset, computed without Date (civil-from-days).
function isoLocal(unix) {
    let off = localOffsetMin();
    if (off === null || unix === null) return "";
    let t = unix + off * 60;
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
    let hh = Math.floor(secs / 3600);
    let mm = Math.floor((secs % 3600) / 60);
    let sign = off < 0 ? "-" : "+";
    let ao = Math.abs(off);
    return y + "-" + pad2(m) + "-" + pad2(d) + "T" + pad2(hh) + ":" + pad2(mm) + ":00" +
        sign + pad2(Math.floor(ao / 60)) + ":" + pad2(ao % 60);
}

function emit(type, data) {
    data.v = 1;
    data.type = type;
    data.ts = nowUnix();
    Shelly.emitEvent("uponor", data);
}

function setVal(role, v) {
    if (!H[role]) return;
    H[role].setValue(v);
    val[role] = v;
    if (written[role] !== undefined) written[role] = v;
}

function saveStore() {
    Shelly.call("KVS.Set", { key: KVS_KEY, value: JSON.stringify(store) }, function (res, err, msg) {
        if (err) log("KVS.Set failed: " + err + " " + msg);
    });
}

function round2(x) {
    return Math.round(x * 100) / 100;
}

function memLine() {
    let st = Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId());
    if (!st) return "mem n/a";
    return "mem_used " + st.mem_used + ", mem_peak " + st.mem_peak + ", mem_free " + st.mem_free;
}

function makeFieldHandler(f) {
    return function (ev) {
        changeEvents++;
        if (changeEvents <= 3) log("change event (raw) " + f + ": " + JSON.stringify(ev));
        let v = (ev && typeof ev.value === "number") ? ev.value : H[f].getValue();
        if (written[f] !== null && Math.abs(v - written[f]) < 0.000001) {
            log("own write confirmed: " + f + " = " + v);
            return;
        }
        log("USER EDIT " + f + ": " + written[f] + " -> " + v);
        val[f] = v;
        written[f] = v;
        store[f] = v;
        store.user_edits++;
        saveStore();
        emit("user_edit", { field: f, value: v });
        setVal("status", "User set " + f + " to " + v);
    };
}

function initHandles() {
    let ok = 0;
    for (let i = 0; i < ROLES.length; i++) {
        let r = ROLES[i];
        H[r] = Script.getVcHandle(r);
        if (H[r]) {
            ok++;
            let cfg = H[r].getConfig();
            log("role " + r + ": id " + (cfg ? cfg.id : "?") + ", name " + JSON.stringify(cfg ? cfg.name : ""));
        } else {
            log("role " + r + ": MISSING");
        }
    }
    log("handles: " + ok + "/" + ROLES.length);
    if (H.plant) log("group members: " + JSON.stringify(H.plant.getStatus()));
    for (let j = 0; j < FIELDS.length; j++) {
        let f = FIELDS[j];
        if (H[f]) {
            H[f].on("change", makeFieldHandler(f));
            val[f] = H[f].getValue();
            log("field " + f + " value after start: " + val[f]);
        }
    }
}

function probe() {
    let di = Shelly.getDeviceInfo();
    log("version " + VERSION + ", device " + di.id + ", model " + di.model + ", fw " + di.ver + " (" + di.fw_id + ")");
    let s = sysStatus();
    log("sys: uptime " + s.uptime + " s, unixtime " + s.unixtime + ", time " + s.time);
    log("api: getVcHandle " + typeof Script.getVcHandle + ", getUptimeMs " + typeof Shelly.getUptimeMs +
        ", emitEvent " + typeof Shelly.emitEvent + ", HTTPServer " + typeof HTTPServer +
        ", Script.storage " + typeof Script.storage);
    try {
        let d = new Date();
        log("Date: " + d.toString() + ", getTimezoneOffset " +
            (typeof d.getTimezoneOffset === "function" ? d.getTimezoneOffset() : "n/a") +
            ", toISOString " + (typeof d.toISOString === "function" ? d.toISOString() : "n/a"));
    } catch (e) {
        log("Date probe failed: " + e);
    }
    log("offset from Sys: " + localOffsetMin() + " min, iso now: " + isoLocal(nowUnix()));
    log("em1data:0 status: " + JSON.stringify(Shelly.getComponentStatus("em1data:0")));
    log(memLine());
}

function checkEm1Data() {
    let now = nowUnix();
    if (now === null) {
        log("EM1Data check waits for time sync.");
        return;
    }
    em1Checked = true;
    Shelly.call("EM1Data.GetRecords", { id: 0, ts: now - 1800 }, function (res, err, msg) {
        if (err || !res) {
            log("EM1Data.GetRecords failed: " + err + " " + msg);
            return;
        }
        let blocks = res.data_blocks || [];
        log("EM1Data blocks in last 30 min: " + blocks.length);
        for (let i = 0; i < blocks.length; i++) {
            log("  block ts " + blocks[i].ts + " (" + isoLocal(blocks[i].ts) + "), period " +
                blocks[i].period + " s, records " + blocks[i].records);
        }
    });
}

function stateObject() {
    return {
        version: VERSION,
        uptime_s: Math.floor(Shelly.getUptimeMs() / 1000),
        time: isoLocal(nowUnix()),
        tick: tick,
        values: val,
        store: store,
        mem: memLine()
    };
}

function registerEndpoint() {
    if (typeof HTTPServer === "undefined") {
        log("HTTPServer not available");
        return;
    }
    endpoint = HTTPServer.registerEndpoint("state", function (req, res) {
        res.code = 200;
        res.headers = [["Content-Type", "application/json"]];
        res.body = JSON.stringify(stateObject());
        res.send();
    });
    let w = Shelly.getComponentStatus("wifi");
    let ip = w && w.sta_ip ? w.sta_ip : "<shelly-ip>";
    log("state endpoint: http://" + ip + endpoint);
}

function simulateBatch() {
    setVal("batches", val.batches + 1);
    setVal("sludge", val.sludge + 1);
    setVal("chemical", round2(Math.max(0, val.chemical - 0.04)));
    store.batches = val.batches;
    store.sludge = val.sludge;
    store.chemical = val.chemical;
    saveStore();
    emit("batch", { n: val.batches, sludge: val.sludge, chemical: val.chemical });
    log("simulated batch: batches " + val.batches + ", sludge " + val.sludge + ", chemical " + val.chemical);
}

function onTick() {
    tick++;
    setVal("phase", PHASES[tick % PHASES.length]);
    if (tick % 3 === 0) setVal("cycle", CYCLES[(tick / 3) % CYCLES.length]);
    if (tick % 2 === 0) setVal("warning", WARNINGS[(tick / 2) % WARNINGS.length]);
    setVal("status", "Prototype " + VERSION + " | tick " + tick + " | phase " + val.phase);
    if (tick % 6 === 0) {
        let now = nowUnix();
        setVal("next_pumpout", now === null ? "" : isoLocal(now + 3600));
        log(memLine());
        if (!em1Checked) checkEm1Data();
    }
    if (tick % 3 === 0) emit("heartbeat", { tick: tick, phase: val.phase });
    if (tick % 30 === 0) simulateBatch();
}

function applyStore() {
    for (let i = 0; i < FIELDS.length; i++) {
        let f = FIELDS[i];
        if (typeof store[f] === "number") {
            setVal(f, store[f]);
            log("field " + f + " restored from KVS: " + store[f]);
        } else {
            store[f] = val[f];
            written[f] = val[f];
        }
    }
}

function start() {
    probe();
    initHandles();
    registerEndpoint();
    Shelly.call("KVS.Get", { key: KVS_KEY }, function (res, err, msg) {
        if (res && typeof res.value === "string") {
            store = JSON.parse(res.value);
            log("KVS " + KVS_KEY + " found: " + res.value);
        } else {
            log("KVS " + KVS_KEY + " not found, first start");
            store.first_ts = nowUnix();
        }
        store.starts++;
        applyStore();
        saveStore();
        emit("start", { reason: "proto", starts: store.starts, version: VERSION });
        log("start number " + store.starts);
        Timer.set(10000, true, onTick);
    });
}

start();
