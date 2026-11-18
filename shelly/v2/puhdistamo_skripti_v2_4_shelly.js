// Uponor Clean -prosessin tunnistus Shellylle, versio 2.4 (tiivistetty: kommentit ja sisennykset poistettu). Kommentoitu versio: puhdistamo_skripti_v2_4.js, dokumentaatio: uponor_shelly_dokumentaatio.md
// Paluu version 2.3 toimintaan: aseta CONFIG-kohdan v24_*-kytkimet arvoon false (kaikki tai yksittainen).
let CONFIG = {
vc_pump_in: 201,
vc_pump_out: 202,
vc_sludge_removal: 203,
vc_dosing: 204,
vc_aeration: 205,
vc_batch_counter: 200,
vc_cycle_status: 200,
vc_normalized_consumption: 201,
vc_process_message: 200,
nominal_voltage: 230,
vc_maintenance: null,
maintenance_text: "Holiday automation",
fault_high_text: "Warning: high power, check air hoses and compressor",
fault_off_text: "Warning: no power, check plant supply",
fault_idle_text: "Warning: compressor not running",
v24_trip_eta: true,
v24_pumpout_780: true,
v24_waiting_status: true,
v24_fast_holiday: true,
v24_process_warnings: true,
v24_restart_batch: true,
high_water_text: "Warning: high water",
outlet_blocked_text: "Warning: outlet blocked?"
};
let LIMITS = {
idle_power: 4.0,
idle_max: 10.0,
valve_min: 10.0,
valve_max: 24.0,
dosing_comp_min: 24.0,
dosing_comp_max: 38.5,
comp_min: 38.5,
comp_max: 52.0,
aeration_min: 52.0,
aeration_max: 64.0,
boost_min: 64.0,
pumpin_peak_min: 60.0,
fault_high_power_w: 62.0,
fault_off_power_w: 2.0
};
let TIME = {
debounce_s: 3,
settling_confirm_s: 10,
aeration_confirm_s: 10,
dosing_confirm_s: 8,
discharge_count_min_s: 600,
ambiguous_sludge_confirm_s: 45,
pumpout_after_final_sludge_settling_s: 885,
pumpout_detect_tolerance_s: 45,
discharge_reclassify_s: 20,
two_peak_to_pumpout_s: 10000,
three_peak_to_pumpout_s: 10000,
pumpout_eta_overdue_clear_s: 600,
pumpin_peak_interval_min_s: 80,
pumpin_peak_interval_max_s: 160,
pumpin_pattern_reset_s: 300,
pumpin_min_accepted_peaks: 2,
pumpin_max_accepted_peaks: 3,
pumpin_wait_aeration_after_last_peak_max_s: 240,
kohta1_dosing_valve_to_pumpout_s: 3936,
kohta1_short_aeration_to_pumpout_s: 3835,
kohta1_long_settling_to_pumpout_s: 3712,
kohta1_sludge_to_pumpout_s: 1018,
kohta1_final_settling_to_pumpout_s: 890,
startup_unknown_min_s: 15,
startup_aeration_confirm_s: 20,
startup_comp45_confirm_s: 125,
power_signal_timeout_s: 600,
long_signal_gap_reset_s: 900,
rpc_max_retries: 3,
rpc_timeout_s: 5,
force_resync_interval_s: 300,
maintenance_settling_detect_s: 4800,
maintenance_exit_aeration_s: 1200,
fault_high_power_s: 120,
fault_off_power_s: 60,
fault_no_activity_s: 14400,
fault_clear_s: 60,
trip_to_pumpout_s: 9950,
pumpout_fixed_s: 790,
holiday_wait_detect_s: 1200,
restart_aeration_s: 1860,
full_aeration_min_s: 5700,
holiday_after_batch_s: 252000,
transient_status_s: 45
};
let batch_counter = 0;
let process_message = "-";
let last_batch_message = "-";
let kvs_batch_loaded = false;
let kvs_message_loaded = false;
let system_ready = false;
let main_timer_started = false;
let detected_comp = null;
let latest_power = null;
let latest_voltage = null;
let latest_power_time = 0;
let voltage_fallback_logged = false;
let raw_band = "UNKNOWN";
let candidate_band = "UNKNOWN";
let candidate_seconds = 0;
let stable_band = "UNKNOWN";
let stable_band_seconds = 0;
let cycle_status = "Settling";
let reported_status = "Unknown";
let startup_unknown = true;
let startup_seconds = 0;
let settling_seconds = 0;
let discharge_expected = false;
let pumping_phase_seconds = 0;
let discharge_seconds = 0;
let discharge_counted = false;
let sequence_phase = "UNKNOWN";
let pumpout_eta_active = false;
let pumpout_eta_s = null;
let pumpout_eta_overdue_s = 0;
let last_pumpout_eta_text = "";
let comp45_ambiguous = false;
let comp45_ambiguous_seconds = 0;
let comp45_ambiguous_as_sludge = false;
let pumpin_pattern_active = false;
let pumpin_peak_count = 0;
let pumpin_last_peak_ms = 0;
let pumpin_last_is_peak = false;
let pumpin_pattern_started_from_aeration = false;
let pumpin_peak_pending = false;
let pumpin_pending_peak_count = 0;
let pumpin_pending_last_peak_ms = 0;
let pumpin_pattern_saved_sequence_phase = null;
let LAST_STATE = {
pin: null, pout: null, sludge: null, dosing: null, aeration: null, status_key: null, p_norm: null, batch_counter: null, process_message: null, maintenance: null
};
let PENDING_STATE = {
pin: null, pout: null, sludge: null, dosing: null, aeration: null, status_key: null, p_norm: null, batch_counter: null, process_message: null, maintenance: null
};
let cmd_queue = [];
let q_read = 0;
let q_write = 0;
let rpc_busy = false;
let rpc_current_task = null;
let rpc_current_token = 0;
let rpc_started_ms = 0;
let last_force_resync_ms = 0;
let maintenance_mode = false;
let power_fault_text = "";
let fault_high_s = 0;
let fault_off_s = 0;
let fault_idle_s = 0;
let fault_ok_s = 0;
let waiting_enum_ok = false;
let process_warning = "";
let prev_stable_band = "UNKNOWN";
let aeration_from_idle = false;
let batch_aeration = false;
let last_aeration_s = 0;
let fill_long_boost = false;
let fill_seen_boost = false;
let status_since_ms = 0;
let last_long_status = "";
let last_batch_ms = 0;
function statusToEnumKey(status) {
if (status === "Unknown") return "U";
if (status === "Tank Filling") return "F";
if (status === "Aeration") return "A";
if (status === "Chemical Dosing") return "C";
if (status === "Settling") return "S";
if (status === "Sludge Return") return "R";
if (status === "Treated Water Discharge") return "D";
return "U";
}
function shownMessage() {
if (!CONFIG.v24_process_warnings || process_warning === "") return process_message;
if (process_message.indexOf("Warning:") === 0) return process_message;
if (process_message === "-" || process_message === "") return process_warning;
return process_message + " | " + process_warning;
}
function pushShownMessage() {
let m = shownMessage();
queueSet("Text.set", { id: CONFIG.vc_process_message, value: m }, "process_message", m);
}
function setProcessWarning(text, reason) {
if (!CONFIG.v24_process_warnings) return;
if (process_warning === text) return;
process_warning = text;
print("PROCESS WARNING: " + (text === "" ? "cleared" : text) + " (" + reason + ")");
pushShownMessage();
}
function isWaitingContext() {
if (sequence_phase === "UNKNOWN") return false;
if (sequence_phase.indexOf("KOHTA1") === 0) return false;
return true;
}
function parseLastBatchMs(msg) {
if (!isLastBatchMessage(msg) || msg.length < 25) return 0;
let d = msg.substr(6, 19);
let t = new Date(parseInt(d.substr(6, 4), 10), parseInt(d.substr(3, 2), 10) - 1, parseInt(d.substr(0, 2), 10), parseInt(d.substr(11, 2), 10), parseInt(d.substr(14, 2), 10), parseInt(d.substr(17, 2), 10)).getTime();
if (isNaN(t)) return 0;
return t;
}
function onBatchStart(elapsed_s, source) {
sequence_phase = "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED";
discharge_expected = false;
batch_aeration = true;
resetPumpinPattern();
setPumpoutEta(TIME.trip_to_pumpout_s - elapsed_s, source);
setProcessWarning("", "batch started normally");
}
function isUnknownProcessMessage(msg) {
if (typeof msg !== "string") return false;
if (msg.indexOf("Unknown") === 0) return true;
if (msg.indexOf("unknown") === 0) return true;
return false;
}
function isLastBatchMessage(msg) {
if (typeof msg !== "string") return false;
if (msg.indexOf("Last: ") === 0) return true;
return false;
}
function canShowDischargeMessage() {
if (cycle_status !== "Treated Water Discharge") return false;
if (discharge_counted) return false;
return true;
}
function clearPendingIfMatches(state_key, state_value) {
if (state_key === null || state_key === undefined) return;
if (PENDING_STATE[state_key] === state_value) {
PENDING_STATE[state_key] = null;
}
}
function updatePendingTask(method, params, callback, state_key, state_value) {
let i = q_write - 1;
while (i >= q_read) {
if (cmd_queue[i] !== null &&
cmd_queue[i] !== undefined &&
cmd_queue[i].state_key === state_key) {
cmd_queue[i].m = method;
cmd_queue[i].p = params;
cmd_queue[i].cb = callback;
cmd_queue[i].state_value = state_value;
cmd_queue[i].tries = 0;
PENDING_STATE[state_key] = state_value;
return true;
}
i = i - 1;
}
return false;
}
function queueRpc(method, params, callback, state_key, state_value) {
cmd_queue[q_write] = {
m: method, p: params, cb: callback, state_key: state_key, state_value: state_value, tries: 0
};
q_write = q_write + 1;
}
function queueSet(method, params, state_key, state_value) {
if (LAST_STATE[state_key] === state_value) return;
if (PENDING_STATE[state_key] === state_value) return;
if (PENDING_STATE[state_key] !== null) {
if (updatePendingTask(method, params, null, state_key, state_value)) return;
}
PENDING_STATE[state_key] = state_value;
queueRpc(method, params, null, state_key, state_value);
}
function queueKvsSet(key, value) {
queueRpc("KVS.Set", {
key: key, value: JSON.stringify(value)
}, null, null, null);
}
function finalizeQueuePointersIfEmpty() {
if (q_read === q_write) {
cmd_queue = [];
q_read = 0;
q_write = 0;
}
}
function requeueOrFailTask(task, reason) {
task.tries = task.tries + 1;
if (task.tries < TIME.rpc_max_retries) {
print("RPC RETRY: " + task.m + " reason=" + reason + " try=" + task.tries);
cmd_queue[q_write] = task;
q_write = q_write + 1;
} else {
print("RPC FAIL: " + task.m + " " + JSON.stringify(task.p) + " reason=" + reason);
clearPendingIfMatches(task.state_key, task.state_value);
if (task.cb !== null && task.cb !== undefined) {
task.cb(null, -1, reason);
}
}
}
Timer.set(100, true, function () {
let now_ms = (new Date()).getTime();
if (rpc_busy) {
if (rpc_started_ms > 0 &&
now_ms - rpc_started_ms > TIME.rpc_timeout_s * 1000) {
let timed_out_task = rpc_current_task;
print("RPC TIMEOUT: " + timed_out_task.m + " " + JSON.stringify(timed_out_task.p));
rpc_current_token = rpc_current_token + 1;
rpc_busy = false;
rpc_current_task = null;
rpc_started_ms = 0;
requeueOrFailTask(timed_out_task, "timeout");
}
return;
}
if (q_read >= q_write) return;
let task = cmd_queue[q_read];
cmd_queue[q_read] = null;
q_read = q_read + 1;
finalizeQueuePointersIfEmpty();
if (task === null || task === undefined) return;
rpc_busy = true;
rpc_current_task = task;
rpc_started_ms = now_ms;
rpc_current_token = rpc_current_token + 1;
let my_token = rpc_current_token;
Shelly.call(task.m, task.p, function (res, err_code, err_msg) {
if (my_token !== rpc_current_token) {
return;
}
rpc_busy = false;
rpc_current_task = null;
rpc_started_ms = 0;
let has_error = false;
if (err_code !== undefined && err_code !== null && err_code !== 0) {
has_error = true;
}
if (has_error) {
print("RPC ERR: " + task.m + " " + JSON.stringify(task.p) +
" code=" + err_code + " msg=" + err_msg);
requeueOrFailTask(task, "err=" + err_code + " msg=" + err_msg);
return;
}
if (task.state_key !== null && task.state_key !== undefined) {
LAST_STATE[task.state_key] = task.state_value;
clearPendingIfMatches(task.state_key, task.state_value);
}
if (task.cb !== null && task.cb !== undefined) {
task.cb(res, err_code, err_msg);
}
});
});
function resetPumpinPattern() {
if (pumpin_pattern_saved_sequence_phase !== null &&
sequence_phase === "KOHTA1_PEAK_PATTERN_WAIT_AERATION") {
sequence_phase = pumpin_pattern_saved_sequence_phase;
}
pumpin_pattern_saved_sequence_phase = null;
pumpin_pattern_active = false;
pumpin_peak_count = 0;
pumpin_last_peak_ms = 0;
pumpin_last_is_peak = false;
pumpin_pattern_started_from_aeration = false;
pumpin_peak_pending = false;
pumpin_pending_peak_count = 0;
pumpin_pending_last_peak_ms = 0;
}
function stopPumpoutEta() {
pumpout_eta_active = false;
pumpout_eta_s = null;
pumpout_eta_overdue_s = 0;
last_pumpout_eta_text = "";
}
function clearComp45Ambiguous() {
comp45_ambiguous = false;
comp45_ambiguous_seconds = 0;
comp45_ambiguous_as_sludge = false;
}
function resetPumpingCounters() {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
}
function resetProcessContextAfterLongGap(reason, gap_s) {
print("LONG GAP RESET: " + reason + " gap=" + gap_s + " s");
raw_band = "UNKNOWN";
candidate_band = "UNKNOWN";
candidate_seconds = 0;
stable_band = "UNKNOWN";
stable_band_seconds = 0;
cycle_status = "Settling";
reported_status = "Unknown";
startup_unknown = true;
startup_seconds = 0;
settling_seconds = 0;
discharge_expected = false;
resetPumpingCounters();
sequence_phase = "UNKNOWN";
stopPumpoutEta();
clearComp45Ambiguous();
resetPumpinPattern();
exitMaintenanceMode("long signal gap");
clearTransientProcessMessage();
}
function updateLatestPowerFromStatus(status) {
if (!status) return;
let changed = false;
if (status.act_power !== undefined) {
latest_power = status.act_power;
changed = true;
} else if (status.apower !== undefined) {
latest_power = status.apower;
changed = true;
}
if (status.voltage !== undefined) {
latest_voltage = status.voltage;
changed = true;
}
if (changed) {
let now_ms = (new Date()).getTime();
if (latest_power_time > 0) {
let gap_s = Math.floor((now_ms - latest_power_time) / 1000);
if (gap_s >= TIME.long_signal_gap_reset_s) {
resetProcessContextAfterLongGap("power update gap", gap_s);
}
}
latest_power_time = now_ms;
}
}
function detectPowerComponent() {
if (detected_comp !== null) return detected_comp;
let status = null;
status = Shelly.getComponentStatus("em1:0");
if (status) {
detected_comp = "em1:0";
updateLatestPowerFromStatus(status);
print("Power component: " + detected_comp);
return detected_comp;
}
status = Shelly.getComponentStatus("pm1:0");
if (status) {
detected_comp = "pm1:0";
updateLatestPowerFromStatus(status);
print("Power component: " + detected_comp);
return detected_comp;
}
status = Shelly.getComponentStatus("switch:0");
if (status) {
detected_comp = "switch:0";
updateLatestPowerFromStatus(status);
print("Power component: " + detected_comp);
return detected_comp;
}
return null;
}
Shelly.addStatusHandler(function (event) {
if (!event) return;
if (detected_comp === null) return;
if (event.component !== detected_comp) return;
if (event.delta !== undefined && event.delta !== null) {
updateLatestPowerFromStatus(event.delta);
}
if (event.status !== undefined && event.status !== null) {
updateLatestPowerFromStatus(event.status);
}
});
function safeJsonParse(value, default_value) {
try {
if (value === undefined || value === null) return default_value;
return JSON.parse(value);
} catch (e) {
print("JSON parse error, using default.");
return default_value;
}
}
function checkSystemReady() {
if (system_ready) return;
if (kvs_batch_loaded && kvs_message_loaded) {
system_ready = true;
queueSet("Number.set", { id: CONFIG.vc_batch_counter, value: batch_counter }, "batch_counter", batch_counter);
pushShownMessage();
print("System ready. Batch: " + batch_counter + " Msg: " + process_message);
startMainTimer();
}
}
queueRpc("KVS.Get", { key: "puhdistamo_batch_count" }, function (res, err_code, err_msg) {
if (res && res.value !== undefined) {
let loaded_batch = safeJsonParse(res.value, 0);
if (typeof loaded_batch === "number" && loaded_batch >= 0) {
batch_counter = Math.floor(loaded_batch);
} else {
batch_counter = 0;
print("Invalid batch value in KVS, start 0.");
}
print("Batch loaded: " + batch_counter);
} else {
let vc_batch = Shelly.getComponentStatus("number:" + CONFIG.vc_batch_counter);
if (vc_batch && typeof vc_batch.value === "number" && vc_batch.value >= 0) {
batch_counter = Math.floor(vc_batch.value);
print("Batch not in KVS, using virtual component value: " + batch_counter);
} else {
batch_counter = 0;
print("Batch not found, start 0.");
}
}
kvs_batch_loaded = true;
checkSystemReady();
}, null, null);
queueRpc("KVS.Get", { key: "puhdistamo_process_message" }, function (res, err_code, err_msg) {
if (res && res.value !== undefined) {
let loaded_message = safeJsonParse(res.value, "-");
if (typeof loaded_message === "string") {
process_message = loaded_message;
} else {
process_message = "-";
print("Invalid process message in KVS, using '-'.");
}
print("Msg loaded: " + process_message);
} else {
let vc_msg = Shelly.getComponentStatus("text:" + CONFIG.vc_process_message);
if (vc_msg && isLastBatchMessage(vc_msg.value)) {
process_message = vc_msg.value;
print("Msg not in KVS, using virtual component value: " + process_message);
} else {
process_message = "-";
print("Msg not found.");
}
}
if (isLastBatchMessage(process_message)) {
last_batch_message = process_message;
last_batch_ms = parseLastBatchMs(process_message);
}
kvs_message_loaded = true;
checkSystemReady();
}, null, null);
if (CONFIG.v24_waiting_status) {
queueRpc("Enum.GetConfig", { id: CONFIG.vc_cycle_status }, function (res, err_code, err_msg) {
if (res && res.options && res.options.indexOf("W") >= 0) {
waiting_enum_ok = true;
print("Enum option W found: waiting periods reported as Waiting.");
} else {
print("Enum option W missing: waiting periods reported as Settling (S).");
}
}, null, null);
}
function normalizePower(p, u) {
let p_norm = p;
let voltage = u;
if (typeof voltage !== "number" || voltage <= 0) {
voltage = CONFIG.nominal_voltage;
if (!voltage_fallback_logged) {
voltage_fallback_logged = true;
print("Voltage unavailable, using " + voltage + " V.");
}
}
if (p > LIMITS.idle_max) {
let v_ratio = CONFIG.nominal_voltage / voltage;
p_norm = (p - LIMITS.idle_power) * v_ratio * v_ratio + LIMITS.idle_power;
}
p_norm = Math.round(p_norm * 10) / 10;
return p_norm;
}
function detectBand(p_norm) {
if (p_norm < LIMITS.idle_max) return "IDLE";
if (p_norm >= LIMITS.valve_min && p_norm <= LIMITS.valve_max) return "VALVE_ONLY";
if (p_norm > LIMITS.dosing_comp_min && p_norm <= LIMITS.dosing_comp_max) return "DOSING_COMP";
if (p_norm > LIMITS.comp_min && p_norm <= LIMITS.comp_max) return "COMP_45";
if (p_norm > LIMITS.aeration_min && p_norm <= LIMITS.aeration_max) return "AERATION";
if (p_norm > LIMITS.boost_min) return "BOOST";
return "UNKNOWN";
}
function isPumpinPeakPower(p_norm) {
return p_norm >= LIMITS.pumpin_peak_min;
}
function isConfirmedAerationBeforePumpinPeak() {
if (cycle_status !== "Aeration") return false;
if (stable_band !== "AERATION") return false;
if (stable_band_seconds < TIME.aeration_confirm_s) return false;
return true;
}
function pad2(n) {
if (n < 10) return "0" + n;
return "" + n;
}
function getDateTimeString() {
let d = new Date();
return pad2(d.getDate()) + "." +
pad2(d.getMonth() + 1) + "." +
d.getFullYear() + " " +
pad2(d.getHours()) + ":" +
pad2(d.getMinutes()) + ":" +
pad2(d.getSeconds());
}
function getIdleProcessMessage() {
if (maintenance_mode) {
if (last_batch_message !== "-") {
return CONFIG.maintenance_text + " | " + last_batch_message;
}
return CONFIG.maintenance_text;
}
return last_batch_message;
}
function restoreLastBatchMessageToText() {
if (power_fault_text !== "") return;
let idle_msg = getIdleProcessMessage();
if (idle_msg === "-" && process_message !== CONFIG.maintenance_text &&
process_message.indexOf(CONFIG.maintenance_text + " | ") !== 0) {
return;
}
if (process_message !== idle_msg) {
process_message = idle_msg;
pushShownMessage();
}
}
function isTransientProcessMessage(msg) {
if (typeof msg !== "string") return false;
if (msg.indexOf("Pump out in") === 0) return true;
if (msg === "Discharge") return true;
if (msg === "Warning: power signal missing") return true;
return false;
}
function clearTransientProcessMessage() {
if (!isTransientProcessMessage(process_message)) return;
if (power_fault_text !== "") {
setProcessMessage(power_fault_text, false);
return;
}
if (getIdleProcessMessage() !== "-") {
restoreLastBatchMessageToText();
} else {
setProcessMessage("-", false);
}
}
function isMaintenanceProcessMessage(msg) {
if (typeof msg !== "string") return false;
if (msg === CONFIG.maintenance_text) return true;
if (msg.indexOf(CONFIG.maintenance_text + " | ") === 0) return true;
return false;
}
function enterMaintenanceMode(reason) {
if (maintenance_mode) return;
maintenance_mode = true;
print("MAINTENANCE MODE ON: " + reason);
if (!pumpout_eta_active && !isTransientProcessMessage(process_message)) {
restoreLastBatchMessageToText();
}
}
function exitMaintenanceMode(reason) {
if (!maintenance_mode) return;
maintenance_mode = false;
print("MAINTENANCE MODE OFF: " + reason);
if (isMaintenanceProcessMessage(process_message)) {
if (last_batch_message !== "-") {
restoreLastBatchMessageToText();
} else {
setProcessMessage("-", false);
}
}
}
function setProcessMessage(msg, save_to_kvs) {
if (isUnknownProcessMessage(msg)) {
print("Process message Unknown blocked: " + msg);
return;
}
if (msg === "Discharge") {
if (!canShowDischargeMessage()) {
restoreLastBatchMessageToText();
return;
}
}
if (isLastBatchMessage(msg)) {
last_batch_message = msg;
}
if (power_fault_text !== "" && msg !== power_fault_text &&
msg.indexOf("Warning:") !== 0) {
if (save_to_kvs !== false && isLastBatchMessage(msg)) {
queueKvsSet("puhdistamo_process_message", msg);
}
return;
}
if (process_message === msg) return;
process_message = msg;
pushShownMessage();
if (save_to_kvs !== false) {
queueKvsSet("puhdistamo_process_message", process_message);
}
}
function saveBatchCounter() {
queueSet("Number.set", { id: CONFIG.vc_batch_counter, value: batch_counter }, "batch_counter", batch_counter);
queueKvsSet("puhdistamo_batch_count", batch_counter);
}
function formatPumpoutEtaMessage(seconds_left) {
if (seconds_left <= 0) {
return "Pump out in 0 s";
}
if (seconds_left < 60) {
if (seconds_left > 50) {
return "Pump out in 1 min";
}
let bucket = Math.ceil(seconds_left / 10) * 10;
if (bucket < 10) bucket = 10;
return "Pump out in " + bucket + " s";
}
return "Pump out in " + Math.ceil(seconds_left / 60) + " min";
}
function updatePumpoutEtaMessage() {
if (!pumpout_eta_active) return;
if (pumpout_eta_s === null) return;
if (cycle_status === "Treated Water Discharge") return;
let msg = formatPumpoutEtaMessage(pumpout_eta_s);
if (msg !== last_pumpout_eta_text) {
last_pumpout_eta_text = msg;
setProcessMessage(msg, false);
}
}
function setPumpoutEta(seconds_left, source) {
if (seconds_left < 0) seconds_left = 0;
exitMaintenanceMode("pump out ETA started: " + source);
pumpout_eta_active = true;
pumpout_eta_s = seconds_left;
pumpout_eta_overdue_s = 0;
last_pumpout_eta_text = "";
updatePumpoutEtaMessage();
print("ETA set: " + seconds_left + " s source=" + source);
}
function tickPumpoutEta() {
if (!pumpout_eta_active) return;
if (pumpout_eta_s === null) return;
if (cycle_status === "Treated Water Discharge") return;
if (pumpout_eta_s > 0) {
pumpout_eta_s = pumpout_eta_s - 1;
pumpout_eta_overdue_s = 0;
updatePumpoutEtaMessage();
return;
}
pumpout_eta_s = 0;
pumpout_eta_overdue_s = pumpout_eta_overdue_s + 1;
updatePumpoutEtaMessage();
if (pumpout_eta_overdue_s >= TIME.pumpout_eta_overdue_clear_s) {
stopPumpoutEta();
if (process_message === "Pump out in 0 s") {
restoreLastBatchMessageToText();
}
print("ETA cleared after overdue timeout.");
}
}
function completeDischargeIfNeeded() {
if (cycle_status !== "Treated Water Discharge") return;
if (discharge_counted) return;
if (discharge_seconds >= TIME.discharge_count_min_s) {
batch_counter = batch_counter + 1;
discharge_counted = true;
last_batch_ms = (new Date()).getTime();
let completed_time = getDateTimeString();
let msg = "Last: " + completed_time;
saveBatchCounter();
setProcessMessage(msg, true);
stopPumpoutEta();
print("BATCH +1: " + batch_counter);
print(msg);
}
}
function startComp45Ambiguous(reason) {
if (comp45_ambiguous) return;
comp45_ambiguous = true;
comp45_ambiguous_seconds = 0;
comp45_ambiguous_as_sludge = false;
resetPumpingCounters();
print("AMBIGUOUS COMP45 START: " + reason);
}
function markAmbiguousComp45AsProbableSludge() {
if (!comp45_ambiguous) return;
if (comp45_ambiguous_as_sludge) return;
comp45_ambiguous_as_sludge = true;
if (cycle_status !== "Sludge Return") {
setCycleStatus("Sludge Return");
}
print("AMBIGUOUS COMP45 -> PROBABLE SLUDGE, seconds=" + comp45_ambiguous_seconds);
}
function finishAmbiguousAsDischarge(reason) {
let carried_seconds = comp45_ambiguous_seconds;
if (carried_seconds < discharge_seconds) {
carried_seconds = discharge_seconds;
}
clearComp45Ambiguous();
setCycleStatus("Treated Water Discharge");
discharge_seconds = carried_seconds;
discharge_counted = false;
setProcessMessage("Discharge", false);
print("AMBIGUOUS COMP45 -> DISCHARGE: " + reason + " carried=" + carried_seconds + " s");
}
function finishAmbiguousAsShortCompressor(reason) {
let carried_seconds = comp45_ambiguous_seconds;
let was_sludge = comp45_ambiguous_as_sludge;
clearComp45Ambiguous();
if (was_sludge) {
print("AMBIGUOUS COMP45 -> SLUDGE COMPLETED: " + reason + " carried=" + carried_seconds + " s");
} else {
print("AMBIGUOUS COMP45 -> SHORT COMPRESSOR: " + reason + " carried=" + carried_seconds + " s");
}
}
function resolveAmbiguousComp45OnBandEnter(new_band) {
if (!comp45_ambiguous) return;
if (new_band === "COMP_45") return;
if (comp45_ambiguous_seconds >= TIME.discharge_count_min_s ||
discharge_seconds >= TIME.discharge_count_min_s) {
finishAmbiguousAsDischarge("exit to " + new_band);
if (new_band === "BOOST" || new_band === "AERATION") {
completeDischargeIfNeeded();
}
return;
}
finishAmbiguousAsShortCompressor("exit to " + new_band);
}
function updatePumpinPeakPattern(p_norm) {
let now_ms = (new Date()).getTime();
let is_peak = isPumpinPeakPower(p_norm);
if (pumpin_peak_pending) {
if (pumpin_pending_last_peak_ms > 0 &&
now_ms - pumpin_pending_last_peak_ms >
TIME.pumpin_wait_aeration_after_last_peak_max_s * 1000) {
print("PUMPIN PEAK CANCEL: Aeration not confirmed after last accepted peak within " +
TIME.pumpin_wait_aeration_after_last_peak_max_s + " s, peaks=" +
pumpin_pending_peak_count);
resetPumpinPattern();
return;
}
if (!is_peak) {
pumpin_last_is_peak = false;
return;
}
if (pumpin_last_is_peak) return;
pumpin_last_is_peak = true;
let interval_s_pending = Math.floor((now_ms - pumpin_pending_last_peak_ms) / 1000);
if (pumpin_pending_peak_count === 2) {
if (interval_s_pending >= TIME.pumpin_peak_interval_min_s &&
interval_s_pending <= TIME.pumpin_peak_interval_max_s) {
pumpin_pending_peak_count = 3;
pumpin_pending_last_peak_ms = now_ms;
print("PUMPIN PEAK PATTERN: 2 peaks upgraded to 3 peaks, interval=" +
interval_s_pending + " p=" + p_norm);
return;
}
if (interval_s_pending < TIME.pumpin_peak_interval_min_s) {
print("PUMPIN PEAK IGNORE: early extra peak after 2 peaks, interval=" +
interval_s_pending + " s p=" + p_norm);
return;
}
print("PUMPIN PEAK CANCEL: late extra peak after 2 peaks, interval=" +
interval_s_pending + " s p=" + p_norm);
resetPumpinPattern();
return;
}
print("PUMPIN PEAK CANCEL: extra peak before confirmed Aeration, peaks=" +
pumpin_pending_peak_count + " p=" + p_norm);
resetPumpinPattern();
return;
}
if (pumpin_pattern_active &&
pumpin_last_peak_ms > 0 &&
now_ms - pumpin_last_peak_ms > TIME.pumpin_pattern_reset_s * 1000) {
print("PUMPIN PATTERN RESET: timeout before accepted pattern, count=" + pumpin_peak_count);
resetPumpinPattern();
}
if (!is_peak) {
pumpin_last_is_peak = false;
return;
}
if (pumpin_last_is_peak) return;
pumpin_last_is_peak = true;
if (!pumpin_pattern_active) {
if (isConfirmedAerationBeforePumpinPeak()) {
pumpin_pattern_active = true;
pumpin_pattern_started_from_aeration = true;
pumpin_peak_count = 1;
pumpin_last_peak_ms = now_ms;
print("PUMPIN PATTERN START from confirmed Aeration peak=1 p=" + p_norm);
}
return;
}
let interval_s = Math.floor((now_ms - pumpin_last_peak_ms) / 1000);
if (interval_s < TIME.pumpin_peak_interval_min_s ||
interval_s > TIME.pumpin_peak_interval_max_s) {
if (isConfirmedAerationBeforePumpinPeak()) {
pumpin_pattern_active = true;
pumpin_pattern_started_from_aeration = true;
pumpin_peak_count = 1;
pumpin_last_peak_ms = now_ms;
pumpin_peak_pending = false;
pumpin_pending_peak_count = 0;
pumpin_pending_last_peak_ms = 0;
print("PUMPIN PATTERN RESTART from confirmed Aeration peak=1 interval=" +
interval_s + " p=" + p_norm);
} else {
print("PUMPIN PATTERN RESET: invalid interval=" +
interval_s + " s count=" + pumpin_peak_count);
resetPumpinPattern();
}
return;
}
pumpin_peak_count = pumpin_peak_count + 1;
pumpin_last_peak_ms = now_ms;
print("PUMPIN PATTERN peak=" + pumpin_peak_count +
" interval=" + interval_s + " p=" + p_norm);
if (pumpin_peak_count >= TIME.pumpin_min_accepted_peaks &&
pumpin_peak_count <= TIME.pumpin_max_accepted_peaks &&
pumpin_pattern_started_from_aeration) {
pumpin_pattern_active = false;
pumpin_peak_pending = true;
pumpin_pending_peak_count = pumpin_peak_count;
pumpin_pending_last_peak_ms = now_ms;
pumpin_pattern_saved_sequence_phase = sequence_phase;
sequence_phase = "KOHTA1_PEAK_PATTERN_WAIT_AERATION";
discharge_expected = false;
startup_unknown = false;
reported_status = "Aeration";
print("PUMPIN PEAK PENDING: peaks=" + pumpin_pending_peak_count +
", waiting confirmed Aeration before ETA start.");
return;
}
if (pumpin_peak_count > TIME.pumpin_max_accepted_peaks) {
print("PUMPIN PATTERN RESET: too many peaks, count=" + pumpin_peak_count);
resetPumpinPattern();
}
}
function confirmPumpinPeakPatternAfterAerationReturn() {
if (!pumpin_peak_pending) return;
if (pumpin_pending_last_peak_ms <= 0) return;
if (cycle_status !== "Aeration") return;
if (stable_band !== "AERATION") return;
if (stable_band_seconds < TIME.aeration_confirm_s) return;
let now_ms = (new Date()).getTime();
let elapsed_s = Math.floor((now_ms - pumpin_pending_last_peak_ms) / 1000);
if (elapsed_s > TIME.pumpin_wait_aeration_after_last_peak_max_s) {
print("PUMPIN PEAK CANCEL: Aeration confirmation too late elapsed=" +
elapsed_s + " s peaks=" + pumpin_pending_peak_count);
resetPumpinPattern();
return;
}
let total_s = TIME.three_peak_to_pumpout_s;
let source = "3 peaks + aeration";
if (pumpin_pending_peak_count === 2) {
total_s = TIME.two_peak_to_pumpout_s;
source = "2 peaks + aeration";
}
let remaining_s = total_s - elapsed_s;
if (remaining_s < 0) remaining_s = 0;
sequence_phase = "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED";
discharge_expected = false;
setPumpoutEta(remaining_s, source);
print("PUMPIN PEAK ETA STARTED AFTER CONFIRMED AERATION: peaks=" +
pumpin_pending_peak_count + " elapsed=" + elapsed_s +
" s remaining=" + remaining_s + " s");
resetPumpinPattern();
}
function setCycleStatus(new_status) {
if (new_status !== cycle_status) {
let old_status = cycle_status;
let change_ms = (new Date()).getTime();
let old_status_s = status_since_ms > 0 ? Math.floor((change_ms - status_since_ms) / 1000) : 0;
if (old_status_s >= TIME.transient_status_s) {
last_long_status = old_status;
}
status_since_ms = change_ms;
if (old_status === "Treated Water Discharge" &&
new_status === "Tank Filling") {
completeDischargeIfNeeded();
setProcessWarning("", "pump-in followed pump-out");
}
cycle_status = new_status;
if (new_status === "Chemical Dosing" ||
new_status === "Treated Water Discharge") {
exitMaintenanceMode("batch activity: " + new_status);
}
if (old_status === "Treated Water Discharge" &&
process_message === "Discharge" &&
!pumpout_eta_active) {
clearTransientProcessMessage();
}
if (new_status === "Chemical Dosing") {
if (CONFIG.v24_process_warnings) {
if (last_long_status === "Treated Water Discharge") {
setProcessWarning(CONFIG.outlet_blocked_text, "chemical filling right after pump-out");
} else if (last_long_status === "Tank Filling" ||
last_long_status === "Sludge Return" ||
last_long_status === "Settling") {
setProcessWarning(CONFIG.high_water_text, "aeration skipped after " + last_long_status);
} else if (last_long_status === "Aeration" && batch_aeration &&
last_aeration_s < TIME.full_aeration_min_s) {
setProcessWarning(CONFIG.high_water_text, "aeration cut at " + last_aeration_s + " s");
}
}
batch_aeration = false;
if (old_status === "Aeration" ||
sequence_phase === "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED" ||
CONFIG.v24_trip_eta) {
sequence_phase = "KOHTA1_DOSING_VALVE";
setPumpoutEta(TIME.kohta1_dosing_valve_to_pumpout_s, "Kohta1 dosing");
}
}
if (new_status === "Aeration") {
if (old_status === "Chemical Dosing") {
sequence_phase = "KOHTA1_SHORT_AERATION";
setPumpoutEta(TIME.kohta1_short_aeration_to_pumpout_s, "Kohta1 short aeration");
} else if (old_status === "Sludge Return") {
sequence_phase = "KOHTA2_AERATION";
} else if (old_status === "Tank Filling" && CONFIG.v24_trip_eta && !fill_long_boost &&
(fill_seen_boost || old_status_s >= 20)) {
onBatchStart(stable_band_seconds + TIME.debounce_s, "fill -> aeration");
} else if (old_status === "Tank Filling" &&
sequence_phase === "KOHTA2_PUMP_IN_SERIES") {
sequence_phase = "POST_FILL_AERATION";
}
}
if (new_status === "Settling") {
settling_seconds = 0;
if (old_status === "Aeration" &&
sequence_phase === "KOHTA1_SHORT_AERATION") {
sequence_phase = "KOHTA1_LONG_SETTLING";
discharge_expected = false;
setPumpoutEta(TIME.kohta1_long_settling_to_pumpout_s, "Kohta1 long settling");
} else if (old_status === "Sludge Return" &&
sequence_phase === "KOHTA1_SLUDGE") {
sequence_phase = "KOHTA1_FINAL_SETTLING";
discharge_expected = true;
setPumpoutEta(TIME.kohta1_final_settling_to_pumpout_s, "Kohta1 final settling");
} else {
if (old_status !== "Treated Water Discharge") {
discharge_expected = false;
}
}
}
if (new_status === "Sludge Return") {
if (old_status === "Settling" &&
sequence_phase === "KOHTA1_LONG_SETTLING") {
sequence_phase = "KOHTA1_SLUDGE";
discharge_expected = false;
setPumpoutEta(TIME.kohta1_sludge_to_pumpout_s, "Kohta1 sludge");
}
}
if (new_status === "Treated Water Discharge") {
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
sequence_phase = "DISCHARGE";
stopPumpoutEta();
resetPumpinPattern();
setProcessMessage("Discharge", false);
}
if (new_status === "Tank Filling") {
discharge_expected = false;
fill_long_boost = false;
fill_seen_boost = false;
if (old_status === "Aeration" &&
sequence_phase === "KOHTA2_AERATION") {
sequence_phase = "KOHTA2_PUMP_IN_SERIES";
}
}
print("STATE: " + old_status + " -> " + cycle_status + " seq=" + sequence_phase);
}
}
function shouldStartDischargeFromSettling() {
if (cycle_status !== "Settling") return false;
if (stable_band !== "COMP_45") return false;
if (!discharge_expected &&
sequence_phase !== "KOHTA1_FINAL_SETTLING") {
return false;
}
if (settling_seconds >=
TIME.pumpout_after_final_sludge_settling_s - TIME.pumpout_detect_tolerance_s) {
return true;
}
if (pumpout_eta_active &&
pumpout_eta_s !== null &&
pumpout_eta_s <= TIME.pumpout_detect_tolerance_s) {
return true;
}
return false;
}
function shouldStartKnownSludgeFromSettling() {
if (cycle_status !== "Settling") return false;
if (stable_band !== "COMP_45") return false;
if (sequence_phase === "KOHTA1_LONG_SETTLING") return true;
if (sequence_phase === "KOHTA2_PUMP_IN_SERIES") return true;
if (sequence_phase === "POST_FILL_AERATION") return true;
if (sequence_phase === "DISCHARGE") return true;
if (sequence_phase === "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED") return true;
return false;
}
function shouldUseAmbiguousComp45FromSettling() {
if (cycle_status !== "Settling") return false;
if (stable_band !== "COMP_45") return false;
if (shouldStartDischargeFromSettling()) return false;
if (shouldStartKnownSludgeFromSettling()) return false;
return true;
}
function shouldReclassifySludgeToDischarge() {
if (cycle_status !== "Sludge Return") return false;
if (stable_band !== "COMP_45") return false;
if (sequence_phase !== "KOHTA1_FINAL_SETTLING") return false;
if (pumping_phase_seconds < TIME.discharge_reclassify_s) return false;
return true;
}
function reclassifySludgeToDischargeIfNeeded() {
if (!shouldReclassifySludgeToDischarge()) return;
let carried_seconds = pumping_phase_seconds;
setCycleStatus("Treated Water Discharge");
discharge_seconds = carried_seconds;
discharge_counted = false;
setProcessMessage("Discharge", false);
print("RECLASSIFY: Sludge Return -> Treated Water Discharge, carried=" + carried_seconds + " s");
}
function isStartupStatusReliable() {
if (comp45_ambiguous) {
if (comp45_ambiguous_as_sludge) return true;
return false;
}
if (startup_seconds < TIME.startup_unknown_min_s) return false;
if (cycle_status === "Settling" &&
stable_band === "IDLE" &&
stable_band_seconds >= TIME.settling_confirm_s) {
return true;
}
if (cycle_status === "Aeration" &&
stable_band === "AERATION" &&
stable_band_seconds >= TIME.startup_aeration_confirm_s) {
return true;
}
if (cycle_status === "Tank Filling") {
if (stable_band === "BOOST") return true;
if (stable_band === "COMP_45" &&
stable_band_seconds >= TIME.startup_comp45_confirm_s) {
return true;
}
}
if (cycle_status === "Chemical Dosing" &&
(stable_band === "VALVE_ONLY" || stable_band === "DOSING_COMP") &&
stable_band_seconds >= TIME.dosing_confirm_s) {
return true;
}
if (cycle_status === "Sludge Return" &&
stable_band === "COMP_45" &&
stable_band_seconds >= TIME.startup_comp45_confirm_s) {
return true;
}
if (cycle_status === "Treated Water Discharge" &&
stable_band === "COMP_45" &&
stable_band_seconds >= TIME.startup_comp45_confirm_s) {
return true;
}
return false;
}
function updateStartupUnknownMode() {
if (comp45_ambiguous) {
if (comp45_ambiguous_as_sludge) {
reported_status = "Sludge Return";
} else {
reported_status = "Unknown";
}
return;
}
if (startup_unknown) {
startup_seconds = startup_seconds + 1;
if (isStartupStatusReliable()) {
startup_unknown = false;
reported_status = cycle_status;
print("Unknown ended: " + cycle_status);
} else {
reported_status = "Unknown";
}
} else {
reported_status = cycle_status;
}
}
function updateStableBand(new_raw_band) {
raw_band = new_raw_band;
if (raw_band !== candidate_band) {
candidate_band = raw_band;
candidate_seconds = 1;
return;
}
candidate_seconds = candidate_seconds + 1;
if (candidate_band !== stable_band && candidate_seconds >= TIME.debounce_s) {
onBandExit(stable_band);
prev_stable_band = stable_band;
stable_band = candidate_band;
stable_band_seconds = 0;
onBandEnter(stable_band);
}
}
function onBandEnter(band) {
resolveAmbiguousComp45OnBandEnter(band);
if (band === "IDLE") {
pumping_phase_seconds = 0;
} else if (band === "VALVE_ONLY" || band === "DOSING_COMP") {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
} else if (band === "BOOST") {
decideBoostStatusOnEnter();
} else if (band === "COMP_45") {
decideComp45StatusOnEnter();
} else if (band === "AERATION") {
aeration_from_idle = prev_stable_band === "IDLE";
}
}
function onBandExit(band) {
if (band === "AERATION") {
last_aeration_s = stable_band_seconds;
}
if (band === "COMP_45") {
if (cycle_status === "Treated Water Discharge") {
completeDischargeIfNeeded();
}
}
}
function decideBoostStatusOnEnter() {
if (cycle_status === "Tank Filling") return;
if (cycle_status === "Chemical Dosing") return;
if (cycle_status === "Treated Water Discharge") {
completeDischargeIfNeeded();
} else if (cycle_status === "Sludge Return") {
reclassifySludgeToDischargeIfNeeded();
if (cycle_status === "Treated Water Discharge") {
completeDischargeIfNeeded();
}
}
resetPumpingCounters();
discharge_expected = false;
setCycleStatus("Tank Filling");
}
function decideComp45StatusOnEnter() {
if (pumpin_pattern_active || pumpin_peak_pending) {
if (cycle_status !== "Tank Filling") {
setCycleStatus("Tank Filling");
}
return;
}
if (cycle_status === "Tank Filling") return;
if (cycle_status === "Treated Water Discharge") return;
if (cycle_status === "Sludge Return") {
reclassifySludgeToDischargeIfNeeded();
return;
}
if (cycle_status === "Aeration") {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
setCycleStatus("Tank Filling");
return;
}
if (cycle_status === "Settling") {
if (shouldStartDischargeFromSettling()) {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
setCycleStatus("Treated Water Discharge");
return;
}
if (shouldStartKnownSludgeFromSettling()) {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
setCycleStatus("Sludge Return");
return;
}
if (shouldUseAmbiguousComp45FromSettling()) {
startComp45Ambiguous("Settling + COMP_45 without reliable context");
return;
}
}
startComp45Ambiguous("COMP_45 without reliable context");
}
function updateProcessState() {
stable_band_seconds = stable_band_seconds + 1;
if (cycle_status === "Settling" && stable_band === "IDLE") {
settling_seconds = settling_seconds + 1;
}
if (stable_band === "IDLE") {
if (stable_band_seconds >= TIME.settling_confirm_s) {
setCycleStatus("Settling");
discharge_seconds = 0;
discharge_counted = false;
}
if (CONFIG.v24_fast_holiday &&
!maintenance_mode &&
cycle_status === "Settling" &&
settling_seconds >= TIME.holiday_wait_detect_s &&
isWaitingContext() &&
power_fault_text === "" &&
last_batch_ms > 0 &&
(new Date()).getTime() - last_batch_ms >= TIME.holiday_after_batch_s * 1000 &&
!pumpout_eta_active) {
enterMaintenanceMode("waiting " + settling_seconds + " s seq=" + sequence_phase);
}
if (!maintenance_mode &&
cycle_status === "Settling" &&
settling_seconds >= TIME.maintenance_settling_detect_s &&
sequence_phase.indexOf("KOHTA1") !== 0 &&
!pumpout_eta_active) {
enterMaintenanceMode("settling " + settling_seconds + " s seq=" + sequence_phase);
}
} else if (stable_band === "VALVE_ONLY" || stable_band === "DOSING_COMP") {
if (stable_band_seconds >= TIME.dosing_confirm_s) {
setCycleStatus("Chemical Dosing");
}
} else if (stable_band === "AERATION") {
if (stable_band_seconds >= TIME.aeration_confirm_s) {
setCycleStatus("Aeration");
confirmPumpinPeakPatternAfterAerationReturn();
}
if (maintenance_mode &&
stable_band_seconds >= TIME.maintenance_exit_aeration_s) {
exitMaintenanceMode("aeration " + stable_band_seconds + " s");
}
if (CONFIG.v24_restart_batch &&
aeration_from_idle &&
stable_band_seconds >= TIME.restart_aeration_s &&
cycle_status === "Aeration") {
aeration_from_idle = false;
if (!pumpout_eta_active) {
onBatchStart(stable_band_seconds + TIME.debounce_s, "restart after power cut");
}
}
} else if (stable_band === "BOOST") {
if (stable_band_seconds > 15) {
fill_long_boost = true;
}
if (cycle_status === "Tank Filling") {
fill_seen_boost = true;
}
if (cycle_status === "Tank Filling") {
pumping_phase_seconds = pumping_phase_seconds + 1;
} else if (cycle_status === "Aeration" ||
cycle_status === "Sludge Return" ||
cycle_status === "Treated Water Discharge") {
if (cycle_status === "Sludge Return") {
reclassifySludgeToDischargeIfNeeded();
}
if (cycle_status === "Treated Water Discharge") {
completeDischargeIfNeeded();
}
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
setCycleStatus("Tank Filling");
}
} else if (stable_band === "COMP_45") {
pumping_phase_seconds = pumping_phase_seconds + 1;
if (pumpin_pattern_active || pumpin_peak_pending) {
if (cycle_status !== "Tank Filling") {
setCycleStatus("Tank Filling");
}
return;
}
if (comp45_ambiguous) {
comp45_ambiguous_seconds = comp45_ambiguous_seconds + 1;
discharge_seconds = comp45_ambiguous_seconds;
if (comp45_ambiguous_seconds >= TIME.ambiguous_sludge_confirm_s &&
!comp45_ambiguous_as_sludge) {
markAmbiguousComp45AsProbableSludge();
}
if (comp45_ambiguous_seconds >= TIME.discharge_count_min_s) {
finishAmbiguousAsDischarge("duration reached discharge minimum");
}
return;
}
if (cycle_status === "Treated Water Discharge") {
discharge_seconds = discharge_seconds + 1;
setProcessMessage("Discharge", false);
if (CONFIG.v24_pumpout_780 && discharge_seconds >= TIME.pumpout_fixed_s) {
completeDischargeIfNeeded();
resetPumpingCounters();
discharge_expected = false;
setCycleStatus("Tank Filling");
}
} else if (cycle_status === "Tank Filling") {
} else if (cycle_status === "Sludge Return") {
reclassifySludgeToDischargeIfNeeded();
} else if (cycle_status === "Aeration") {
pumping_phase_seconds = 0;
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
setCycleStatus("Tank Filling");
} else if (cycle_status === "Settling") {
if (shouldStartDischargeFromSettling()) {
discharge_seconds = 0;
discharge_counted = false;
discharge_expected = false;
setCycleStatus("Treated Water Discharge");
} else if (shouldStartKnownSludgeFromSettling()) {
setCycleStatus("Sludge Return");
} else {
startComp45Ambiguous("Settling + COMP_45 in updateProcessState");
}
}
}
}
function clearPowerFault() {
print("POWER FAULT CLEARED: " + power_fault_text);
power_fault_text = "";
fault_ok_s = 0;
if (pumpout_eta_active) {
last_pumpout_eta_text = "";
updatePumpoutEtaMessage();
return;
}
if (canShowDischargeMessage()) {
setProcessMessage("Discharge", false);
return;
}
if (getIdleProcessMessage() !== "-") {
restoreLastBatchMessageToText();
} else {
setProcessMessage("-", false);
}
}
function updatePowerFaultMonitor(p_norm) {
fault_high_s = p_norm > LIMITS.fault_high_power_w ? fault_high_s + 1 : 0;
fault_off_s = p_norm < LIMITS.fault_off_power_w ? fault_off_s + 1 : 0;
fault_idle_s = p_norm < LIMITS.idle_max ? fault_idle_s + 1 : 0;
let want = "";
if (fault_off_s >= TIME.fault_off_power_s) {
want = CONFIG.fault_off_text;
} else if (fault_high_s >= TIME.fault_high_power_s) {
want = CONFIG.fault_high_text;
} else if (fault_idle_s >= TIME.fault_no_activity_s) {
want = CONFIG.fault_idle_text;
}
if (want !== "") {
fault_ok_s = 0;
if (power_fault_text !== want) {
power_fault_text = want;
print("POWER FAULT: " + want + " p=" + p_norm);
setProcessMessage(want, false);
}
return;
}
if (power_fault_text !== "") {
fault_ok_s = fault_ok_s + 1;
if (fault_ok_s >= TIME.fault_clear_s) {
clearPowerFault();
}
}
}
function forceResyncIfDue() {
let now_ms = (new Date()).getTime();
if (now_ms - last_force_resync_ms < TIME.force_resync_interval_s * 1000) {
return;
}
last_force_resync_ms = now_ms;
LAST_STATE.pin = null;
LAST_STATE.pout = null;
LAST_STATE.sludge = null;
LAST_STATE.dosing = null;
LAST_STATE.aeration = null;
LAST_STATE.status_key = null;
LAST_STATE.batch_counter = null;
LAST_STATE.process_message = null;
LAST_STATE.maintenance = null;
}
function updateVirtualSensors(p_norm) {
forceResyncIfDue();
let pin = false;
let pout = false;
let sludge = false;
let dosing = false;
let aeration = false;
let visible_status = reported_status;
let enum_key = statusToEnumKey(visible_status);
if (enum_key === "S" && CONFIG.v24_waiting_status && waiting_enum_ok && isWaitingContext()) {
enum_key = "W";
}
if (visible_status !== "Unknown") {
if (visible_status === "Tank Filling") pin = true;
if (visible_status === "Chemical Dosing") dosing = true;
if (visible_status === "Sludge Return") sludge = true;
if (visible_status === "Treated Water Discharge") pout = true;
}
if (pumpin_pattern_active || pumpin_peak_pending) {
if (raw_band === "COMP_45" ||
raw_band === "BOOST" ||
isPumpinPeakPower(p_norm)) {
pin = true;
}
}
if (raw_band === "AERATION" || raw_band === "BOOST" || isPumpinPeakPower(p_norm)) {
aeration = true;
}
queueSet("Number.set", { id: CONFIG.vc_normalized_consumption, value: p_norm }, "p_norm", p_norm);
queueSet("Enum.set", { id: CONFIG.vc_cycle_status, value: enum_key }, "status_key", enum_key);
queueSet("Boolean.set", { id: CONFIG.vc_pump_in, value: pin }, "pin", pin);
queueSet("Boolean.set", { id: CONFIG.vc_pump_out, value: pout }, "pout", pout);
queueSet("Boolean.set", { id: CONFIG.vc_sludge_removal, value: sludge }, "sludge", sludge);
queueSet("Boolean.set", { id: CONFIG.vc_dosing, value: dosing }, "dosing", dosing);
queueSet("Boolean.set", { id: CONFIG.vc_aeration, value: aeration }, "aeration", aeration);
queueSet("Number.set", { id: CONFIG.vc_batch_counter, value: batch_counter }, "batch_counter", batch_counter);
pushShownMessage();
if (CONFIG.vc_maintenance !== null) {
queueSet("Boolean.set", { id: CONFIG.vc_maintenance, value: maintenance_mode }, "maintenance", maintenance_mode);
}
}
function refreshPowerIfStale(now_ms) {
if (detected_comp === null) return false;
if (latest_power_time <= 0) return false;
let stale_s = Math.floor((now_ms - latest_power_time) / 1000);
if (stale_s < TIME.power_signal_timeout_s) return true;
let status = Shelly.getComponentStatus(detected_comp);
if (status) {
updateLatestPowerFromStatus(status);
return true;
}
return false;
}
function startMainTimer() {
if (main_timer_started) return;
main_timer_started = true;
detectPowerComponent();
Timer.set(1000, true, function () {
if (!system_ready) return;
if (detected_comp === null) {
detectPowerComponent();
return;
}
if (latest_power === null) {
let status = Shelly.getComponentStatus(detected_comp);
updateLatestPowerFromStatus(status);
if (latest_power === null) {
return;
}
}
let now_ms = (new Date()).getTime();
if (latest_power_time > 0 &&
now_ms - latest_power_time > TIME.power_signal_timeout_s * 1000) {
let refreshed = refreshPowerIfStale(now_ms);
now_ms = (new Date()).getTime();
if (!refreshed ||
(latest_power_time > 0 &&
now_ms - latest_power_time > TIME.power_signal_timeout_s * 1000)) {
reported_status = "Unknown";
if (now_ms - latest_power_time > TIME.long_signal_gap_reset_s * 1000) {
let gap_s = Math.floor((now_ms - latest_power_time) / 1000);
resetProcessContextAfterLongGap("power signal timeout", gap_s);
}
setProcessMessage("Warning: power signal missing", false);
updateVirtualSensors(0);
return;
}
}
if (process_message === "Warning: power signal missing") {
clearTransientProcessMessage();
}
let p_norm = normalizePower(latest_power, latest_voltage);
let band = detectBand(p_norm);
if (!CONFIG.v24_trip_eta) {
updatePumpinPeakPattern(p_norm);
}
updateStableBand(band);
updateProcessState();
updateStartupUnknownMode();
tickPumpoutEta();
updatePowerFaultMonitor(p_norm);
updateVirtualSensors(p_norm);
});
}
