# Limits of the Shelly scripting environment

**English** | [Suomi](shelly-rajoitteet.md)

Limits that came up while writing this script. They were found on a Shelly EM Mini Gen4, firmware 2.2.0 (`20261109-150305/2.2.0-g7968dca`), in November 2026. Other devices and firmware versions may differ. The Shelly mock used by the tests (`test/shelly_device_mock.js`) checks most of these, so a mistake shows up in a test rather than on the device.

## Language and library

| Limit | What happens | Workaround |
| --- | --- | --- |
| Conservative ES5-level JavaScript: no arrow functions, template literals, `const`, `class`, `async` or spread syntax. Not all of these were tried on the device; the mock rejects them to be safe. | – | `function`, string concatenation with `+`, `let` |
| A function must be defined before it is called (also at the top level) | Error, function not found | Functions in order, start-up from a timer |
| `Array.prototype.shift`, `unshift` and `concat` are missing | Error, function not found | `splice(0, 1)`, `push`, a loop. `splice`, `slice`, `pop`, `push`, `indexOf` and `join` work. |
| `Date.UTC` and `getTimezoneOffset` are missing | Error, function not found | Dates computed with an own function, the time zone from the Sys time (`Shelly.getComponentStatus("sys")`) |
| `Date.toISOString` works | – | – |

## Stack and memory

| Limit | What happens | Workaround |
| --- | --- | --- |
| **The call stack is shallow.** A native call (e.g. `Shelly.getComponentStatus`) 11 functions deep stopped the script; 10 worked. Long expressions (nested `?:` and string concatenation) use more stack. | `Uncaught Error: Too much recursion - the stack is about to overflow`, the script stops | Event handlers only change the state and set flags. `tick()` writes the components, KVS and events from the top level. Long expressions are split into temporary variables. Every native call counts, also `push`, `JSON.stringify` and `Math`: since 3.1.0 the counters and `JSON.stringify` of the KVS values are also handled in `tick()`. The mock rejects Shelly API calls more than 7 levels deep, and `test/v3_depth_test.js` checks every function: in 3.1.0 none runs deeper than 8 levels (in 3.0.2 a batch led to a `push` 9 levels deep). The fault was found only on the device on 19 Nov 2026: v3.0.0–3.0.1 stopped at the start of the first cleaning cycle. |
| No recursion: synchronous recursion about 6 levels deep with closures stopped the script | As above | Loops and asynchronous chains (a callback or a timer starts from an empty stack) |
| All scripts share about 25 kB of memory | `Out of memory`, the script stops | v3 uses about 15 kB (peak 19 kB). Two large scripts do not fit at the same time. |
| Global variables and functions take memory all the time: about 28–56 bytes per property and 70–85 bytes per function | Memory runs out | Tables turned into functions, rarely changed settings into constants |
| Large RPC responses (e.g. `Shelly.GetComponents` with all settings, about 3 kB) | `out_of_memory` | Small queries one at a time |
| At most 5 timers and 5 concurrent RPC calls | Error | One repeating `tick()` timer, KVS writes queued one at a time |
| KVS: a key at most 42 characters, a value at most 253 characters, at most 50 keys (Shelly documentation) | A longer value is not stored | The state is split over several `uc_*` keys (8 in 3.1.0). The longest value is `uc_vc`, about 210 characters. `test/v3_device_test.js` checks the sizes. |

## Scripts and the file system

| Limit | What happens | Workaround |
| --- | --- | --- |
| At most 3 scripts can run at a time (Shelly documentation: "Up to 3 scripts can be running at any given time"). More can be stored. | `Script.Start` fails: `Too many scripts running` | Only the detection script and the app's loader run. The app's data scripts are never started. The installer says if three scripts are already running. |
| A script cannot hold or serve a large page: it has about 25 kB of memory (see above), and the app is about 210,000 characters | The page cannot be served from a script's HTTP endpoint | The app is stored packed (gzip + base64) in scripts that never run. The loader serves a small page that reads them with `Script.GetCode` and unpacks them in the browser. |
| Script changes (`Script.Create`, `Script.Delete`, `Script.PutCode`) can take over 10 s to answer right after large scripts were deleted (busy file system). Found on 22 Nov 2026: installing app 1.4.1 stopped when `Script.Create` did not answer within 10 s. | The installation times out although the script is created | The app waits 30 s for script changes and, if the answer is late, finds the new script by its name. The Python tool waits 40 s. |
| The file system is 768 kB in all (`fs_size`). On the test device about 108 kB is free with app 1.5.2 (94 kB). Shelly does not say how much space a firmware update needs. | A file system that is too full may stop a firmware update (not tried) | The app and the Python tool always leave at least 100 kB free, see [`app.md`](app.md#space-and-shelly-firmware-updates). |

## Virtual components

| Limit | What happens | Workaround |
| --- | --- | --- |
| The device has 10 virtual component slots (the group included) | No new ones can be created | v3 uses 9 |
| The `@meta` block is read only from the first 1024 bytes of the file | Roles beyond that are skipped without an error, and components already created are deleted | v3 does not use `@meta` |
| Home Assistant's Shelly integration creates no entities for script-owned (`@meta`) components | The components are missing from Home Assistant | `Virtual.Add` and the ids stored in KVS (`uc_vc`) |
| A script-owned component cannot be deleted with `Virtual.Delete` | Error −107 | They are deleted with the script |
| Component ids may change on reinstall | Home Assistant entities change | The ids are stored in KVS and reused |
| The `change` event also comes from the script's own `setValue` call, even if the value did not change | The script thinks the user changed the value | Compare with the value written last |
| `setValue` is applied only when the script's current call has ended (Shelly documentation: "applied asynchronously as soon as the current execution context of the script exits") | Reading the value right after the write gives the old one | The script keeps the last written values itself |
| Components with `persisted: false` go back to their default value when the Shelly restarts | Phase, Cycle, Status and Warning are empty after a reboot until the script writes them | The script writes them when it starts. The counters are `persisted: true` and also stored in KVS. |
| The Shelly web UI shows a read-only enum value next to a broken image icon | Cosmetic | – |
| The Shelly app charts a component's history only if its settings have cloud statistics (`meta.cloud`, e.g. `["counter"]`) | No chart | Batches is created with `cloud: ["counter"]`, so the app charts it day by day. When the setting was added to the same component (`number:200`) that v2.4 had used, the chart continued from the old history. |

## Home Assistant

| Limit | What happens | Workaround |
| --- | --- | --- |
| The integration looks for a script's event types only in the first 5 kB of the script (`Shelly.emitEvent("type"`) | No event entity | The second line of the compact version mentions `Shelly.emitEvent("uponor"` |
| The integration reads the components only when it is reloaded or Home Assistant starts | New components are missing | Reload the integration after installing |

## Other

| Limit | What happens | Workaround |
| --- | --- | --- |
| The web UI editor's text field holds at most 50,000 characters (`maxlength`). Tested on 19 Nov 2026: of a 60,000-character paste, 50,000 were kept, and Save stored the truncated code on the device. The device itself accepts longer code over RPC (`Script.PutCode`, tested with 60,000 characters). | The paste is cut **without any warning**, and the truncated script is saved | The compact version (about 40,000 characters) or `shelly/tools/lataa_shellyyn.py`, which writes in chunks. Reported to Shelly through the web UI's Feedback form. |
| The Shelly answers 503 to an HTTP request that carries the `Origin` header of another page. This covers the RPC calls and the script's own HTTP endpoints, and a page opened from a local file (`Origin: null`) too. A CORS header in the script's response does not help. There is no setting for it. Tested on 22 Nov 2026. | A browser app cannot use the HTTP API | WebSocket (`ws://<shelly>/rpc`) works from another page. The script state is read with `Script.Eval` (`JSON.stringify(stateObject())`), the power history with `EM1Data.GetData` |
| The EM1Data minute energy (`total_act_energy`) comes in steps of about 0.2072 Wh. An average power from it takes only the values 0, 12.4, 24.9, 37.3, 49.7 and 62.2 W and can be below the minute's minimum power. Found on 22 Nov 2026. | A power chart from the energy jumps | The power of a minute from its minimum and maximum power (`min_act_power`, `max_act_power`); the energy summed over a day is still right |
| `EM1Data.GetData` returns at most 31 minute records a call on the device (HTTP and WebSocket), even for a longer range. A call takes about 100 ms, so 7 days (about 10,000 records) take about 35 s. Parallel calls do not make it faster. Found on 22 Nov 2026. | Loading a week of power history takes a while | The app fetches and draws the range on screen first and the rest in the background (`next_record_ts`) |
| The Shelly takes only a few WebSocket connections at a time (`ws://<shelly>/rpc`). With Home Assistant and two browser apps connected, each new connection closed an old one (code 1000): first Home Assistant's, whose Uponor entities were unavailable for 1–3 s, then an idle connection opened earlier. Home Assistant connected again at once and could close another one in turn. The Shelly documentation only names a limit of 6 simultaneous non-persistent RPC channels. Found on 22 Nov 2026. | Opening another app page or a lost connection shows as a short outage in Home Assistant | The app uses one connection, closes it when its page has been in the background for a minute, and fetches only the missing minutes when it connects again. Keep the app open in one place. |
| The Shelly has no encrypted local connection (no `https://` and no `wss://`). The browser blocks an unencrypted `ws://` connection from an encrypted (`https://`) page. | The app cannot connect when it is opened e.g. from GitHub Pages, Home Assistant remote access or a chat app preview | Open the app from the Shelly, from Home Assistant's local `http://` address or as a file. Away from home, use a VPN. |
| The Shelly cloud API cannot read the script state or the `EM1Data` power history | The app does not work through the cloud | A VPN connection to the home network |
| `EM1Data` keeps the minute records for about 7 days. Old records are removed 6 hours at a time: on 22 Nov 2026 at 11:26 the oldest record was from 15 Nov 8:00, and at 17:30 from 15 Nov 14:00 (Finnish time), so 7 to 7¼ days old. | No longer power history | The app fetches 7 days and works out the past phases for that time. |
| The `Sys` component's `unixtime` is in whole seconds and `uptime` in fractions of a second. A time computed from them (unixtime − uptime + moment) moves by a second from one read to the next. Found on 22 Nov 2026: Home Assistant's next pump-out time changed 217 times in a day, 190 of them by only 1–2 s. | Times (`eta`, `since`) move by a second without a real change, and histories fill with needless changes | Script 3.1.0 keeps the largest difference seen between `unixtime` and `uptime` and starts over only when the clock steps by more than 2 s (a time sync). The next pump-out component is rewritten only for a change of more than 2 s, because the estimate is anchored again at each phase and the phase starts are measured to the second. The app ignores changes under 2 s. |
| The EM1Data history does not show a short restart as a gap | A Shelly restart cannot be told from a short power cut | The reset reason from the `reset_reason` field of `Sys.GetStatus` |
| `unixtime` and `time` of the `Sys` component are `null` until the clock is synced from an NTP server (Shelly documentation). After a reboot, e.g. a firmware update, the script can start before the clock is set. Whether that happens on the device has not been seen; the tests assume it can. | The phase stored before the reboot cannot be dated. Script 3.0.2 dropped it, and the phase stayed unknown for up to 100 minutes. | Script 3.1.0 keeps the stored phase for up to 5 minutes and continues it when the clock is set. A batch counted meanwhile gets its time then. |
| `reset_reason` is not in Shelly's documentation. On the test device a software reboot gave 3. The values for a power-on start (1, 9 and 14 in the numbering of the ESP32 chip's software) are assumed, not seen. | A power cut cannot be told from a reboot with certainty | The script takes 1, 9, 14 or a missing field in the first 5 minutes after the start as a power cut (the plant also restarts and begins a new cleaning cycle), other values as a reboot (the plant runs on). |
| The bottom bar of the Shelly web UI shows the device MAC address | It shows in screenshots | Crop the bottom bar out |
