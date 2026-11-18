# v3-prototyyppi 1 – laitetesti

Testi varmistaa Shellyssä ne v3:n rakennuspalikat, joita ei voi testata tietokoneella: komponenttien luonnin `@meta`-lohkosta, vain luku -pääsyn, kenttien muokkauksen tunnistuksen, KVS:n säilymisen, tapahtumat toiselle skriptille, tilakyselyn, muistin kulutuksen ja mittaushistorian katkon uudelleenkäynnistyksen jälkeen. Samalla testataan paluu v2.4:ään.

Prototyyppi ei tunnista prosessia. Se käy vaiheet ja varoitukset läpi 10 sekunnin välein ja simuloi panoksen 5 minuutin välein.

**Kesto:** noin 45 min. **Katko v2.4:n seurannassa:** testin ajan.

## Ennen aloitusta

- Aloita heti ulospumppauksen jälkeen (viesti `Last: …`). Seuraava ulospumppaus on silloin aikaisintaan 2 h 46 min päässä, eikä yhtään panosta jää laskematta.
- Kirjaa ylös panoslaskuri ja prosessiviesti.
- Tiedostot: `shelly/v3/proto/uc_tools.js`, `uponor_v3_proto.js` ja `uponor_v3_listener.js`.
- Selainosoitteissa `<ip>` on Shellyn IP-osoite.

## Vaiheet

| # | Tee näin | Odotettu tulos |
| --- | --- | --- |
| 1 | Luo skripti `uc-tools`, liitä `uc_tools.js`, vaihda rivi `let MODE = "show";` muotoon `let MODE = "backup";`, tallenna ja käynnistä. | Konsolissa 10 riviä `BACKUP {...}` ja `Backup stored: 10 components`. **Kopioi BACKUP-rivit tekstitiedostoon.** Älä poista tätä skriptiä ennen kuin testi on valmis. |
| 2 | Pysäytä v2.4-skripti ja poista siltä käynnistys laitteen käynnistyessä. | Skripti pysähtyy. |
| 3 | Vaihda `uc-tools`-skriptissä `MODE = "delete"`, tallenna ja käynnistä. | `Done: 10 calls, 0 failed` ja `Current dynamic components: 0`. |
| 4 | Luo skripti `uponor-proto`, liitä `uponor_v3_proto.js`, valitse käynnistys laitteen käynnistyessä ja käynnistä. | Shellyssä näkyy ryhmä Uponor Clean, jossa on 8 komponenttia. Konsolissa `handles: 9/9` ja `state endpoint: http://…/script/N/state`. |
| 5 | Luo skripti `uponor-listen`, liitä `uponor_v3_listener.js`, valitse käynnistys laitteen käynnistyessä ja käynnistä. | Kuuntelijan konsoliin tulee 30 s välein tapahtuma; kolme ensimmäistä raakana (`raw {...}`). |
| 6 | Katso Shelly-sovellusta ja web-käyttöliittymää 1–2 min. | Phase, Cycle ja Warning vaihtuvat ja näyttävät otsikot (esim. "Sedimentation I"). Status-teksti päivittyy. Next pump-out näyttää ajan muodossa `2026-11-18T22:15:00+02:00`. |
| 7 | Yritä muuttaa Phase-arvoa sovelluksessa tai web-käyttöliittymässä. | Muutos ei onnistu (vain luku). |
| 8 | Kirjoita Chemical-kenttään 15. | Konsolissa `USER EDIT chemical: … -> 15`. Status: `User set chemical to 15`. |
| 9 | Odota simuloitu panos (5 min käynnistyksestä). | Batches ja Sludge kasvavat yhdellä, Chemical laskee 0,04. Konsolissa `own write confirmed`, ei `USER EDIT`. |
| 10 | Avaa selaimessa vaiheen 4 osoite. | JSON-vastaus, jossa `version`, `values` ja `mem`. |
| 11 | Avaa `http://<ip>/rpc/KVS.Get?key="uc_proto"`. | Arvossa `starts`, `chemical` ja `user_edits`. |
| 12 | Käynnistä Shelly uudelleen (asetuksista tai `http://<ip>/rpc/Shelly.Reboot`). Odota 2 min. | Konsolissa `start number 2` ja `EM1Data blocks in last 30 min: …` sekä blokkien aikaleimat. Chemical-arvo säilyi. |
| 13 | Pysäytä ja poista `uponor-proto`. Katso komponentit ja avaa vaiheen 11 osoite. | Prototyypin komponentit katosivat. `uc_proto` on yhä KVS:ssä. |
| 14 | Luo `uponor-proto` uudelleen samasta tiedostosta ja käynnistä. | Komponentit syntyvät uudelleen, Chemical palautuu KVS:stä, konsolissa `start number 3`. Kirjaa komponenttien ID:t (`role … id …`). |
| 15 | Pysäytä ja poista `uponor-proto` ja `uponor-listen`. | Komponentit katoavat. |
| 16 | Vaihda `uc-tools`-skriptissä `MODE = "restore"`, tallenna ja käynnistä. | `Done: … calls, 0 failed` ja 10 komponenttia samoilla avaimilla kuin ennen (esim. `boolean:201`). |
| 17 | Palauta v2.4:lle käynnistys laitteen käynnistyessä ja käynnistä se. | Prosessiviesti ja panoslaskuri palaavat. Home Assistantin entiteetit toimivat taas. |
| 18 | Vaihda `uc-tools`-skriptissä `MODE = "show"` ja pysäytä se. Skriptin voi poistaa myöhemmin. | – |

Jos jokin vaihe epäonnistuu, älä jatka poistovaiheisiin. Komponentit saa aina takaisin vaiheella 16, kunhan `uc-tools`-skripti on tallessa.

## Raportoi nämä

Kopioi konsolista ja kirjoita havainnot:

1. Prototyypin ensimmäiset rivit: `version …`, `sys: …`, `api: …`, `Date: …`, `offset from Sys: …`, `em1data:0 status: …`, `mem_used …`.
2. Rivit `role … id …` ja `group members: …`.
3. Jos prototyyppi ei käynnistynyt: koko virheilmoitus.
4. Rivi `change event (raw) …` vaiheesta 8.
5. Kuuntelijan kolme `raw`-riviä ja yksi `events … mem_used …` -rivi.
6. Vaiheen 10 JSON-vastaus.
7. Vaiheen 12 EM1Data-rivit.
8. Vaiheen 14 ID:t: samat kuin vaiheessa 4 vai eri?
9. Näkyikö ryhmä sovelluksessa? Näkyivätkö otsikot? Estikö vain luku -pääsy Phase-muutoksen sovelluksessa ja Home Assistantissa?
10. Muuttuivatko Home Assistantin v2.4-entiteettien nimet vaiheen 17 jälkeen?
