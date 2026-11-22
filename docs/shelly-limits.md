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
| **The call stack is shallow.** A native call (e.g. `Shelly.getComponentStatus`) 11 functions deep stopped the script; 10 worked. Long expressions (nested `?:` and string concatenation) use more stack. | `Uncaught Error: Too much recursion - the stack is about to overflow`, the script stops | Event handlers only change the state and set flags. `tick()` writes the components, KVS and events from the top level. Long expressions are split into temporary variables. The mock rejects native calls more than 7 levels deep, and the tests print the deepest chain (at most 7 in 3.0.2). The fault was found only on the device on 19 Nov 2026: v3.0.0–3.0.1 stopped at the start of the first cleaning cycle. |
| No recursion: synchronous recursion about 6 levels deep with closures stopped the script | As above | Loops and asynchronous chains (a callback or a timer starts from an empty stack) |
| All scripts share about 25 kB of memory | `Out of memory`, the script stops | v3 uses about 15 kB (peak 19 kB). Two large scripts do not fit at the same time. |
| Global variables and functions take memory all the time: about 28–56 bytes per property and 70–85 bytes per function | Memory runs out | Tables turned into functions, rarely changed settings into constants |
| Large RPC responses (e.g. `Shelly.GetComponents` with all settings, about 3 kB) | `out_of_memory` | Small queries one at a time |
| At most 5 timers and 5 concurrent RPC calls | Error | One repeating `tick()` timer, KVS writes queued one at a time |

## Virtual components

| Limit | What happens | Workaround |
| --- | --- | --- |
| The device has 10 virtual component slots (the group included) | No new ones can be created | v3 uses 9 |
| The `@meta` block is read only from the first 1024 bytes of the file | Roles beyond that are skipped without an error, and components already created are deleted | v3 does not use `@meta` |
| Home Assistant's Shelly integration creates no entities for script-owned (`@meta`) components | The components are missing from Home Assistant | `Virtual.Add` and the ids stored in KVS (`uc_vc`) |
| A script-owned component cannot be deleted with `Virtual.Delete` | Error −107 | They are deleted with the script |
| Component ids may change on reinstall | Home Assistant entities change | The ids are stored in KVS and reused |
| The `change` event also comes from the script's own `setValue` call, even if the value did not change | The script thinks the user changed the value | Compare with the value written last |
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
| The EM1Data history does not show a short restart as a gap | A Shelly restart cannot be told from a short power cut | The reset reason from the `reset_reason` field of `Sys.GetStatus` |
| The bottom bar of the Shelly web UI shows the device MAC address | It shows in screenshots | Crop the bottom bar out |
