// Uponor Clean app loader (github.com/fraatti/uponor-clean-shelly)
// Serves the browser app from the Shelly itself at http://<shelly>/script/<this id>/app, so the app
// needs no other server. The app is stored gzip + base64 as the code of the script
// "uponor-clean-app-data" (a large app continues in "uponor-clean-app-data2", "...3"), which is never
// started. This page reads it with Script.GetCode (same address, so no cross-origin block), unpacks
// it in the browser and opens it. Install with the app's own Install button, in the Shelly web UI
// or with shelly/tools/sovellus_shellyyn.py (docs/app.md).
let PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Uponor Clean</title></head><body style="font:15px system-ui,sans-serif;margin:24px;color:#555">' +
    '<p id="m">Ladataan sovellusta&hellip; / Loading the app&hellip;</p><script>' +
    '(async()=>{const m=document.getElementById("m");try{' +
    'const l=await(await fetch("/rpc/Script.List")).json();' +
    'const p=(l.scripts||[]).filter(x=>/^uponor-clean-app-data\\d*$/.test(x.name)).sort((a,b)=>(+a.name.slice(21)||1)-(+b.name.slice(21)||1));' +
    'if(!p.length)throw new Error("uponor-clean-app-data puuttuu / missing");' +
    'let d="";for(const s of p){let o=0;for(let g=0;g<200;g++){const r=await(await fetch("/rpc/Script.GetCode?id="+s.id+"&offset="+o+"&len=4096")).json();' +
    'if(r.code)throw new Error(r.message||"GetCode");d+=r.data||"";o+=(r.data||"").length;if(!r.left)break}}' +
    'const b=Uint8Array.from(atob(d.replace(/\\s+/g,"")),c=>c.charCodeAt(0));' +
    'const h=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
    'document.open();document.write(h);document.close()' +
    '}catch(e){m.textContent="Sovellusta ei saatu ladattua / Could not load the app: "+e.message}})()' +
    '</script></body></html>';

HTTPServer.registerEndpoint("app", function (req, res) {
    res.code = 200;
    res.headers = [["Content-Type", "text/html; charset=utf-8"], ["Cache-Control", "no-store"]];
    res.body = PAGE;
    res.send();
});
print("Uponor Clean app: http://<shelly>/script/" + Shelly.getCurrentScriptId() + "/app");
