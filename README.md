# Uponor Clean – Shelly-seuranta

*English summary: process monitoring for the Uponor Clean I small wastewater treatment plant. A Shelly EM Mini Gen4 script recognises the control unit's process phases from power consumption, counts batches and estimates the next pump-out. A Home Assistant Lovelace card visualises the plant. Version 3 (in design) will work without Home Assistant and create its own virtual components.*

Shelly EM Mini Gen4 mittaa puhdistamon sähkönkulutusta. Skripti päättelee siitä ohjauskeskuksen vaiheet (ilmastus, annostelu, laskeutus, lietteen palautus, ulospumppaus, sisäänpumppaus, odotus- ja lomajakso), laskee panokset ja arvioi seuraavan ulospumppauksen. Home Assistant -kortti näyttää prosessin animoituna.

## Sisältö

| Kansio | Sisältö |
| --- | --- |
| `shelly/v2/` | Skripti v2.4 (nykyinen) ja v2.3. `*_shelly.js` on tiivistetty versio, joka mahtuu Shellyn editoriin. |
| `shelly/tools/` | `lataa_shellyyn.py` (lataus Shellyyn RPC:llä), `compact.py` (tiivistys), `make_v24.py` (v2.3 → v2.4 -muunnos). |
| `ha-card/` | Lovelace-kortti `uponor-clean-card.js` v1.5.0, ohje ja esikatselusivu. |
| `test/` | Node-testiympäristö: ajaa oikeaa skriptitiedostoa virtuaalikellolla, firmwaresimulaattori ja skenaariot. |
| `docs/` | Asennus- ja toimintadokumentaatio, firmwaren pseudokoodi ja v3-suunnitelma. |

## Asennus (v2.4)

Ks. `docs/uponor_shelly_dokumentaatio.md`. Lyhyesti: luo virtuaalikomponentit, liitä `shelly/v2/puhdistamo_skripti_v2_4_shelly.js` Shellyn skriptieditoriin tai lataa se `lataa_shellyyn.py`:llä ja käynnistä.

## Versiot

| Versio | Tila |
| --- | --- |
| v3.0 | Suunnittelussa: ei vaadi Home Assistantia, luo komponentit itse, firmwaren mukaiset vaiheet, englanninkieliset tekstit. |
| v2.4.0 | Käytössä. Firmwaren vaiheajat, ETA heti aloitustasosta, korkean veden ja tukkeutuneen lähdön varoitukset. |
| v2.3 | Paluuversio (v2.4 kaikki `v24_*`-kytkimet pois = sama toiminta). |

## Huomio ennen julkistamista

Repo on yksityinen. Ennen julkiseksi muuttamista tarkista:

- Mittausdataa (Home Assistantin historia-CSV:t) ei ole versionhallinnassa (`.gitignore`). Pidä se poissa jatkossakin.
- `ha-card/preview.html` sisältää oman laitteen mittausdatasta lasketun esimerkkijakson.
- `docs/firmware/` perustuu kolmannen osapuolen firmwarevedokseen. Varmista, että sen julkaiseminen on ok.
- Valitse lisenssi (esim. MIT).
