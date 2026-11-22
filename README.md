# Uponor Clean – Shelly monitoring

**English** | [Suomi](README.fi.md)

![Card](docs/img/card_side_en.jpg)

A Shelly EM Mini Gen4 measures the power consumption of an Uponor Clean I small wastewater treatment plant. From that alone, a Shelly script works out the control unit's cycles (cleaning, waiting, holiday, test) and phases (aeration, chemical filling and dosing, mixing, sedimentation, sludge removal, pump-out, pump-in, waiting), counts batches, chemical and sludge, estimates the next pump-out and warns about faults. A Home Assistant card shows the process animated.

**[Try the card in the demo](https://claude.ai/artifact/PnR5ZpnUjHt1qFZEd3TTut)**: it runs on recorded plant data in the browser, no Home Assistant needed.

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
| `shelly/v3/` | Script v3.0.2: `uponor_clean_v3.js` (source) and `uponor_clean_v3_shelly.js` (compact, loaded on the Shelly). |
| `shelly/v2/` | Old scripts v2.4 and v2.3 (not in use) and a backup of the v2.4 components (`backup/`). |
| `shelly/v3/proto/` | v3 prototypes for the device test and the component backup tool `uc_tools.js` (used in the migration). |
| `shelly/tools/` | `nauhuri.ps1` (Windows recorder for troubleshooting: power once a second to CSV), `lataa_shellyyn.py` (uploads a script over RPC in chunks), `compact.py` (makes the compact version), `make_v24.py` (v2.3 → v2.4), `sovellus_shellyyn.py` (installs the browser app on the Shelly). |
| `app/` | Browser app `uponor-clean-app.html` 1.2.0 (a single file, guide `docs/app.md`) and the loader `uponor_clean_app_loader.js`, with which the Shelly serves the app itself. |
| `ha-card/` | Lovelace card `uponor-clean-card.js` v1.7.4, its guide, a preview page (`preview.html`) and its build tool (`tools/build_preview.py`). |
| `test/` | Node test environment: runs the real script file with a virtual clock in a Shelly mock, a control unit firmware simulator, scenarios, the card test and the WebSocket mock for the app. |
| `docs/` | Guides, images (`img/`), the firmware pseudocode, v2 documentation and the v3 plan summary. |

## Versions

| Version | Status |
| --- | --- |
| Script v3.0.2 | In use since 19 Nov 2026 (release [v3.0.2](../../releases/tag/v3.0.2)). v3.0.0–3.0.1 stopped at the start of the first cleaning cycle because the call stack got too deep (see the test results). Does not need Home Assistant, creates its own components, follows the firmware's phases and cycles, chemical and sludge counters, warnings, events. |
| Card v1.7.4 | In use. v3 entities, v2 history before v3, visual editor and language option, entering chemical and sludge on the card. |
| App 1.2.0 | New on 22 Nov 2026: `app/uponor-clean-app.html` shows live data and the power history stored on the Shelly in a browser ([guide](docs/app.md)). 1.1.0: power and chart normalised to 230 V, chart from the minute's minimum and maximum power. 1.2.0: the Shelly serves the app itself at `http://<shelly>/script/<id>/app`, so it opens on a phone in the home network without Home Assistant. |
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
