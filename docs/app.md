# Browser app

**English** | [Suomi](sovellus.md)

`app/uponor-clean-app.html` shows the state and power consumption of the plant straight from the Shelly. Home Assistant is not needed. The app is a single HTML file that loads nothing from the internet.

![Browser app](img/app_en.jpg)

## What the app shows

- **Now**: phase, cycle and phase code (e.g. `S103`), when the phase started and its progress from the firmware phase times.
- **Next pump-out** as a clock time and the time until it. In the waiting cycle the app shows when the holiday programme starts if the start level is not reached. The last pump-out is shown too.
- **Power** and voltage about every 3 seconds, **batches**, **chemical** and how long it lasts, and the **sludge counter**.
- **Warnings** as a bar at the top of the page.
- **Power consumption** as a chart over 6 hours, 24 hours or 7 days. The line is the average power of each minute and the light area the minimum and maximum. Above the chart are the average power and energy of the range. The pointer shows the reading at that time.
- **Events** while the app is open: phase changes, completed batches, warnings, chemical and counter entries, and script starts.
- **Device**: script and Shelly versions, uptime and clock state.

The app is in Finnish or English (browser language, or chosen in the settings). The light and dark theme follow the operating system. On a narrow screen the sections stack.

<img src="img/sovellus_kapea.jpg" alt="The app on a narrow screen" width="300">

## Opening

The app connects to the Shelly in the home network. Open it in one of these ways:

1. **As a file**: download `app/uponor-clean-app.html` to the computer and open it in a browser.
2. **Through Home Assistant**: copy the file to the Home Assistant folder `/config/www/` (like the card). The app then opens in the home network at `http://homeassistant.local:8123/local/uponor-clean-app.html`, on a phone too. Home Assistant only serves the file; the data comes straight from the Shelly.
3. **From another server in the home network** at an `http://` address (e.g. a NAS).

The first time, the app asks for the Shelly address (e.g. `192.168.0.102`). The address can also be given in the link: `uponor-clean-app.html?host=192.168.0.102`. The app remembers it in the same browser. The language can be set in the link with `&lang=fi` or `&lang=en`.

A page opened from an `https://` address (e.g. GitHub Pages) cannot connect, because the browser blocks an unencrypted connection from an encrypted page. The app says so.

**Away from home** the app works over a VPN connection to the home network. The data does not come through the Shelly cloud: the cloud API cannot read the script state or the power history.

## Password

If the Shelly has a password, the app asks for it. It uses the Shelly digest authentication (SHA-256). With *Remember the password on this device*, the browser stores a hash computed from the password, not the password itself. The hash still gives access to the Shelly, so do not use it on a shared computer.

The password support was tested with a Shelly mock that follows the Shelly documentation. It has not been tried on a real device, because the test device has no password.

## How it works

Everything goes through the Shelly WebSocket RPC (`ws://<shelly>/rpc`):

| Data | RPC call | Interval |
| --- | --- | --- |
| Script | `Script.List` (name starts with `uponor-clean`) | when connecting |
| Script state | `Script.Eval` → `JSON.stringify(stateObject())` | 6 s and after an event |
| Power and voltage | `EM1.GetStatus` or `NotifyStatus` sent by the Shelly | 3 s |
| Events | the script's `uponor` events (`NotifyEvent`) | at once |
| Power history | `EM1Data.GetData` (one record a minute: energy, minimum and maximum power) | 7 days at first, then the new minutes every minute |

The script's state endpoint `http://<shelly>/script/<id>/state` does not work for a browser: the Shelly answers 503 when an HTTP request carries the `Origin` header of another page (see [`shelly-limits.md`](shelly-limits.md)). So the app reads the same state with `Script.Eval`. The script needed no changes; the name of the function `stateObject()` is now part of the agreed interface.

The app does not show the phase history, because the Shelly does not store it. The event log starts when the app is opened.

## Testing without the device

`test/shelly_ws_mock.js` runs the real v3 script in the Shelly mock over a simulated plant and answers the same WebSocket calls as the Shelly:

```
node test/shelly_ws_mock.js --port 8098 --days 3
# open app/uponor-clean-app.html?host=127.0.0.1:8098
node test/shelly_ws_mock.js --port 8097 --days 1 --password secret   # with a password
```

The mock first simulates the given number of days (about 10 s per day) and then runs in real time.
