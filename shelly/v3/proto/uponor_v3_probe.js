/*
 * Uponor Clean v3 - probe (test part A)
 *
 * Runs next to the v2.4 script and creates no virtual components, so it can
 * be started at any time. It checks the firmware features v3 relies on:
 * time and time zone, KVS, events to another script, the HTTP endpoint,
 * memory use and the EM1Data history (gaps show earlier reboots).
 * Stop and delete it after about 3 minutes.
 */

let TAG = "[uc-probe] ";
let KVS_KEY = "uc_probe";
let count = 0;
let endpoint = "";

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

function memLine() {
    let st = Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId());
    if (!st) return "mem n/a";
    return "mem_used " + st.mem_used + ", mem_peak " + st.mem_peak + ", mem_free " + st.mem_free;
}

function probe() {
    let di = Shelly.getDeviceInfo();
    log("device " + di.id + ", model " + di.model + ", fw " + di.ver + " (" + di.fw_id + ")");
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
    log("em1:0 status: " + JSON.stringify(Shelly.getComponentStatus("em1:0")));
    log("em1data:0 status: " + JSON.stringify(Shelly.getComponentStatus("em1data:0")));
    log(memLine());
}

function checkKvs() {
    Shelly.call("KVS.Get", { key: KVS_KEY }, function (res, err, msg) {
        let st = { starts: 0 };
        if (res && typeof res.value === "string") {
            st = JSON.parse(res.value);
            log("KVS " + KVS_KEY + " found: " + res.value);
        } else {
            log("KVS " + KVS_KEY + " not found (" + err + "), first start");
        }
        st.starts++;
        st.last = nowUnix();
        Shelly.call("KVS.Set", { key: KVS_KEY, value: JSON.stringify(st) }, function (r2, e2, m2) {
            log(e2 ? "KVS.Set failed: " + e2 + " " + m2 : "KVS.Set ok, start number " + st.starts);
        });
    });
}

function checkEm1Data() {
    let now = nowUnix();
    if (now === null) {
        log("EM1Data check skipped: time not synced");
        return;
    }
    Shelly.call("EM1Data.GetRecords", { id: 0, ts: now - 86400 }, function (res, err, msg) {
        if (err || !res) {
            log("EM1Data.GetRecords failed: " + err + " " + msg);
            return;
        }
        let b = res.data_blocks || [];
        log("EM1Data blocks in last 24 h: " + b.length + " (a new block starts after each gap)");
        for (let i = 0; i < b.length && i < 20; i++) {
            log("  block " + isoLocal(b[i].ts) + ", period " + b[i].period + " s, records " + b[i].records +
                ", ends " + isoLocal(b[i].ts + b[i].period * b[i].records));
        }
    });
}

function registerEndpoint() {
    if (typeof HTTPServer === "undefined") {
        log("HTTPServer not available");
        return;
    }
    endpoint = HTTPServer.registerEndpoint("probe", function (req, res) {
        res.code = 200;
        res.headers = [["Content-Type", "application/json"]];
        res.body = JSON.stringify({ probe: true, events: count, time: isoLocal(nowUnix()), mem: memLine() });
        res.send();
    });
    let w = Shelly.getComponentStatus("wifi");
    log("endpoint: http://" + (w && w.sta_ip ? w.sta_ip : "<shelly-ip>") + endpoint);
}

probe();
checkKvs();
checkEm1Data();
registerEndpoint();
Timer.set(15000, true, function () {
    count++;
    Shelly.emitEvent("uponor", { v: 1, type: "probe", n: count, ts: nowUnix() });
    if (count % 4 === 0) log(memLine());
});
