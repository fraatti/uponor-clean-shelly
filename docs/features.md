# What the script does and does not do

**English** | [Suomi](ominaisuudet.md)

Shelly script v3 infers everything from the power consumption of the plant's control unit. No sensors are installed in the plant, and the script does not control the plant. It compares the changes in the power level with the phase times of the control unit's firmware (Uponor Clean I, control board A, software version 2.1.2) and follows from them where the plant is in its cycle.

Installation: [`v3-install.md`](v3-install.md). Home Assistant: [`home-assistant.en.md`](home-assistant.en.md).

## What the script does

### Cycles and phases

| Cycle | Phases recognised |
| --- | --- |
| Cleaning (batch) | pre-aeration, aeration, chemical filling, dosing, mixing, sedimentation I, sludge removal, sedimentation II, pump-out, pump-in |
| Waiting | waiting, sludge removal, aeration, pump-in (repeated until the start level is reached) |
| Holiday | the holiday programme's waits, aerations and pump-ins |
| Test | the test cycle started with the control unit's Test button |

- The phase and cycle change a few seconds after the plant changes phase (levels shorter than 6 seconds, such as the control unit's self-tests, are ignored). The script also gives the phase code that the control unit display shows when the Test button is pressed briefly (e.g. `S204`).
- Reaching the start level shows as the cycle changing from waiting to cleaning.
- The mixing pulses of the pump-in are told apart from aeration (a peak shorter than 12 seconds is a pulse).

### Counters

| Counter | How |
| --- | --- |
| Batches | +1 at the end of the pump-out (780 s from its start). The starting value is the reading on the control unit display. The Shelly app charts the growth day by day. |
| Chemical | −0.04 l per dose. Enter the amount after a refill. The script also works out how many days the chemical lasts at the use of the last days. |
| Sludge | Batches since the sludge was emptied. Reminder at 800 batches (the control unit's default). |

The counters are stored in the Shelly's KVS, so they survive script updates, restarts and power cuts.

### Estimates

- **Next pump-out** as a clock time once a batch has started (about 2 h 45 min before the pump-out). In the simulator the error was at most 10 s.
- **Start of the holiday programme**: when the waiting cycle turns into the holiday cycle if the start level is not reached (about 71 h from the start of the waiting cycle).
- **Chemical left** in days.

### Warnings

| Warning | What the script infers it from |
| --- | --- |
| No power to plant | The plant's power is zero for over a minute while the Shelly has power |
| High power, check air hoses | Power above 62 W for 2 minutes, e.g. a blocked air hose |
| Power reading missing | The Shelly gives no power reading |
| Compressor not running | The compressor has not run for 4 hours |
| Outlet blocked? | A new dosing starts right after the pump-out, because the start level did not drop |
| High water | Aeration was skipped or cut short |
| Process paused? | The control unit has been stopped more than 5 min longer than expected (e.g. stopped from the radio panel) |
| Chemical low | The chemical lasts less than 10 days |
| Sludge emptying due | The sludge counter is at 800 |
| Sludge emptied? | The pump-in power rose by about 1 W, as it does after emptying. A reminder to reset the sludge counter. |

The warnings show in the Warning component (most important first) and in the status text, and each one sends an event to Home Assistant.

### Special situations

- **Power cut**: from the Shelly's reset reason the script knows that the control unit starts a new cleaning cycle from the beginning, and follows it at once.
- **Restart of the Shelly or the script** (e.g. an update): the script continues from the stored phase and estimates the phases that began during the break from the firmware times.
- **Stop from the radio panel**: the phase is put on hold and continued, shifted, when the same power level returns.
- **High water** (aeration skipped or cut short) and a **blocked outlet** (a new dosing right after the pump-out) are followed as the firmware handles them.
- **Test cycle** is recognised and does not add to the batch counter.

### Where the data shows

- The Shelly web UI and the Shelly app: 8 components in the group Uponor Clean, and the batch counter chart in the app.
- Home Assistant: the components as entities, the events as an event entity, and the Lovelace card ([`ha-card/README.md`](../ha-card/README.md)).
- The browser app in the home network: live data and the power history stored on the Shelly ([`app.md`](app.md)).
- The state endpoint `http://<shelly-ip>/script/<number>/state` as JSON (e.g. `curl`; a browser reads the same state over WebSocket).

## What the script does not do

**It measures nothing directly.** Everything is inferred from the power consumption and the firmware times.

- **The water level is not measured.** The script knows of the start level only that a batch started. The levels on the card are estimates.
- **The chemical and sludge amounts are calculated.** The chemical is the entered amount minus the doses, and the sludge is the number of batches since emptying. Refills and emptying have to be entered by hand. The emptying hint is only a hint.
- **The amount of wastewater is an estimate** (batches × 170 l), not a measurement.
- **It does not see the control unit's own alarms or display.** The control unit's error codes or alarm light, for example, do not show; only the script's own warnings inferred from the power.
- **It does not control the plant.** The script cannot start, stop or acknowledge anything.
- **A fault that does not change the power consumption does not show.** The biological process, the quality of the outgoing water or a leaking tank, for example, do not show in the power.
- **Recognition takes a while.** After installation or a long break the phase is *Unknown* until the script recognises the first phase: in a waiting cycle usually within an hour, in a cleaning cycle at the latest at the next phase change. After a power cut it is right at once.
- **The Shelly must measure only the plant.** Other devices on the same circuit mix up the power levels.
- **The power levels and times are fitted to one plant.** The limits (2, 10, 24, 38.5, 52 and 64 W at 230 V) and the phase times match an Uponor Clean I with control board A and software 2.1.2. Other models, boards, software versions or changed service settings have not been tried. The limits can be changed in the settings (`uc_cfg`), but the phase times are in the code.
- **Clock times need a synchronised clock.** Without it phases and batches work, but clock times are missing.
- **The Shelly has room for one script this size.** The script uses 9 of the 10 virtual component slots and about 15–19 kB of the 25 kB script memory, so other large scripts do not fit beside it.
- **The script keeps no history.** The device holds only the counters and the current state. The history is in Home Assistant or in the Shelly app's batch chart.

## Accuracy

| Test | Result |
| --- | --- |
| Firmware simulator, 14 scenarios (normal cycles, high water, blocked outlet, power cuts, holiday, test cycle, panel stop, a week of use) | Phases right 99.6–99.9 % of the time, all batches, pump-out estimate ±10 s |
| Recorded data July–October 2026 | 49 / 49 batches at the same time as v2.4 (±5 s) |
| Device from 19 Nov 2026 | In use. Tested on a Shelly EM Mini Gen4 (firmware 2.2.0). |

Details: [`v3-testitulokset.md`](v3-testitulokset.md) (in Finnish).

If the script does not work on another plant, the power can be recorded for troubleshooting: [Recording for troubleshooting](v3-install.md#recording-for-troubleshooting).
