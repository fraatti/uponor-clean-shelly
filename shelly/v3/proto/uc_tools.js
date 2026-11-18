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

let failedCalls = 0;

// One RPC call; the next step starts from its callback, so at most one call
// is in flight and only one backup record is in memory at a time.
function callOne(m, p, next) {
    Shelly.call(m, p, function (res, err, msg) {
        let what = m + " " + (p.key || p.type || "") + " " + (p.id !== undefined ? p.id : "");
        if (err) {
            failedCalls++;
            log("FAILED " + what + " -> " + err + " " + msg);
        } else {
            log("ok " + what);
        }
        next();
    });
}

// Lists the keys of all dynamic components (small responses, follows paging).
function listKeys(cb) {
    let keys = [];
    function page(offset) {
        Shelly.call("Shelly.GetComponents", { dynamic_only: true, offset: offset }, function (res, err, msg) {
            if (err || !res) {
                log("Shelly.GetComponents failed: " + err + " " + msg);
                cb(null);
                return;
            }
            let list = res.components || [];
            for (let k = 0; k < list.length; k++) {
                keys.push({ key: list[k].key, owner: (list[k].attrs && list[k].attrs.owner) ? list[k].attrs.owner : "" });
            }
            if (list.length > 0 && keys.length < res.total) page(keys.length);
            else cb(keys);
        });
    }
    page(0);
}

// Reads one component at a time to keep the script's memory use small
// (a single response with all configs runs a script out of memory).
function eachComponent(keys, fn, done) {
    let i = 0;
    function next() {
        if (i >= keys.length) {
            if (done) done();
            return;
        }
        let k = keys[i];
        i++;
        Shelly.call("Shelly.GetComponents", { keys: [k.key], include: ["config", "status"] }, function (res, err, msg) {
            let c = (res && res.components && res.components.length) ? res.components[0] : null;
            if (err || !c) log("read " + k.key + " failed: " + err + " " + msg);
            else fn(c, k.owner);
            next();
        });
    }
    next();
}

function showCurrent(cb) {
    listKeys(function (keys) {
        if (!keys) { if (cb) cb(); return; }
        log("Current dynamic components: " + keys.length);
        for (let i = 0; i < keys.length; i++) {
            log("  " + keys[i].key + (keys[i].owner ? "  owner=" + keys[i].owner : ""));
        }
        if (cb) cb();
    });
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

function storedCount() {
    let n = Script.storage.getItem("n");
    if (typeof n !== "string") return 0;
    return Number(n);
}

function doShow() {
    showCurrent(function () {
        let n = storedCount();
        if (n === 0) {
            log("No backup stored.");
            return;
        }
        log("Stored backup: " + n + " components, taken " + Script.storage.getItem("t"));
        for (let i = 0; i < n; i++) {
            let r = storedRec(i);
            log("  " + (r ? r.k + "  " + JSON.stringify(r.c.name || "") : "c" + i + " missing"));
        }
    });
}

function doBackup() {
    listKeys(function (keys) {
        if (!keys) return;
        let todo = [];
        for (let i = 0; i < keys.length; i++) {
            if (!isVirtualType(typeOf(keys[i].key))) continue;
            if (keys[i].owner !== "") continue;   // owned by a script or service
            todo.push(keys[i]);
        }
        if (todo.length === 0) {
            log("Nothing to back up.");
            return;
        }
        if (todo.length > 10) {
            log("Too many components for Script.storage (" + todo.length + "). Nothing stored.");
            return;
        }
        let n = 0;
        let bad = false;
        eachComponent(todo, function (c) {
            let t = typeOf(c.key);
            let cfg = c.config || {};
            let copy = {};
            let ks = Object.keys(cfg);
            for (let j = 0; j < ks.length; j++) {
                if (ks[j] !== "id") copy[ks[j]] = cfg[ks[j]];
            }
            let rec = { k: c.key, c: copy };
            if (c.status && c.status.value !== undefined) {
                if (t === "group") rec.m = c.status.value;
                else if (t !== "button") rec.v = c.status.value;
            }
            let s = JSON.stringify(rec);
            if (s.length > MAX_ITEM) {
                log("Component " + c.key + " config is " + s.length + " bytes, too long.");
                bad = true;
                return;
            }
            Script.storage.setItem("c" + n, s);
            n++;
            print("BACKUP " + s);
        }, function () {
            if (bad || n !== todo.length) {
                Script.storage.setItem("n", "0");
                log("Backup FAILED: " + n + " of " + todo.length + " stored. Nothing will be deleted.");
                return;
            }
            let st = Shelly.getComponentStatus("sys");
            Script.storage.setItem("t", st && st.unixtime ? String(st.unixtime) : "unknown");
            Script.storage.setItem("n", String(n));
            log("Backup stored: " + n + " components. Copy the BACKUP lines above to a text file.");
        });
    });
}

function storedRec(i) {
    let s = Script.storage.getItem("c" + i);
    if (typeof s !== "string") return null;
    return JSON.parse(s);
}

function setMethod(t) {
    if (t === "boolean") return "Boolean.Set";
    if (t === "number") return "Number.Set";
    if (t === "text") return "Text.Set";
    if (t === "enum") return "Enum.Set";
    return "";
}

function deleteWanted(pass, r) {
    let isGroup = typeOf(r.k) === "group";
    return (pass === "g" && isGroup) || (pass === "o" && !isGroup);
}

// pass "g": delete groups, pass "o": delete the other components.
// Skips records in a loop (no recursion) and makes one call at a time.
function deletePass(pass, i, done) {
    let n = storedCount();
    let r = null;
    while (i < n) {
        r = storedRec(i);
        if (r && deleteWanted(pass, r)) break;
        r = null;
        i++;
    }
    if (!r) {
        done();
        return;
    }
    let next = i + 1;
    callOne("Virtual.Delete", { key: r.k }, function () { deletePass(pass, next, done); });
}

function doDelete() {
    let n = storedCount();
    if (n === 0) {
        log("No backup stored. Run MODE = \"backup\" first.");
        return;
    }
    for (let i = 0; i < n; i++) {
        if (typeof Script.storage.getItem("c" + i) !== "string") {
            log("Backup item c" + i + " missing. Nothing deleted.");
            return;
        }
    }
    log("Deleting " + n + " components listed in the backup.");
    deletePass("g", 0, function () {
        deletePass("o", 0, function () {
            log("Done, " + failedCalls + " failed.");
            showCurrent();
        });
    });
}

// pass 1: add components, pass 2: add groups, pass 3: restore values and group members
function restoreCall(pass, r) {
    let t = typeOf(r.k);
    let id = idOf(r.k);
    if (pass === 1 && t !== "group") return { m: "Virtual.Add", p: { type: t, id: id, config: r.c } };
    if (pass === 2 && t === "group") return { m: "Virtual.Add", p: { type: t, id: id, config: r.c } };
    if (pass === 3 && setMethod(t) !== "" && r.v !== undefined && r.v !== null) return { m: setMethod(t), p: { id: id, value: r.v } };
    if (pass === 3 && t === "group" && r.m) return { m: "Group.Set", p: { id: id, value: r.m } };
    return null;
}

function restorePass(pass, i, done) {
    let n = storedCount();
    let c = null;
    while (i < n) {
        let r = storedRec(i);
        if (r) c = restoreCall(pass, r);
        if (c) break;
        i++;
    }
    if (!c) {
        done();
        return;
    }
    let next = i + 1;
    callOne(c.m, c.p, function () { restorePass(pass, next, done); });
}

function doRestore() {
    let n = storedCount();
    if (n === 0) {
        log("No backup stored.");
        return;
    }
    log("Restoring " + n + " components.");
    restorePass(1, 0, function () {
        restorePass(2, 0, function () {
            restorePass(3, 0, function () {
                log("Done, " + failedCalls + " failed.");
                showCurrent();
            });
        });
    });
}

// Started from a timer so that the work does not run inside the initial file execution.
Timer.set(200, false, function () {
    log("Mode: " + MODE);
    if (MODE === "backup") doBackup();
    else if (MODE === "delete") doDelete();
    else if (MODE === "restore") doRestore();
    else doShow();
});
