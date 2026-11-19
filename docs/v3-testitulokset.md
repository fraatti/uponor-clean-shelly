# v3 – testitulokset 18.–19.11.2026

## Simulaattori (`test/v3_scenarios.js`)

Firmwaren pseudokoodista tehty simulaattori tuottaa tehosarjan ja jokaisen vaiheen oikean alun. Skripti ajetaan Shelly-jäljitelmässä sekunnin välein, kuten laitteessa.

| Skenaario | Vaiheet oikein | Panokset | ETA-virhe enintään | Varoitukset |
| --- | --- | --- | --- | --- |
| Normaalit jaksot, aloitustaso 1–5 sekoituspulssin jälkeen | 99,86 % | 7/7 | 10 s | – |
| Korkea vesi jakson alussa | 99,86 % | 3/3 | 10 s | high_water, poistuu |
| Korkea vesi katkaisee ilmastuksen | 99,85 % | 2/2 | 10 s | high_water, poistuu |
| Lähtö tukossa kahdesti | 99,85 % | 4/4 | 10 s | outlet_blocked, poistuu |
| Puhdistamon syöttö katki 10 min (Shelly päällä) | 99,79 % | 1/1 | 10 s | no_power, poistuu |
| Sähkökatko 5 min, Shelly myös pimeänä | 99,86 % | 2/2 | 10 s | – |
| Lomajakso 71 h jälkeen, sitten aloitustaso | 99,71 % | 2/2 | 10 s | – (loma 0,1 min firmwaresta) |
| Shellyn ohjelmistouudelleenkäynnistys ilmastuksessa | 99,89 % | 2/2 | 10 s | – |
| Shellyn uudelleenkäynnistys ulospumppauksessa | 99,85 % | 1/1 | 8 s | – |
| Korkea vesi odotusjakson tarkistuksessa | 99,76 % | 1/1 | 1 s | high_water, poistuu |
| Testijakso (Test-nappi) | 99,62 % | 0/0 | – | – |
| Paneelipysäytys 2 h ilmastuksessa / laskeutuksessa / ulospumppauksessa | 99,85 % | 1/1 | ≤ 10 s | paused, poistuu |
| Ensimmäinen käynnistys kesken odotusjakson | 99,76 % | 1/1 | 10 s | – |
| Viikko normaalia käyttöä | 99,83 % | 34/34 | 10 s | – |

Panokset osuvat firmwaren laskentahetkeen (780 s ulospumppauksen alusta) 1 s:n tarkkuudella. Kemikaali = 20 l − 0,04 l × annostelut kaikissa skenaarioissa.

## Tallennettu data (`test/v3_realdata.js`)

Home Assistantin historiasta (heinä-, syys- ja lokakuu 2026) ajettu teho ja jännite. Vertailuna v2.4 samalla datalla.

| Data | Panokset v3 / v2.4 | Aikaero | Tuntematon vaihe | Muuta |
| --- | --- | --- | --- | --- |
| 5.–10.7. | 11 / 11 | 0…−5 s | 0,75 % | 9.7. huolto: air_leak, no_power ja high_water oikeasti |
| 4.–7.7. | 4 / 4 | −2…−5 s | 0,00 % | |
| 7.7. | 2 / 2 | −1…−2 s | 0,00 % | |
| 8.7. | 1 / 1 | −4 s | 5,5 % | alun synkronointi |
| 11.7. | 2 / 2 | −2…−3 s | 0,00 % | |
| 13.–23.9. | 9 / 9 | −1…−4 s | 0,10 % | loma 21.9. klo 10.30.48 (v2.4: 10.50), tyhjennysvihje 18.9. klo 13.39 |
| 8.–18.10. | 20 / 20 | +2…−4 s | 0,05 % | skriptin uudelleenkäynnistykset jatkuvat oikeasta vaiheesta |

Tallennetun datan erityispiirteet, jotka skripti nyt sietää: tehon välilukemat kompressorin käynnistyessä ja pysähtyessä (4–5 s venttiili- tai annostelualueella), sekoituspulssi, joka näkyy osin ilmastusalueella, ja enintään 8 s pitkä pulssi. Tallennuksen katkot (Home Assistant ei saanut lukemia) ajetaan testissä skriptin uudelleenkäynnistyksenä ilman tallennettua vaihetta.

## Laite (kuivatesti 18.11.2026 klo 23.05–23.16)

v3 ajettiin laitteella ilman komponentteja ja KVS-kirjoituksia. v2.4 oli pysähdyksissä kahdesti noin 4 ja 2 minuuttia odotusjakson aikana.

| Mittaus | Tulos | Tavoite |
| --- | --- | --- |
| Muisti käytössä | 11,2 kt | – |
| Muistin huippu | 13,8 kt | ≤ 16 kt |
| Suoritin | 6–9 % (v2.4: 20–24 %) | ≤ 30 % |
| Kaikkien skriptien muisti yhteensä | 25,2 kt | – |

Havainnot:

- `Date.UTC` puuttuu laitteelta. Päivämäärä lasketaan omalla funktiolla, ja Shelly-jäljitelmä hylkää nyt `Date.UTC`:n.
- Ensimmäinen versio käytti 17,2 kt (huippu 20,9 kt). Muistia vievät eniten globaalit taulukot ja funktiot (mitattu: noin 28–56 tavua ominaisuutta ja 70–85 tavua funktiota kohden). Taulukot muutettiin funktioiksi ja harvoin muutettavat asetukset vakioiksi.
- `Sys.GetStatus` antaa `reset_reason` (3 = ohjelmistokäynnistys) ja `utc_offset`.
- v2.4 ja v3 eivät mahdu muistiin yhtä aikaa (v2.4:n rinnalla vapaata oli 10,5 kt).

## Asennus laitteelle 18.11.2026

v2.4 pysäytettiin ja sen komponentit poistettiin, ja v3 asennettiin skriptiksi 2 (`uponor-clean-v3`, *Run on startup*).

| Mittaus | Tulos |
| --- | --- |
| Muisti käytössä | 14,9 kt |
| Muistin huippu | 17,6 kt |
| Vapaata muistia | 10,3 kt |
| Komponentit | 9/10 (8 + ryhmä) |
| Batches | 249 (v2.4:n KVS-avaimesta) |

Muistin huippu ylittää suunnitellun 16 kt:n, koska komponenttien luonti ja KVS-kirjoitukset tulevat kuivatestin päälle. Vapaata jää noin 10 kt, joten v2.4 tai `uc-tools` ei voi olla samaan aikaan käynnissä.

Havainnot laitteella:

- `Array.prototype.shift`, `unshift` ja `concat` puuttuvat (firmware 2.2.0). `splice`, `slice`, `pop`, `push`, `indexOf` ja `join` toimivat. Skripti käyttää niitä, ja Shelly-jäljitelmä hylkää nyt puuttuvat funktiot.
- Home Assistantin Shelly-integraatio ei luo entiteettejä skriptin omistamille (`@meta`) komponenteille. Siksi v3 luo tavalliset komponentit `Virtual.Add`-kutsulla ja tallentaa niiden tunnukset KVS-avaimeen `uc_vc`. Skriptin omistamia komponentteja ei voi poistaa `Virtual.Delete`-kutsulla (virhe −107), vaan ne poistuvat skriptin mukana.
- Home Assistant löytää skriptin tapahtumatyypit vain skriptin ensimmäisestä 5 kt:sta. Tiivistetyn version toinen rivi mainitsee `Shelly.emitEvent("uponor", …)`, jolloin integraatio luo tapahtumaentiteetin.
- Shellyn käyttöliittymä näyttää lukutilan enum-arvon rikkinäisen kuvan kuvakkeen kanssa (käyttöliittymän ominaisuus, ei vaikuta arvoihin).
- Ensimmäinen odotusjakso laitteella (Home Assistantin historia): odotus 23.47.39, lietteen palautus 00.05.40, ilmastus 00.06.45, sisäänpumppaus 00.36.45 ja odotus 00.46.40, eli firmwaren 18 min, 1 min, 30 min ja 10 min. Skriptin päivitys (pysäytys ja käynnistys) odotuksen aikana jatkoi samasta vaiheesta. Lyhyet `unavailable`-tilat ovat integraation uudelleenlatauksia.

## Versio 3.0.1 (19.11.2026)

v2-yhteensopivuus poistettiin: skripti ei enää lue eikä kirjoita v2.4:n KVS-avaimia (`puhdistamo_batch_count`, `puhdistamo_process_message`), ja asetus `legacy_kvs` poistui. Ennen päivitystä panoslaskuri ja viimeisin ulospumppaus kirjoitettiin avaimeen `uc_batch`, koska v3.0.0 luki ne vielä v2.4:n avaimista. Laitteelta poistettiin v2.4-skripti, `uc-tools` ja v2.4:n KVS-avaimet.

| Mittaus | Tulos |
| --- | --- |
| Tiivistetty koko | 39 123 merkkiä (3.0.0: 40 415) |
| Muisti käytössä | 14,9 kt |
| Muistin huippu | 18,9 kt (sisältää komponenttien asetusten päivityksen versionvaihdossa) |
| Vapaata muistia | 10,3 kt |
| Päivitys odotusjakson ilmastuksessa | Jatkoi samasta vaiheesta, Batches 249 ja viimeisin ulospumppaus säilyivät |

Kaikki testit (skenaariot, tallennettu data, laitetesti, kortti) antavat saman tuloksen lähteellä ja tiivistetyllä versiolla.

## Versio 3.0.2 (19.11.2026): kaatuminen puhdistusjakson alussa

Skripti pysähtyi klo 7.31.48, kun laitteella alkoi ensimmäinen puhdistusjakso v3:n aikana (asennuksen jälkeen oli ollut vain odotusjaksoja):

```
Uncaught Error: Too much recursion - the stack is about to overflow
 at Shelly.getComponentStatus("sys") in nowUnix < unixAt < etaUnix < statusText < setVc("status", ...
```

Kutsuketju oli `tick > updateBand > onTransition > toAer > startCleaning > setPhase > refreshOutputs > statusText > etaUnix > unixAt > nowUnix`, eli natiivikutsu 11 funktion syvyydessä. Odotusjakson vastaava ketju (10 tasoa) oli toiminut. Vika oli jo versiossa 3.0.0, mutta testit eivät mitanneet pinon syvyyttä.

Korjaus:

- Tapahtumakäsittelijät vain muuttavat tilaa ja asettavat lippuja. `tick()` kirjoittaa tilatekstin, Phase-, Cycle- ja Warning-komponentit, `uc_cycle`-avaimen, muut KVS-kirjoitukset ja tapahtumat ylimmältä tasolta saman sekunnin lopussa.
- `unixAt` lukee kellon suoraan, ja tilatekstin pitkä lauseke on pilkottu.
- Käynnistys jatkuu komponenttien luonnin jälkeen uudesta ajastimesta.
- Shelly-jäljitelmä laskee skriptin kutsupinon jokaisessa natiivikutsussa ja hylkää yli 7 tason ketjut. Ennen korjausta jäljitelmä toisti kaatumisen; korjauksen jälkeen syvin ketju on 7 (`tick > updateBand > onTransition > toAer > pumpInEnded > pumpInSample > log`).
- Batches-komponentti sai pilvitilaston `counter` (Shelly-sovelluksen päiväkohtainen graafi, kuten v2.4:ssä).

Laitteella 3.0.2 asennettiin klo 8.05. Ennen käynnistystä `uc_cycle` asetettiin vastaamaan meneillään olevaa jaksoa (esi-ilmastus alkoi 7.31.48, ilmastus 600 s myöhemmin), jolloin skripti jatkoi ilmastuksesta ja arvioi ulospumppauksen klo 10.17. Pysähdyksen ajalta (7.31–8.05) Home Assistantiin ei tullut vaiheita.

| Mittaus | Tulos |
| --- | --- |
| Tiivistetty koko | 39 714 merkkiä |
| Muisti käytössä | 15,1 kt |
| Muistin huippu | 19,0 kt |
| Vapaata muistia | 10,1 kt |

## Kortti (`test/card_v3_test.js`)

Simuloitu v3-ajo (30 h, puhdistusjaksoja ja lähtö tukossa kerran) syötetään kortille historiana.

| Tarkistus | Tulos |
| --- | --- |
| Kortin vaihe = simulaattorin vaihe | 99,9 % (1740 näytettä) |
| Ulospumppauksen aika Next pump-out -entiteetistä | virhe ≤ 1 s |
| Kemikaali, lietelaskurin nollaus, editorit | oikein |
| Kortinvalitsimen entiteettihaku ja editorin kielivalinta | oikein |

## Tavoitteet

| Tavoite | Tulos |
| --- | --- |
| Panokset samat kuin v2.4, ±10 s | ✓ (enintään 5 s) |
| ETA-virhe ≤ 60 s | ✓ (enintään 10 s) |
| Vaiheet oikein ≥ 99 % simulaattorissa | ✓ (99,6–99,9 %) |
| Loma ±5 min | ✓ (simulaattori 0,1 min, syyskuu 0,8 min) |
| Syyskuun tyhjennysvihje 18.9. ja loma 21.9. klo 10.30 | ✓ |
| Ei vääriä varoituksia | ✓ |
| Kemikaali = annostelut × 0,04 | ✓ |
| Muistin huippu ≤ 16 kt, suoritin ≤ 30 % | Kuivatestissä ✓ (13,8 kt, 6–9 %). Asennettuna huippu 17,6 kt, vapaata 10,3 kt. |
| Tiivistetty versio toimii kuten lähde | ✓ (kaikkien testien tulokset identtiset) |
