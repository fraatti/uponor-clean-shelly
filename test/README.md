# Testit

Testit ajavat oikeaa skriptitiedostoa Nodessa. Shellyn rajapinnat (RPC, KVS, virtuaalikomponentit, ajastimet) on korvattu jäljitelmillä ja kello on virtuaalinen, joten viikkojen data ajetaan sekunneissa.

| Tiedosto | Tehtävä |
| --- | --- |
| `harness.js` | Ajoympäristö: lukee HA-historian CSV:n, syöttää tehon ja jännitteen skriptille, kerää tilat ja viestit. |
| `fwsim.js` | Ohjauskeskuksen firmwaresimulaattori: tuottaa synteettisen tehosarjan pseudokoodin vaiheajoista. |
| `scenarios.js` | Firmwareskenaariot (korkea vesi, lähtö tukossa, sähkökatko, odotus- ja lomajakso, testijakso). |
| `validate.js` | Panosmäärät ja siirtymät oikeaa dataa vasten. |
| `compare.js` | Kahden version vertailu (esim. v2.3 ja v2.4). |
| `eqtest.js` | Varmistaa, että kaksi v2-skriptiä (esim. lähde ja tiivistetty) tuottavat samat tulokset. v3:lle `eqtest_v3.js`. |

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
node v3_restart_test.js     # uudelleenkäynnistykset ja lyhyet katkot (noin 3 min)
node v3_depth_test.js       # kutsupinon syvyys jokaisessa funktiossa (noin 3 min)
node eqtest_v3.js --real    # lähde ja tiivistetty versio toimivat samoin
V3_FILE=../shelly/v3/uponor_clean_v3_shelly.js node v3_scenarios.js   # tiivistetty versio
node v3_sweep.js run 0 2 & node v3_sweep.js run 1 2 & wait; node v3_sweep.js table   # 912 katkoa, noin 40 min kahdella ytimellä
```

`v3run.js` ajaa skriptin jäljitelmässä tehosyötteen kanssa (sähkökatkot Shellyn kanssa tai ilman, Shellyn ja skriptin uudelleenkäynnistykset, käyttäjän muokkaukset) ja vertaa vaiheita simulaattorin todellisiin vaiheisiin. Simulaattori (`fwsim.js`) kirjaa jokaisen vaiheen alun ja annostelut, ja siinä voi pysäyttää prosessin paneelista (`pauses`). Tulokset: `docs/v3-testitulokset.md`.

`v3ext.js` laajentaa jäljitelmää: kello, jota ei ole vielä asetettu käynnistyksen jälkeen (tai joka on väärä), kellon ajautuminen käyntiaikaan nähden, ajastinten viive, Shellyn sähkökatkot, ohjelmalliset uudelleenkäynnistykset ja skriptin pysäytykset. Se vertaa ajoa simulaattorin todellisiin vaiheisiin sähkön palaamisesta alkaen (tahdistumisaika, pisin tuntematon jakso, panokset, annokset, varoitukset, ennusteen virhe).

`v3_restart_test.js` ajaa tapaukset, jotka olivat virheitä versiossa 3.0.2: panoksen tai annoksen hetki skriptin pysäytyksen tai uudelleenkäynnistyksen aikana, pysäytys lyhyen lietteenpoiston yli, uudelleenkäynnistys sisäänpumppauksen lopussa, kello asettamatta uudelleenkäynnistyksen jälkeen, pelkän puhdistamon lyhyt katko (myös ilman 0 W:n lukemaa), varoitukset uudelleenkäynnistyksen yli ja seuraavan ulospumppauksen ajan sekunnin heilunta.

`v3_depth_test.js` lisää jokaisen funktion alkuun mittarin, joka laskee skriptin kutsupinon syvyyden. Jäljitelmä tarkistaa syvyyden vain Shellyn rajapintakutsuissa, mutta laite laskee myös esim. `push`- ja `JSON.stringify`-kutsut. Raja on 8 (laite kaatui 11:ssä).

`v3_sweep.js` katkaisee sähköt jokaisen jakson jokaisessa vaiheessa kolmessa kohdassa: puhdistamo ja Shelly yhdessä (1 s – 5 h), pelkkä puhdistamo (2 s – 5 h), Shellyn ohjelmallinen uudelleenkäynnistys (myös kello asettamatta 60 s) ja skriptin 2 min pysäytys. Taulukko: `docs/v3-testitulokset.md`.

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

`app_picture_test.js` kokeilee sovelluksen Kuva-näkymää jäljitelmää vastaan: Home Assistant -kortti sovelluksen sovittimen varassa, vaihe, tehohistoria ja energia Shellystä, minuuttitehoista päätellyt vaiheet ja panokset (uudessa selaimessa aikajana kattaa koko tehohistorian, ja panoksia on yhtä monta kuin skripti laski), selaimen yhteysaikojen etusija päätellyn edellä (myös kun vaihe on sama ennen katkoa ja sen jälkeen), kemikaali ja lietelaskuri taaksepäin annoksista ja panoksista, selaimen muistama historia, kemikaalin ja lietelaskurin syöttö `Number.Set`-kutsulla, kielen vaihto ja Tiedot-näkymä. Jäljitelmä vastaa myös kutsuihin `KVS.Get`, `Number.Set` ja `EM1Data.GetStatus`, ja `EM1Data.GetData` palauttaa kuten laite enintään 31 minuuttia kerrallaan (`--page`). Testi tarkistaa myös, että yhteyskatkon jälkeen sovellus säilyttää tehohistorian ja aloittaa uuden yhteysjakson.

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

Sama testi katkaisee tehohistorian 7 minuutin välein vuorokauden ajalta ja tarkistaa, että viimeiset 3 tuntia luetaan oikein myös silloin, kun puhdistusjakso on kesken (ei vielä ulospumppausta).

`app_history_test.js` ajaa sovelluksen historian yhdistämistä (sovelluksen HTML:stä otettuna, valekellolla) kuten selain: tilaluku 6 s välein yhteyden aikana, skriptin tila simulaattorin oikeista vaiheista. Se tarkistaa, että taaksepäin lasketut laskurit täsmäävät 2 vuorokauden tauon yli 149 eri yhdistämishetkellä, panoslaskuri ei mene alle nollan, poissa ollessa tehty lietteen tyhjennys näkyy oikeassa kohdassa, varoitus ei jatku poissaoloajalle, seuraavan ulospumppauksen sekunnin heilunta ei kasvata tallennettua historiaa ja juuri vaiheen vaihduttua yhdistäminen ei tuo vanhaa vaihetta näkyviin.

```
node test/app_history_test.js
```

## Kortti

`card_v3_test.js` ajaa simuloidun v3-ajon, syöttää sen kortille Home Assistantin historiana jsdomissa ja tarkistaa vaiheet, ulospumppauksen ajan, kemikaalin, lietelaskurin, editorit ja kortinvalitsimen entiteettihaun. Tarvitsee jsdomin (`npm install jsdom`).

```
cd test
node card_v3_test.js                       # ha-card/uponor-clean-card.js
node card_v3_test.js ../polku/card.min.js  # esim. tiivistetty versio
```

Esikatselusivun päivitys kortin muutoksen jälkeen: `python3 ha-card/tools/build_preview.py`.
