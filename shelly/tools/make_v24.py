#!/usr/bin/env python3
"""Builds puhdistamo_skripti_v2_4.js from v2.3 by explicit, counted replacements."""
import sys

SRC = 'puhdistamo_skripti_v2_3.js'
DST = 'puhdistamo_skripti_v2_4.js'
s = open(SRC, encoding='utf-8').read()


def rep(a, b, n=1):
    global s
    c = s.count(a)
    if c != n:
        sys.exit(f'replace count {c} != {n}: {a[:80]!r}')
    s = s.replace(a, b)


# ---------------------------------------------------------------- header
rep(''' * Uponor Clean -prosessin tunnistus Shellylle
 * Versio 2.3
''', ''' * Uponor Clean -prosessin tunnistus Shellylle
 * Versio 2.4
 *
 * Versio 2.4 kayttaa ohjauskeskuksen firmwaresta saatuja vaiheaikoja.
 * Jokainen uusi toiminto on CONFIG-kytkimen takana (v24_*). Kun kaikki
 * kytkimet ovat false, skripti toimii tasmalleen kuten versio 2.3.
''')

# ---------------------------------------------------------------- CONFIG
rep('''    fault_idle_text: "Warning: compressor not running"
};''', '''    fault_idle_text: "Warning: compressor not running",

    // --- Versio 2.4 (firmware-tieto). false = version 2.3 toiminta. ---
    // Taytto, jota seuraa ilmastus = aloitustaso saavutettu -> ETA heti.
    // Korvaa 2-3 piikin kuvion, joka ei tunnistanut 4-9 piikin tayttoja.
    v24_trip_eta: true,
    // Ulospumppaus kestaa aina 780 s; sen jalkeen alkaa sisaanpumppaus.
    v24_pumpout_780: true,
    // Odotusjakson lepo raportoidaan arvolla "W" (Waiting), jos enum:200
    // sisaltaa vaihtoehdon W. Muuten kaytetaan S (Settling) kuten ennen.
    v24_waiting_status: true,
    // Loma-automatiikka tunnistetaan, kun odotus ylittaa 20 min
    // (normaali odotus on enintaan 18 min, lomajakson 50 ja 100 min).
    v24_fast_holiday: true,
    // Korkean veden ja tukkeutuneen lahdon varoitukset prosessiviestiin.
    v24_process_warnings: true,
    // Lepo -> ilmastus yli 31 min = sahkokatkon jalkeen alkanut panos.
    v24_restart_batch: true,

    high_water_text: "Warning: high water",
    outlet_blocked_text: "Warning: outlet blocked?"
};''')

# ---------------------------------------------------------------- TIME
rep('''    fault_clear_s: 60
};''', '''    fault_clear_s: 60,

    // Versio 2.4. Firmwaren vaiheajat: esi-ilmastus 600 + ilmastus 5400 +
    // kemikaalin taytto 90 + annostelu 10 + sekoitus 120 + laskeutus I 2700 +
    // lietteen palautus 120 + laskeutus II 900 = 9940 s, lisaksi itsetestit.
    trip_to_pumpout_s: 9945,
    // Firmwaren PUMP_OUT 780 s + tunnistusviive.
    pumpout_fixed_s: 790,
    // Odotusjakson odotus 1080 s; lomajakson odotukset 3000 ja 6000 s.
    holiday_wait_detect_s: 1200,
    // Odotusjakson ilmastus 1800 s, lomajakson 600 s; panoksen 6000 s.
    restart_aeration_s: 1860,
    // Taytta ilmastusta lyhyempi panoksen ilmastus = korkea vesi katkaisi.
    full_aeration_min_s: 5700
};''')

# ---------------------------------------------------------------- state
rep('''let fault_ok_s = 0;
''', '''let fault_ok_s = 0;

// Versio 2.4
let waiting_enum_ok = false;
let process_warning = "";
let prev_stable_band = "UNKNOWN";
let aeration_from_idle = false;
let batch_aeration = false;
let last_aeration_s = 0;
''')

# ---------------------------------------------------------------- shown message (process message + warning)
rep('''function isUnknownProcessMessage(msg) {''', '''function shownMessage() {
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

function onBatchStart(elapsed_s, source) {
    sequence_phase = "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED";
    discharge_expected = false;
    batch_aeration = true;
    resetPumpinPattern();
    setPumpoutEta(TIME.trip_to_pumpout_s - elapsed_s, source);
    setProcessWarning("", "batch started normally");
}

function isUnknownProcessMessage(msg) {''')

# all Text.set writes go through shownMessage()
rep('''        queueSet(
            "Text.set",
            { id: CONFIG.vc_process_message, value: process_message },
            "process_message",
            process_message
        );

        print("System ready.''', '''        pushShownMessage();

        print("System ready.''')
rep('''    if (process_message !== idle_msg) {
        process_message = idle_msg;

        queueSet(
            "Text.set",
            { id: CONFIG.vc_process_message, value: process_message },
            "process_message",
            process_message
        );
    }''', '''    if (process_message !== idle_msg) {
        process_message = idle_msg;

        pushShownMessage();
    }''')
rep('''    process_message = msg;

    queueSet(
        "Text.set",
        { id: CONFIG.vc_process_message, value: process_message },
        "process_message",
        process_message
    );
''', '''    process_message = msg;

    pushShownMessage();
''')
rep('''    queueSet(
        "Text.set",
        { id: CONFIG.vc_process_message, value: process_message },
        "process_message",
        process_message
    );

    if (CONFIG.vc_maintenance !== null) {''', '''    pushShownMessage();

    if (CONFIG.vc_maintenance !== null) {''')

# ---------------------------------------------------------------- enum W check at startup
rep('''function normalizePower(p, u) {''', '''if (CONFIG.v24_waiting_status) {
    queueRpc(
        "Enum.GetConfig",
        { id: CONFIG.vc_cycle_status },
        function (res, err_code, err_msg) {
            if (res && res.options && res.options.indexOf("W") >= 0) {
                waiting_enum_ok = true;
                print("Enum option W found: waiting periods reported as Waiting.");
            } else {
                print("Enum option W missing: waiting periods reported as Settling (S).");
            }
        },
        null,
        null
    );
}

function normalizePower(p, u) {''')

# ---------------------------------------------------------------- status transitions
rep('''        if (old_status === "Treated Water Discharge" &&
            new_status === "Tank Filling") {
            completeDischargeIfNeeded();
        }
''', '''        if (old_status === "Treated Water Discharge" &&
            new_status === "Tank Filling") {
            completeDischargeIfNeeded();
            setProcessWarning("", "pump-in followed pump-out");
        }
''')
rep('''        if (new_status === "Chemical Dosing") {
            if (old_status === "Aeration" ||
                sequence_phase === "KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED") {

                sequence_phase = "KOHTA1_DOSING_VALVE";
                setPumpoutEta(TIME.kohta1_dosing_valve_to_pumpout_s, "Kohta1 dosing");
            }
        }
''', '''        if (new_status === "Chemical Dosing") {
            if (CONFIG.v24_process_warnings) {
                if (old_status === "Treated Water Discharge") {
                    setProcessWarning(CONFIG.outlet_blocked_text, "chemical filling right after pump-out");
                } else if (old_status === "Tank Filling" ||
                    old_status === "Sludge Return" ||
                    old_status === "Settling") {
                    setProcessWarning(CONFIG.high_water_text, "aeration skipped after " + old_status);
                } else if (old_status === "Aeration" && batch_aeration &&
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
''')
rep('''            } else if (old_status === "Tank Filling" &&
                sequence_phase === "KOHTA2_PUMP_IN_SERIES") {
                sequence_phase = "POST_FILL_AERATION";
            }''', '''            } else if (old_status === "Tank Filling" && CONFIG.v24_trip_eta) {
                // Firmware: sisaanpumppauksesta ilmastukseen vain aloitustasolla.
                onBatchStart(stable_band_seconds + TIME.debounce_s, "fill -> aeration");
            } else if (old_status === "Tank Filling" &&
                sequence_phase === "KOHTA2_PUMP_IN_SERIES") {
                sequence_phase = "POST_FILL_AERATION";
            }''')

# ---------------------------------------------------------------- band tracking
rep('''    if (candidate_band !== stable_band && candidate_seconds >= TIME.debounce_s) {
        onBandExit(stable_band);
''', '''    if (candidate_band !== stable_band && candidate_seconds >= TIME.debounce_s) {
        onBandExit(stable_band);

        prev_stable_band = stable_band;
''')
rep('''function onBandExit(band) {
    if (band === "COMP_45") {''', '''function onBandExit(band) {
    if (band === "AERATION") {
        last_aeration_s = stable_band_seconds;
    }

    if (band === "COMP_45") {''')
rep('''    } else if (band === "AERATION") {
        // Aeration vahvistetaan updateProcessState-funktiossa.
    }''', '''    } else if (band === "AERATION") {
        // Aeration vahvistetaan updateProcessState-funktiossa.
        aeration_from_idle = prev_stable_band === "IDLE";
    }''')

# ---------------------------------------------------------------- process state rules
rep('''        if (!maintenance_mode &&
            cycle_status === "Settling" &&
            settling_seconds >= TIME.maintenance_settling_detect_s &&''', '''        if (CONFIG.v24_fast_holiday &&
            !maintenance_mode &&
            cycle_status === "Settling" &&
            settling_seconds >= TIME.holiday_wait_detect_s &&
            isWaitingContext() &&
            power_fault_text === "" &&
            !pumpout_eta_active) {
            enterMaintenanceMode("waiting " + settling_seconds + " s seq=" + sequence_phase);
        }

        if (!maintenance_mode &&
            cycle_status === "Settling" &&
            settling_seconds >= TIME.maintenance_settling_detect_s &&''')
rep('''        if (maintenance_mode &&
            stable_band_seconds >= TIME.maintenance_exit_aeration_s) {
            exitMaintenanceMode("aeration " + stable_band_seconds + " s");
        }''', '''        if (maintenance_mode &&
            stable_band_seconds >= TIME.maintenance_exit_aeration_s) {
            exitMaintenanceMode("aeration " + stable_band_seconds + " s");
        }

        if (CONFIG.v24_restart_batch &&
            aeration_from_idle &&
            stable_band_seconds === TIME.restart_aeration_s &&
            cycle_status === "Aeration" &&
            !pumpout_eta_active) {
            // Firmware: levosta suoraan alkava yli 31 min ilmastus syntyy vain
            // sahkokatkon jalkeen (uusi puhdistusjakso esi-ilmastuksesta).
            onBatchStart(stable_band_seconds + TIME.debounce_s, "restart after power cut");
        }''')
rep('''        if (cycle_status === "Treated Water Discharge") {
            discharge_seconds = discharge_seconds + 1;
            setProcessMessage("Discharge", false);
        } else if (cycle_status === "Tank Filling") {''', '''        if (cycle_status === "Treated Water Discharge") {
            discharge_seconds = discharge_seconds + 1;
            setProcessMessage("Discharge", false);

            if (CONFIG.v24_pumpout_780 && discharge_seconds >= TIME.pumpout_fixed_s) {
                // Firmware: ulospumppaus 780 s, sen jalkeen heti sisaanpumppaus.
                completeDischargeIfNeeded();
                resetPumpingCounters();
                discharge_expected = false;
                setCycleStatus("Tank Filling");
            }
        } else if (cycle_status === "Tank Filling") {''')

# ---------------------------------------------------------------- enum key W
rep('''    let visible_status = reported_status;
    let enum_key = statusToEnumKey(visible_status);
''', '''    let visible_status = reported_status;
    let enum_key = statusToEnumKey(visible_status);

    if (enum_key === "S" && CONFIG.v24_waiting_status && waiting_enum_ok && isWaitingContext()) {
        enum_key = "W";
    }
''')

# ---------------------------------------------------------------- main loop: peak pattern only in v2.3 mode
rep('''        updatePumpinPeakPattern(p_norm);
''', '''        if (!CONFIG.v24_trip_eta) {
            updatePumpinPeakPattern(p_norm);
        }
''')

open(DST, 'w', encoding='utf-8').write(s)
print('wrote', DST, len(s), 'bytes')
