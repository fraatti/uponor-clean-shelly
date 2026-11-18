/*
 * Uponor Clean v3 - prototype listener
 *
 * A second script that listens for the "uponor" events of the prototype.
 * It shows that another script (history, notifications) can follow the
 * detection script without changing it. The first three events are printed
 * raw so that the exact event structure of the firmware is visible.
 */

let TAG = "[uc-listen] ";
let count = 0;
let rawShown = 0;

Shelly.addEventHandler(function (ev) {
    if (!ev) return;
    let s = JSON.stringify(ev);
    if (s.indexOf("uponor") < 0) return;
    count++;
    if (rawShown < 3) {
        rawShown++;
        print(TAG + "raw " + s);
        return;
    }
    let d = (ev.info && ev.info.data) ? ev.info.data : ev.info;
    print(TAG + "#" + count + " " + JSON.stringify(d));
});

Timer.set(60000, true, function () {
    let st = Shelly.getComponentStatus("script:" + Shelly.getCurrentScriptId());
    print(TAG + "events " + count + (st ? ", mem_used " + st.mem_used + ", mem_peak " + st.mem_peak + ", mem_free " + st.mem_free : ""));
});

print(TAG + "listening for uponor events");
