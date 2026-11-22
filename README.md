# Uponor Clean – Shelly monitoring

**English** | [Suomi](README.fi.md)

![Card](docs/img/card_side_en.jpg)

A Shelly EM Mini Gen4 measures the power consumption of an Uponor Clean I small wastewater treatment plant. From that alone, a Shelly script works out the control unit's cycles (cleaning, waiting, holiday, test) and phases (aeration, chemical filling and dosing, mixing, sedimentation, sludge removal, pump-out, pump-in, waiting), counts batches, chemical and sludge, estimates the next pump-out and warns about faults. A Home Assistant card shows the process animated.

**[Try the app in the demo](https://fraatti.github.io/uponor-clean-shelly/demo/?lang=en)**: the browser app that the Shelly serves, on recorded data of a real plant in real time, no Shelly needed. **[The Home Assistant card](https://fraatti.github.io/uponor-clean-shelly/ha-card/preview.html)** also runs on recorded data in the browser, no Home Assistant needed.

Home Assistant is not required: the script's components also show in the Shelly web UI and the Shelly app. Phase, cycle, status, warning and next pump-out update in real time, and the app charts the batch counter day by day.

<p>
<img src="docs/img/app_paanakyma.jpg" alt="Shelly app: components" width="300">
<img src="docs/img/app_panokset.jpg" alt="Shelly app: batch counter chart" width="300">
</p>

## Guides

| Guide | Contents | Suomeksi |
| --- | --- | --- |
| [`docs/features.md`](docs/features.md) | What the script does and does not do: phases, counters, estimates, warnings, limitations and accuracy | [`ominaisuudet.md`](docs/ominaisuudet.md) |
| [`docs/v3-install.md`](docs/v3-install.md) | Installing Shelly script v3 (with screenshots), updating, removing, components, warnings, settings and troubleshooting | [`v3-asennus.md`](docs/v3-asennus.md) |
| [`docs/app.md`](docs/app.md) | Browser app: live data and power history straight from the Shelly in the home network, without Home Assistant | [`sovellus.md`](docs/sovellus.md) |
| [`docs/home-assistant.en.md`](docs/home-assistant.en.md) | Home Assistant: Shelly integration, entities, event entity and automation examples | [`home-assistant.md`](docs/home-assistant.md) |
| [`ha-card/README.md`](ha-card/README.md) | The Home Assistant card: what it shows, installation, language, options, entering chemical and sludge | [`kortti.md`](docs/kortti.md) |
| [`docs/shelly-limits.md`](docs/shelly-limits.md) | Limits of the Shelly scripting environment that came up (stack, memory, missing functions, components, Home Assistant) | [`shelly-rajoitteet.md`](docs/shelly-rajoitteet.md) |

Development notes are in Finnish only: test results ([`docs/v3-testitulokset.md`](docs/v3-testitulokset.md)), running the tests ([`test/README.md`](test/README.md)), the v3 plan, the prototype tests and the control unit firmware in pseudocode ([`docs/firmware/`](docs/firmware/)).

## Contents

| Folder | Contents |
| --- | --- |
| `shelly/v3/` | Script v3.1.0: `uponor_clean_v3.js` (source) and `uponor_clean_v3_shelly.js` (compact, loaded on the Shelly). |
| `shelly/v2/` | Old scripts v2.4 and v2.3 (not in use) and a backup of the v2.4 components (`backup/`). |
| `shelly/v3/proto/` | v3 prototypes for the device test and the component backup tool `uc_tools.js` (used in the migration). |
| `shelly/tools/` | `nauhuri.ps1` (Windows recorder for troubleshooting: power once a second to CSV), `lataa_shellyyn.py` (uploads a script over RPC in chunks), `compact.py` (makes the compact version), `make_v24.py` (v2.3 → v2.4), `sovellus_shellyyn.py` (installs the browser app on the Shelly). |
| `app/` | Browser app `uponor-clean-app.html` 1.6.3 (a single file, guide `docs/app.md`; installs itself on the Shelly from its settings; the Picture view is the card, put in by `tools/build_app.js` with the phase reconstruction `history_from_power.js`), the loader `uponor_clean_app_loader.js`, with which the Shelly serves the app itself, and the packed app `uponor-clean-app-data.txt` for installing it in the Shelly web UI. |
| `demo/` | Online demo of the app, served by GitHub Pages: `index.html` and `data.js`, built by `app/tools/build_demo.js` from the app, the demo Shelly `app/demo_shelly.js` and a Home Assistant history export ([guide](docs/app.md#demo)). |
| `ha-card/` | Lovelace card `uponor-clean-card.js` v1.8.3, its guide, a preview page (`preview.html`) and its build tool (`tools/build_preview.py`). |
| `test/` | Node test environment: runs the real script file with a virtual clock in a Shelly mock, a control unit firmware simulator, scenarios, the card test and the WebSocket mock for the app. |
| `docs/` | Guides, images (`img/`), the firmware pseudocode, v2 documentation and the v3 plan summary. |

## Versions

| Version | Status |
| --- | --- |
| Script v3.1.0 | In use since 22 Nov 2026. Does not need Home Assistant, creates its own components, follows the firmware's phases and cycles, chemical and sludge counters, warnings, events. 3.1.0: fixes from a review with power-cut simulations: a batch or a dose is no longer lost when a script update or a Shelly reboot falls on its moment, the right phase after a reboot also when the clock is not set yet, a power cut of the plant alone is recognised even when it is too short to show as 0 W, warnings stay on over a restart, the next pump-out time no longer moves by a second (see the test results). v3.0.2 (19 Nov 2026, release [v3.0.2](../../releases/tag/v3.0.2)): v3.0.0–3.0.1 stopped at the start of the first cleaning cycle because the call stack got too deep. |
| Card v1.8.3 | In use. v3 entities, v2 history before v3, visual editor and language option, entering chemical and sludge on the card. 1.8.0: on a wide card the timeline is under the drawing and the status and logbook are beside them, and the card fits the window height. 1.8.1–1.8.2: no false "after power cut" while the history is still loading. 1.8.3: the chemical entry shows that a full tank is 20 l, and a larger number is saved as 20 l. |
| App 1.6.3 | New on 22 Nov 2026: `app/uponor-clean-app.html` shows live data and the power history stored on the Shelly in a browser ([guide](docs/app.md)). 1.1.0: power and chart normalised to 230 V, chart from the minute's minimum and maximum power. 1.2.0: the Shelly serves the app itself at `http://<shelly>/script/<id>/app`, so it opens on a phone in the home network without Home Assistant. 1.3.0: *Install on the Shelly* button in the settings; a large app can be split over several storage scripts. 1.4.0: *Picture* view with the Home Assistant card's drawing and timeline, fed straight from the Shelly. 1.4.1: power chart over 3 days instead of 7. 1.4.2: the installation copes with slow answers from the Shelly. 1.5.0: the past week's phases and batches worked out from the Shelly's minute power, so the timeline, batches per day and level estimate are there at once on any device. 1.5.1: the chemical and the sludge counter also when moving back on the timeline. 1.5.2: fixes from a code review: a cleaning cycle still running is no longer read as a holiday programme, counter edits and sludge emptying while away, no warnings carried over the time away; the app lets go of its connection in the background and reloads only the missing minutes (the Shelly takes only a few connections, see `docs/shelly-limits.md`). 1.6.0: the Picture view fits on one screen on a computer: the timeline under the drawing, the status and logbook beside them, and the page uses more of a wide screen. 1.6.1–1.6.3: the card changes 1.8.1–1.8.3. |
| Recorder 1.0 | New on 21 Nov 2026: `shelly/tools/nauhuri.ps1` records the power for troubleshooting ([guide](docs/v3-install.md#recording-for-troubleshooting)). |
| Script v2.4.0 | Retired on 18 Nov 2026 and removed from the device on 19 Nov 2026. No migration or return path. |
| Script v2.3 | Old version. |

## Tested with

The script and the card were built and tested on one installation. Other versions have not been tried.

| Part | Version |
| --- | --- |
| Plant | Uponor Clean I, control unit label "VERSION 2.1.2", circuit board from 2011 |
| Shelly | Shelly EM Mini Gen4 (S4EM-001PXCEU16), firmware 2.2.0 (`20261109-150305/2.2.0-g7968dca`) |
| Home Assistant | 2026.10.2, built-in Shelly integration |
| Card | Home Assistant frontend in Chrome (desktop and narrow layout) |

The script has not been tried on older Shelly firmware. The card's visual editor needs a Home Assistant version with `getConfigForm` (tested on 2026.10.2); elsewhere the card works with YAML options.

## Before making the repository public

The repository is private. Before making it public, check:

- Measurement data (Home Assistant history CSVs) is not under version control (`.gitignore`). Keep it out.
- `ha-card/preview.html` contains an example cycle computed from the plant's own measurements.
- `docs/img/` contains screenshots of the own Shelly and Home Assistant. The device MAC address has been removed from the images, the files and the whole history (19 Nov 2026). Screenshots must not show the bottom bar of the Shelly web UI, which shows the MAC address.
- `docs/firmware/` is based on a third-party firmware dump, and the card guide refers to the Uponor manual. Make sure publishing them is fine.
- Choose a license (e.g. MIT).
