/*
 * Uponor Clean v3 - migration tool for virtual components
 *
 * Backs up the manually created virtual components (v2.4), deletes them to
 * free the slots for v3, and restores them with the same IDs for a rollback.
 * The backup lives in this script's own Script.storage, so DO NOT DELETE THIS
 * SCRIPT until the migration is finished. The backup is also printed to the
 * console; copy it to a text file as a second copy.
 *
 * Usage: set MODE below, save, start the script, read the console.
 *   "show"    - list the current virtual components and the stored backup
 *   "backup"  - store all manually created virtual components (not owned by a script)
 *   "delete"  - delete the components listed in the backup (requires a backup)
 *   "restore" - recreate the components from the backup with the same IDs,
 *               restore their values and group members
 */

let MODE = "show";

let TOOL = "[uc-tools] ";
let MAX_ITEM = 1000;   // Script.storage value limit is 1024 bytes

function log(s) {
    print(TOOL + s);
}

// Runs RPC calls one at a time (scripts may have at most 5 calls in flight).
function runSequence(list, done) {
    let i = 0;
    let failed = 0;
    function next() {
        if (i >= list.length) {
            log("Done: " + list.length + " calls, " + failed + " failed.");
            if (done) done(failed);
            return;
        }
        let it = list[i];
        i++;
        Shelly.call(it.m, it.p, function (res, err, msg) {
            if (err) {
                failed++;
                log("FAILED " + it.m + " " + JSON.stringify(it.p) + " -> " + err + " " + msg);
            } else {
                log("ok " + it.m + " " + (it.p.key || it.p.type || "") + " " + (it.p.id !== undefined ? it.p.id : ""));
            }
            next();
        });
    }
    next();
}

// Reads all dynamic components, following the paging of Shelly.GetComponents.
function readComponents(cb) {
    let all = [];
    function page(offset) {
        Shelly.call("Shelly.GetComponents",
            { dynamic_only: true, include: ["config", "status"], offset: offset },
            function (res, err, msg) {
                if (err || !res) {
                    log("Shelly.GetComponents failed: " + err + " " + msg);
                    cb(null);
                    return;
                }
                let list = res.components || [];
                for (let k = 0; k < list.length; k++) all.push(list[k]);
                if (list.length > 0 && all.length < res.total) {
                    page(all.length);
                } else {
                    cb(all);
                }
            });
    }
    page(0);
}

function typeOf(key) {
    return key.split(":")[0];
}

function idOf(key) {
    return Number(key.split(":")[1]);
}

function isVirtualType(t) {
    return t === "boolean" || t === "number" || t === "text" ||
        t === "enum" || t === "group" || t === "button";
}

function ownerOf(c) {
    if (c.attrs && c.attrs.owner) return c.attrs.owner;
    return "";
}

function storedCount() {
    let n = Script.storage.getItem("n");
    if (typeof n !== "string") return 0;
    return Number(n);
}

function readBackup() {
    let n = storedCount();
    let recs = [];
    for (let i = 0; i < n; i++) {
        let s = Script.storage.getItem("c" + i);
        if (typeof s !== "string") {
            log("Backup item c" + i + " missing.");
            return null;
        }
        recs.push(JSON.parse(s));
    }
    return recs;
}

function showCurrent(all) {
    log("Current dynamic components: " + all.length);
    for (let i = 0; i < all.length; i++) {
        let c = all[i];
        let name = c.config && c.config.name ? c.config.name : "";
        let own = ownerOf(c);
        log("  " + c.key + "  " + JSON.stringify(name) + (own ? "  owner=" + own : ""));
    }
}

function doShow() {
    readComponents(function (all) {
        if (all) showCurrent(all);
        let recs = readBackup();
        if (!recs || recs.length === 0) {
            log("No backup stored.");
            return;
        }
        log("Stored backup: " + recs.length + " components, taken " + Script.storage.getItem("t"));
        for (let i = 0; i < recs.length; i++) {
            log("  " + recs[i].k + "  " + JSON.stringify(recs[i].c.name || ""));
        }
    });
}

function doBackup() {
    readComponents(function (all) {
        if (!all) return;
        showCurrent(all);
        let recs = [];
        for (let i = 0; i < all.length; i++) {
            let c = all[i];
            let t = typeOf(c.key);
            if (!isVirtualType(t)) continue;
            if (ownerOf(c) !== "") continue;   // owned by a script or service
            let cfg = c.config || {};
            let copy = {};
            let keys = Object.keys(cfg);
            for (let j = 0; j < keys.length; j++) {
                if (keys[j] !== "id") copy[keys[j]] = cfg[keys[j]];
            }
            let rec = { k: c.key, c: copy };
            if (c.status && c.status.value !== undefined) {
                if (t === "group") rec.m = c.status.value;
                else if (t !== "button") rec.v = c.status.value;
            }
            recs.push(rec);
        }
        if (recs.length === 0) {
            log("Nothing to back up.");
            return;
        }
        if (recs.length > 10) {
            log("Too many components for Script.storage (" + recs.length + "). Nothing stored.");
            return;
        }
        for (let i = 0; i < recs.length; i++) {
            let s = JSON.stringify(recs[i]);
            if (s.length > MAX_ITEM) {
                log("Component " + recs[i].k + " config is " + s.length + " bytes, too long. Nothing stored.");
                return;
            }
        }
        // Old items beyond the new count are ignored, because "n" tells the count.
        for (let i = 0; i < recs.length; i++) {
            let s = JSON.stringify(recs[i]);
            Script.storage.setItem("c" + i, s);
            print("BACKUP " + s);
        }
        let st = Shelly.getComponentStatus("sys");
        Script.storage.setItem("t", st && st.unixtime ? String(st.unixtime) : "unknown");
        Script.storage.setItem("n", String(recs.length));
        log("Backup stored: " + recs.length + " components. Copy the BACKUP lines above to a text file.");
    });
}

function doDelete() {
    let recs = readBackup();
    if (!recs || recs.length === 0) {
        log("No backup stored. Run MODE = \"backup\" first.");
        return;
    }
    let list = [];
    // groups first, then members
    for (let i = 0; i < recs.length; i++) {
        if (typeOf(recs[i].k) === "group") list.push({ m: "Virtual.Delete", p: { key: recs[i].k } });
    }
    for (let i = 0; i < recs.length; i++) {
        if (typeOf(recs[i].k) !== "group") list.push({ m: "Virtual.Delete", p: { key: recs[i].k } });
    }
    log("Deleting " + list.length + " components listed in the backup.");
    runSequence(list, function () {
        readComponents(function (all) { if (all) showCurrent(all); });
    });
}

function setMethod(t) {
    if (t === "boolean") return "Boolean.Set";
    if (t === "number") return "Number.Set";
    if (t === "text") return "Text.Set";
    if (t === "enum") return "Enum.Set";
    return "";
}

function doRestore() {
    let recs = readBackup();
    if (!recs || recs.length === 0) {
        log("No backup stored.");
        return;
    }
    let list = [];
    for (let i = 0; i < recs.length; i++) {
        let t = typeOf(recs[i].k);
        if (t === "group") continue;
        list.push({ m: "Virtual.Add", p: { type: t, id: idOf(recs[i].k), config: recs[i].c } });
    }
    for (let i = 0; i < recs.length; i++) {
        let t = typeOf(recs[i].k);
        if (t !== "group") continue;
        list.push({ m: "Virtual.Add", p: { type: t, id: idOf(recs[i].k), config: recs[i].c } });
    }
    for (let i = 0; i < recs.length; i++) {
        let t = typeOf(recs[i].k);
        let m = setMethod(t);
        if (m !== "" && recs[i].v !== undefined && recs[i].v !== null) {
            list.push({ m: m, p: { id: idOf(recs[i].k), value: recs[i].v } });
        }
        if (t === "group" && recs[i].m) {
            list.push({ m: "Group.Set", p: { id: idOf(recs[i].k), value: recs[i].m } });
        }
    }
    log("Restoring " + recs.length + " components with " + list.length + " calls.");
    runSequence(list, function () {
        readComponents(function (all) { if (all) showCurrent(all); });
    });
}

log("Mode: " + MODE);
if (MODE === "backup") doBackup();
else if (MODE === "delete") doDelete();
else if (MODE === "restore") doRestore();
else doShow();
