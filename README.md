# Uponor Clean – Shelly-seuranta

*English summary: process monitoring for the Uponor Clean I small wastewater treatment plant. A Shelly EM Mini Gen4 script recognises the control unit's process phases from power consumption, counts batches and estimates the next pump-out. A Home Assistant Lovelace card visualises the plant. Version 3 follows the control unit's firmware cycle phase by phase, works without Home Assistant and creates its own virtual components.*

Shelly EM Mini Gen4 mittaa puhdistamon sähkönkulutusta. Skripti päättelee siitä ohjauskeskuksen vaiheet (ilmastus, annostelu, laskeutus, lietteen palautus, ulospumppaus, sisäänpumppaus, odotus- ja lomajakso), laskee panokset ja arvioi seuraavan ulospumppauksen. Home Assistant -kortti näyttää prosessin animoituna.

## Sisältö

| Kansio | Sisältö |
| --- | --- |
| `shelly/v2/` | Skripti v2.4 (nykyinen) ja v2.3. `*_shelly.js` on tiivistetty versio, joka mahtuu Shellyn editoriin. |
| `shelly/v3/` | Skripti v3.0.0: `uponor_clean_v3.js` (lähde) ja `uponor_clean_v3_shelly.js` (tiivistetty, ladataan Shellyyn). Asennus: `docs/v3-asennus.md`. |
| `shelly/v3/proto/` | v3-prototyyppi 1 laitetestiin: `uponor_v3_probe.js` (osa A, v2.4:n rinnalla), `uponor_v3_proto.js`, `uponor_v3_listener.js` ja komponenttien varmuuskopio- ja palautustyökalu `uc_tools.js`. Ohje: `docs/v3-prototyyppitesti.md`. |
| `shelly/tools/` | `lataa_shellyyn.py` (lataus Shellyyn RPC:llä), `compact.py` (tiivistys), `make_v24.py` (v2.3 → v2.4 -muunnos). |
| `ha-card/` | Lovelace-kortti `uponor-clean-card.js` v1.5.0, ohje ja esikatselusivu. |
| `test/` | Node-testiympäristö: ajaa oikeaa skriptitiedostoa virtuaalikellolla, firmwaresimulaattori ja skenaariot. v3: `v3_scenarios.js`, `v3_realdata.js` ja `v3_device_test.js` Shelly-jäljitelmässä (`shelly_device_mock.js`). |
| `docs/` | Asennus- ja toimintadokumentaatio, firmwaren pseudokoodi, v3-suunnitelman tiivistelmä (`v3-suunnitelma.md`), v3:n asennus (`v3-asennus.md`) ja testitulokset (`v3-testitulokset.md`). |

## Asennus

v3: ks. `docs/v3-asennus.md` (siirtymä v2.4:stä ja paluu).

v2.4:

ks. `docs/uponor_shelly_dokumentaatio.md`. Lyhyesti: luo virtuaalikomponentit, liitä `shelly/v2/puhdistamo_skripti_v2_4_shelly.js` Shellyn skriptieditoriin tai lataa se `lataa_shellyyn.py`:llä ja käynnistä.

## Versiot

| Versio | Tila |
| --- | --- |
| v3.0.0 | Valmis asennettavaksi (haara `v3`): ei vaadi Home Assistantia, luo komponentit itse, firmwaren mukaiset vaiheet ja jaksot, kemikaali- ja lietelaskuri, varoitukset, tapahtumat. Testattu simulaattorilla ja tallennetulla datalla, laitteella kuivatesti. |
| v2.4.0 | Käytössä. Firmwaren vaiheajat, ETA heti aloitustasosta, korkean veden ja tukkeutuneen lähdön varoitukset. |
| v2.3 | Paluuversio (v2.4 kaikki `v24_*`-kytkimet pois = sama toiminta). |

## Huomio ennen julkistamista

Repo on yksityinen. Ennen julkiseksi muuttamista tarkista:

- Mittausdataa (Home Assistantin historia-CSV:t) ei ole versionhallinnassa (`.gitignore`). Pidä se poissa jatkossakin.
- `ha-card/preview.html` sisältää oman laitteen mittausdatasta lasketun esimerkkijakson.
- `docs/firmware/` perustuu kolmannen osapuolen firmwarevedokseen. Varmista, että sen julkaiseminen on ok.
- Valitse lisenssi (esim. MIT).
