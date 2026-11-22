# Testit

Testit ajavat oikeaa skriptitiedostoa Nodessa. Shellyn rajapinnat (RPC, KVS, virtuaalikomponentit, ajastimet) on korvattu jäljitelmillä ja kello on virtuaalinen, joten viikkojen data ajetaan sekunneissa.

| Tiedosto | Tehtävä |
| --- | --- |
| `harness.js` | Ajoympäristö: lukee HA-historian CSV:n, syöttää tehon ja jännitteen skriptille, kerää tilat ja viestit. |
| `fwsim.js` | Ohjauskeskuksen firmwaresimulaattori: tuottaa synteettisen tehosarjan pseudokoodin vaiheajoista. |
| `scenarios.js` | Firmwareskenaariot (korkea vesi, lähtö tukossa, sähkökatko, odotus- ja lomajakso, testijakso). |
| `validate.js` | Panosmäärät ja siirtymät oikeaa dataa vasten. |
| `compare.js` | Kahden version vertailu (esim. v2.3 ja v2.4). |
| `eqtest.js` | Varmistaa, että kaksi skriptiä (esim. lähde ja tiivistetty) tuottavat samat tulokset. |

## Ajaminen

Testit lukevat skriptit työhakemistosta ja CSV:t sen alikansiosta `data/`. Kopioi Home Assistantin historiavedokset (`history__uponor_2_.csv`, `history__23_simu.csv`, `history__24_.csv`, `history__26_.csv`, `history__28_.csv`, `history__9_.csv`, `history__11_.csv`) kansioon `test/data/` (ei versionhallinnassa) ja aja kansiosta `test/`:

```
cd test
cp ../shelly/v2/*.js .
node validate.js puhdistamo_skripti_v2_4.js
node scenarios.js puhdistamo_skripti_v2_4.js
node eqtest.js puhdistamo_skripti_v2_4.js puhdistamo_skripti_v2_4_shelly.js
```

Odotettu tulos v2.4:llä: syyskuun data 800/800 siirtymää ja 9 panosta, lokakuun data 938/943 siirtymää.

## v3-prototyyppi

`shelly_device_mock.js` jäljittelee yhtä Shelly-laitetta, jossa on useita skriptejä: `@meta`- ja `Virtual.Add`-komponentit ja niiden omistajuus, laitekohtainen 10 komponentin raja, KVS, `Script.storage`, tapahtumat skriptien välillä, HTTP-osoitteet, sähkökatkot ja uudelleenkäynnistys (`reset_reason`). Jokaisessa natiivikutsussa se laskee skriptin kutsupinon syvyyden ja kaataa skriptin yli 7 tason ketjussa (laite kaatui 11 tasossa; raja muutettavissa ympäristömuuttujalla `UC_DEPTH_LIMIT`). `v3_device_test.js` ja `v3_scenarios.js` tulostavat lopuksi syvimmän ketjun. Lisäksi se tarkistaa, ettei koodissa ole Shellyn tukemattomia kieliominaisuuksia (nuolifunktiot, template-literaalit, `const`, luokat, funktion kutsu ennen sen määrittelyä, `Array.shift`/`unshift`/`concat`, `Date.UTC`).

```
cd test
node proto_test.js        # -v näyttää skriptien konsolin
```

Testi ajaa koko laitetestin kulun: varmuuskopio, v2.4-komponenttien poisto, prototyyppi, kuuntelija, käyttäjän muokkaus, uudelleenkäynnistys, uudelleenasennus ja palautus. Dokumentoimattomat yksityiskohdat (esim. tapahtumaolion tarkka muoto) on merkitty jäljitelmään oletuksiksi; laitetesti varmistaa ne.

## v3

```
cd test
cp ../shelly/v2/puhdistamo_skripti_v2_4.js .     # vertailua varten
node v3_scenarios.js        # firmwaresimulaattorin skenaariot (-v: konsoli, suodatin nimen osalla)
node v3_realdata.js         # tallennettu data, vertailu v2.4:ään (data/*.csv)
node v3_device_test.js      # komponentit, käyttäjän muokkaukset, KVS, uudelleenasennus
V3_FILE=../shelly/v3/uponor_clean_v3_shelly.js node v3_scenarios.js   # tiivistetty versio
```

`v3run.js` ajaa skriptin jäljitelmässä tehosyötteen kanssa (sähkökatkot Shellyn kanssa tai ilman, Shellyn ja skriptin uudelleenkäynnistykset, käyttäjän muokkaukset) ja vertaa vaiheita simulaattorin todellisiin vaiheisiin. Simulaattori (`fwsim.js`) kirjaa jokaisen vaiheen alun ja annostelut, ja siinä voi pysäyttää prosessin paneelista (`pauses`). Tulokset: `docs/v3-testitulokset.md`.

`v3_device_test.js` tarkistaa asennuksen kulun: komponenttien luonti `Virtual.Add`-kutsulla (ei `@meta`), nimet ja näkymät, käyttäjän muokkaukset, laskurit KVS:ssä (ei v2:n avaimia), tapahtumat, skriptin uudelleenkäynnistys, poisto (komponentit säilyvät), uudelleenasennus (`uc_vc`) ja puuttuvan komponentin uudelleenluonti.

## Nauhoitukset

`v3_recording.js` analysoi nauhurilla (`shelly/tools/nauhuri.ps1`) tehdyn nauhoituksen: yhteyskatkot, jännite, puhdistamon tehotasot skriptin tehokaistoja vasten (normalisoituna 230 V:iin), skriptin v3 ajo nauhoitusta vasten jäljitelmässä (jaksot, vaiheet, panokset, varoitukset) ja, jos nauhoituksessa on laitteen skriptin vaiheet, niiden vertailu jäljitelmän ajoon. Tiedoston `_info.json` asetukset (`uc_cfg`) otetaan mukaan. Muita kaistarajoja voi kokeilla valitsimella `--cfg`.

```
cd test
node v3_recording.js ~/Lataukset/uponor_20261121_2319.csv
node v3_recording.js uponor_20261121_2319.csv --cfg '{"comp_max":55,"aer_max":70}'
node v3_recording.js uponor_20261121_2319.csv -v      # kaikki vaiheet ja skriptin konsoli
```

`shelly_http_mock.js` on nauhurin testiä varten tehty Shellyn HTTP-rajapinnan jäljitelmä: `/shelly`, `/rpc` (em1, pm1, switch tai em), skriptin `/script/2/state`, minuuttidata, digest-tunnistus (SHA-256) ja sähkökatko. Nauhuri ajetaan PowerShell 7:llä:

```
node test/shelly_http_mock.js --port 8099 --password salainen --outage 12-20 &
pwsh -File shelly/tools/nauhuri.ps1 -Ip 127.0.0.1:8099 -Password salainen -Hours 0.01 -OutDir /tmp/rec -NoWait
```

## Sovellus

`shelly_ws_mock.js` on selainsovelluksen (`app/uponor-clean-app.html`) testiä varten tehty Shellyn WebSocket-rajapinnan jäljitelmä. Se ajaa oikeaa v3-skriptiä Shelly-jäljitelmässä firmwaresimulaation päällä, ensin annetut vuorokaudet nopeasti ja sitten reaaliajassa, ja vastaa kutsuihin `Script.List`, `Script.Eval`, `EM1.GetStatus` ja `EM1Data.GetData`. Se lähettää skriptin tapahtumat (`NotifyEvent`) ja tehon muutokset (`NotifyStatus`). Kuten oikea Shelly, se hylkää HTTP-kyselyt, joissa on `Origin`-otsake. Valinnainen digest-tunnistus (SHA-256) WebSocketin kautta. Lisäksi se tallentaa skriptejä (`Script.Create`, `PutCode`, `GetCode`, `SetConfig`, `Start`, `Stop`), ajaa käynnistetyt skriptit ja vastaa niiden HTTP-osoitteisiin (`/script/<id>/<nimi>`) sekä HTTP-RPC-kyselyihin (`/rpc/<kutsu>`), joten sillä voi kokeilla sovelluksen asennusta Shellyyn (`shelly/tools/sovellus_shellyyn.py`).

```
node test/shelly_ws_mock.js --port 8098 --days 3
# avaa app/uponor-clean-app.html?host=127.0.0.1:8098
node test/shelly_ws_mock.js --port 8097 --days 1 --password salainen
python3 shelly/tools/sovellus_shellyyn.py 127.0.0.1:8098
# avaa http://127.0.0.1:8098/script/<id>/app
```

`app_data_test.js` tarkistaa, että web-käyttöliittymään liitettävä `app/uponor-clean-app-data.txt` purkautuu täsmälleen nykyiseksi sovellukseksi, mahtuu Shellyn editoriin (50 000 merkkiä) ja että latainsivu etsii sen oikealla nimellä. Tiedoston saa päivitettyä komennolla `python3 shelly/tools/sovellus_shellyyn.py --tiedosto`.

```
node test/app_data_test.js
```

`app_picture_test.js` kokeilee sovelluksen Kuva-näkymää jäljitelmää vastaan: Home Assistant -kortti sovelluksen sovittimen varassa, vaihe, tehohistoria ja energia Shellystä, minuuttitehoista päätellyt vaiheet ja panokset (uudessa selaimessa aikajana kattaa koko tehohistorian, ja panoksia on yhtä monta kuin skripti laski), selaimen yhteysaikojen etusija päätellyn edellä, selaimen muistama historia, kemikaalin ja lietelaskurin syöttö `Number.Set`-kutsulla, kielen vaihto ja Tiedot-näkymä. Jäljitelmä vastaa myös kutsuihin `KVS.Get`, `Number.Set` ja `EM1Data.GetStatus`.

```
node test/app_picture_test.js
```

`app_install_test.js` kokeilee sovelluksen *Asenna Shellyyn* -painiketta jäljitelmää vastaan: asennus tiedostosta, Shellyn jakaman sovelluksen avaaminen ja versiotieto, asennus useaan osaan ja takaisin tavalliseen jakoon, Python-työkalun ylimääräisten osien poisto, liian vähäinen tila (`--fs-free`), hitaasti vastaava `Script.Create` (`--slow-create`) ja kolme käynnissä olevaa skriptiä. Jäljitelmä sallii kuten Shelly enintään kolme käynnissä olevaa skriptiä eikä hyväksy käynnissä olevan skriptin koodin muuttamista. Tarvitsee Playwrightin ja Chromiumin.

```
node test/app_install_test.js
```

`history_from_power_test.js` vertaa sovelluksen vaiheiden päättelyä (`app/history_from_power.js`) simulaattorin oikeisiin vaiheisiin neljässä tilanteessa: tavallinen käyttö, vilkas käyttö, loma-ohjelma sekä sähkökatko ja tukkeutunut poistoputki. Minuuttitiedot tehdään kuten Shellyn EM1Data (`em1_minutes.js`: pienin ja suurin teho, energia 0,2072 Wh:n askelin, 237 V). Vaatimus: vaihe ja jakso oikein vähintään 95 % ajasta ja ulospumppauksia yhtä monta. Tulos nyt: vaihe 99,2–99,5 %, jakso 99,8–100 %.

```
node test/history_from_power_test.js --verbose
```

## Kortti

`card_v3_test.js` ajaa simuloidun v3-ajon, syöttää sen kortille Home Assistantin historiana jsdomissa ja tarkistaa vaiheet, ulospumppauksen ajan, kemikaalin, lietelaskurin, editorit ja kortinvalitsimen entiteettihaun. Tarvitsee jsdomin (`npm install jsdom`).

```
cd test
node card_v3_test.js                       # ha-card/uponor-clean-card.js
node card_v3_test.js ../polku/card.min.js  # esim. tiivistetty versio
```

Esikatselusivun päivitys kortin muutoksen jälkeen: `python3 ha-card/tools/build_preview.py`.
