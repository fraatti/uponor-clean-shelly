# v3.0.0 – testitulokset 18.11.2026

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
| Muistin huippu ≤ 16 kt, suoritin ≤ 30 % | ✓ (13,8 kt kuivatestissä, 6–9 %) |
| Tiivistetty versio toimii kuten lähde | ✓ (kaikkien testien tulokset identtiset) |
