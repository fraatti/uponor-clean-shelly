# v3-prototyyppi 1 – laitetesti

Testi varmistaa Shellyssä ne v3:n rakennuspalikat, joita ei voi testata tietokoneella. Se on jaettu kahteen osaan:

| Osa | Mitä testataan | v2.4 | Kesto | Milloin |
| --- | --- | --- | --- | --- |
| A | kello ja aikavyöhyke, KVS, tapahtumat toiselle skriptille, tilakysely, muisti, mittaushistorian katkot | jatkaa toimintaansa | noin 5 min | milloin tahansa |
| B | komponenttien luonti `@meta`-lohkosta, otsikot, vain luku -pääsy, kentän muokkaus, säilyminen poistossa ja uudelleenasennuksessa, paluu v2.4:ään | pysäytetty | noin 10 min | kun ulospumppausta ei ole tulossa 15 minuuttiin |

Osa A ei luo komponentteja, joten se mahtuu laitteeseen v2.4:n rinnalle. Osa B tarvitsee v2.4:n komponenttipaikat, joten v2.4 on sen ajan pysähdyksissä.

Tiedostot: `shelly/v3/proto/uponor_v3_probe.js`, `uponor_v3_listener.js`, `uc_tools.js` ja `uponor_v3_proto.js`. Selainosoitteissa `<ip>` on Shellyn IP-osoite.

## Osa A – rinnakkaistesti (milloin tahansa)

| # | Tee näin | Odotettu tulos |
| --- | --- | --- |
| A1 | Luo skripti `uponor-listen`, liitä `uponor_v3_listener.js`, tallenna ja käynnistä. | `listening for uponor events` |
| A2 | Luo skripti `uponor-probe`, liitä `uponor_v3_probe.js`, tallenna ja käynnistä. | Konsoliin tulostuu laitteen tiedot, `KVS.Set ok, start number 1`, `EM1Data blocks in last 24 h: …` ja `endpoint: http://…/script/N/probe`. |
| A3 | Odota minuutti ja katso kuuntelijan konsolia. | Kolme `raw {...}`-riviä ja sen jälkeen `#4 {...}` 15 s välein. |
| A4 | Avaa selaimessa vaiheen A2 osoite. | JSON-vastaus, jossa `"probe":true`. |
| A5 | Kopioi kummankin skriptin konsoli talteen. Pysäytä ja poista `uponor-probe`. Jos jatkat heti osaan B, jätä kuuntelija päälle; muuten poista sekin. | – |

## Osa B – komponenttitesti (v2.4 pysähdyksissä noin 10 min)

**Milloin:** kun v2.4:n viesti ei ole `Discharge` eikä `Pump out in …` alle 20 minuuttia. Odotusjakson aikana (ei laskuria) seuraava ulospumppaus on aina vähintään 2 h 46 min päässä.

| # | Tee näin | Odotettu tulos |
| --- | --- | --- |
| B1 | Kirjaa ylös panoslaskuri. Luo skripti `uc-tools`, liitä `uc_tools.js`, vaihda rivi `let MODE = "show";` muotoon `let MODE = "backup";`, tallenna ja käynnistä. | 10 riviä `BACKUP {...}` ja `Backup stored: 10 components`. **Kopioi BACKUP-rivit tekstitiedostoon.** Älä poista tätä skriptiä ennen testin loppua. |
| B2 | Pysäytä v2.4-skripti. | Skripti pysähtyy. |
| B3 | Vaihda `uc-tools`-skriptissä `MODE = "delete"`, tallenna ja käynnistä. | `Done: 10 calls, 0 failed` ja `Current dynamic components: 0`. |
| B4 | Luo skripti `uponor-proto`, liitä `uponor_v3_proto.js`, tallenna ja käynnistä. | Ryhmä Uponor Clean, jossa on 8 komponenttia. Konsolissa `handles: 9/9`, komponenttien ID:t ja `state endpoint: http://…/script/N/state`. |
| B5 | Katso Shelly-sovellusta tai web-käyttöliittymää noin minuutti. | Phase, Cycle ja Warning vaihtuvat 5 s välein ja näyttävät otsikot (esim. "Sedimentation I"). Next pump-out näyttää ajan muodossa `2026-11-18T22:15:00+02:00`. |
| B6 | Yritä muuttaa Phase-arvoa sovelluksessa tai web-käyttöliittymässä. | Muutos ei onnistu. |
| B7 | Kirjoita Chemical-kenttään 15. | Konsolissa `USER EDIT chemical: … -> 15`. |
| B8 | Odota simuloitu panos (minuutti käynnistyksestä, sitten 2 min välein). | Batches ja Sludge kasvavat yhdellä, Chemical laskee 0,04. Konsolissa `own write confirmed`, ei uutta `USER EDIT` -riviä. |
| B9 | Avaa vaiheen B4 osoite selaimessa. | JSON-vastaus, jossa `version`, `values` ja `mem`. |
| B10 | Pysäytä ja poista `uponor-proto`. Avaa `http://<ip>/rpc/KVS.Get?key="uc_proto"`. | Prototyypin komponentit katosivat. KVS-arvo on yhä tallessa. |
| B11 | Luo `uponor-proto` uudelleen samasta tiedostosta ja käynnistä. | Komponentit syntyvät uudelleen, Chemical palautuu KVS:stä ja konsolissa on `start number 2`. Kirjaa ID:t. |
| B12 | Pysäytä ja poista `uponor-proto` ja `uponor-listen`. | Komponentit katoavat. |
| B13 | Vaihda `uc-tools`-skriptissä `MODE = "restore"`, tallenna ja käynnistä. | `Done: … calls, 0 failed` ja 10 komponenttia samoilla avaimilla kuin ennen (esim. `boolean:201`). |
| B14 | Käynnistä v2.4. | Prosessiviesti ja panoslaskuri palaavat, Home Assistantin entiteetit toimivat. |
| B15 | Vaihda `uc-tools`-skriptissä `MODE = "show"` ja pysäytä se. | – |

Jos jokin vaihe epäonnistuu ennen B13:a, komponentit saa takaisin vaiheella B13, kunhan `uc-tools`-skripti on tallessa.

**Jos ulospumppaus ehti tapahtua testin aikana**, v2.4:n laskurista puuttuu panos. Korjaa se: pysäytä v2.4, avaa `http://<ip>/rpc/KVS.Set?key="puhdistamo_batch_count"&value="231"` (oikea luku ohjausyksikön näytöltä) ja käynnistä v2.4.

Lopuksi voit poistaa testiavaimet: `http://<ip>/rpc/KVS.Delete?key="uc_probe"` ja `http://<ip>/rpc/KVS.Delete?key="uc_proto"`.

## Raportoi nämä

1. Osan A konsolit kokonaan (probe ja kuuntelija).
2. Osan B prototyypin ensimmäiset rivit: `role … id …`, `group members: …` ja `mem_used …`.
3. Jos prototyyppi ei käynnistynyt: koko virheilmoitus.
4. Rivi `change event (raw) …` vaiheesta B7.
5. Vaiheen B9 JSON-vastaus.
6. Vaiheen B11 ID:t: samat kuin B4:ssä vai eri?
7. Näkyikö ryhmä sovelluksessa ja näkyivätkö otsikot? Estikö vain luku -pääsy Phase-muutoksen sovelluksessa ja Home Assistantissa?
8. Muuttuivatko Home Assistantin v2.4-entiteettien nimet vaiheen B14 jälkeen?
