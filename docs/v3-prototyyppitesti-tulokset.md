# v3-prototyyppi 1 – laitetestin tulokset 18.11.2026

Laite: Shelly EM Mini Gen4 (S4EM-001PXCEU16), firmware 2.2.0 (20261109-150305/2.2.0-g7968dca), aikavyöhyke Europe/Helsinki. Testi ajettiin selaimen kautta Shellyn RPC-rajapinnalla klo 21.48–22.06. v2.4 oli pysähdyksissä noin 10 min (klo 21.55–22.05), puhdistamo odotusjaksossa; panoksia ei jäänyt laskematta (249 ennen ja jälkeen).

## Tulokset

| Kohde | Tulos | Vaikutus suunnitelmaan |
| --- | --- | --- |
| `@meta`-lohko | **Firmware lukee lohkon vain tiedoston ensimmäiseltä 1024 tavulta.** Sen yli jäävät roolit ohitetaan ilman virhettä, ja jo luodut komponentit poistetaan. Täysi lohko (3,3 kt) loi vain Phase-komponentin. | `@meta` pidetään minimissä (nimi, tyyppi, pääsy, yksi vaihtoehto; 829 tavua). Vaihtoehdot, otsikot, näkymät ja rajat asetetaan `setConfig()`-kutsulla käynnistyksessä. |
| `setConfig()` | Toimii. Asetukset säilyvät skriptin uudelleenkäynnistyksessä, kun `@meta` ei muutu. | Kuten yllä. |
| Ryhmä `members` | 8 jäsentä, järjestys kuten `@meta`:ssa. | – |
| Vain luku -pääsy `rc` | Toinen asiakas: `Enum.Set` → `-107 Permission denied: Set!`. Kenttien oletuspääsy on `Crw`. | Toimii kuten suunniteltu. |
| Kentän muokkaus | `Number.Set` toisesta asiakkaasta → `change`-tapahtuma, skripti tunnisti muokkauksen. Tapahtuman muoto `{"source":2,"value":0}`. | Tapahtuma tulee myös skriptin omasta `setValue`-kutsusta, vaikka arvo ei muuttuisi, joten vertailu viimeksi kirjoitettuun arvoon on tarpeen. |
| KVS | Säilyy skriptin poistossa; uudelleenasennus palautti kentät (Chemical 14,96, Batches 1, Sludge 1). | Kuten suunniteltu. |
| Komponenttien ID:t | **Uudelleenasennuksessa ID:t vaihtuivat** (Phase `enum:200` → `enum:201`, Cycle päinvastoin). | Home Assistantin entiteetit voivat vaihtua uudelleenasennuksessa. Kirjataan ohjeeseen. |
| Skriptin poisto | Poisti kaikki skriptin omistamat komponentit. | Kuten dokumentaatiossa. |
| Tapahtumat | `Shelly.emitEvent` → toinen skripti (`ev.info.data`) ja WebSocket-asiakas (`NotifyEvent`, `{"component":"script:2","event":"uponor","data":{...}}`). | Historia, ilmoitukset ja HTML-sovellus voivat kuunnella tapahtumia suunnitellusti. |
| Tilakysely | `GET /script/N/state` palautti JSON:n. | Kuten suunniteltu. |
| Kello | `Date.toISOString` toimii, `getTimezoneOffset` puuttuu. Sys-ajasta laskettu siirtymä +120 min oikein. | Paikallinen ISO-aika lasketaan Sys-ajasta. |
| EM1Data | 24 h:n historiassa yksi yhtenäinen lohko, vaikka Shelly käynnistyi uudelleen firmware-päivityksessä samana iltana. | **Lyhyt uudelleenkäynnistys ei näy aukkona**, joten EM1Data ei erota Shellyn uudelleenkäynnistystä lyhyestä sähkökatkosta. Varmistus jätetään pois; käytetään KVS:n vaihetietoa ja itsekorjausta. |
| Muisti | Prototyyppi huippu 13,7 kt (asetukset, demo), probe 5,5 kt, kuuntelija 1,8 kt, työkalu 9,6 kt; v2.4 17,9 kt. Järjestelmän vapaa RAM noin 140 kt. | v3:n tavoite (enintään 16 kt) on realistinen. |
| Suoritin | v2.4 käyttää 20–24 %. | v3:ssa tavoite selvästi alempi. |
| Pino | Synkroninen rekursio noin 6 tasoa sulkeumineen kaatoi skriptin (`Too much recursion`). | **Ei rekursiota**; silmukat ja asynkroniset ketjut. |
| Suuret RPC-vastaukset | `Shelly.GetComponents` kaikkien asetusten kanssa (noin 3 kt) → `out_of_memory`. | RPC-vastaukset pidetään pieninä (`keys`-suodatin, yksi kerrallaan). |
| Palautus v2.4:ään | `uc_tools.js` palautti 10 komponenttia samoilla ID:illä; asetukset ja arvot identtiset alkuperäisen kanssa. v2.4 jatkoi normaalisti. | Paluu toimii. |

## Korjaukset testin aikana

- `uc_tools.js`: komponentit luetaan yksi kerrallaan (muisti), poisto ja palautus etenevät yksi kutsu kerrallaan ilman rekursiota, ja työ käynnistetään ajastimesta.
- `uponor_v3_proto.js`: minimaalinen `@meta` ja täydet asetukset `setConfig()`-kutsulla.
- `test/shelly_device_mock.js`: jäljitelmä hylkää yli 1024 tavun `@meta`-lohkon eikä nollaa `setConfig()`-asetuksia muuttumattomalla esittelyllä.

Laitteelle jäi `uc-tools`-skripti (pysäytetty, tila `show`), jossa on v2.4:n komponenttien varmuuskopio v3-siirtymää varten. Testiskriptit ja testien KVS-avaimet poistettiin.
