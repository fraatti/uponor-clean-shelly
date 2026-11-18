# Uponor Clean v3 – asennus ja siirtymä v2.4:stä

Skripti `shelly/v3/uponor_clean_v3_shelly.js` (lähde `uponor_clean_v3.js`) seuraa ohjauskeskuksen firmwaren vaiheita sähkönkulutuksesta ja luo omat virtuaalikomponenttinsa. Home Assistantia ei tarvita.

## Edellytykset

- Shelly, jossa on em1- tai pm1-tehomittaus (testattu: EM Mini Gen4, firmware 2.2.0).
- Aikavyöhyke asetettu ja kello synkronoitu (Settings → Time). Ilman kelloa vaiheet ja panokset toimivat, mutta kellonajat puuttuvat.
- Shelly ja puhdistamo ovat samassa sähkönsyötössä. Skripti päättelee Shellyn käynnistyssyystä (`reset_reason`), oliko kyseessä sähkökatko (puhdistamo aloittaa uuden puhdistusjakson) vai Shellyn oma uudelleenkäynnistys (puhdistamo jatkaa).

## Muistiraja

Kaikilla skripteillä on yhteensä noin 25 kt muistia. v3 käyttää noin 11 kt (huippu 14 kt) ja v2.4 noin 15 kt (huippu 18 kt), joten **v2.4 ja v3 eivät voi olla käynnissä yhtä aikaa**. Myös `uc-tools` pidetään pysäytettynä.

## Siirtymä v2.4:stä

Komponenttiraja on 10. v2.4:n 10 käsin luotua komponenttia poistetaan ennen v3:n asennusta. Ne on varmuuskopioitu `uc-tools`-skriptiin 18.11.2026.

1. **Tarkista varmuuskopio.** Avaa `uc-tools`, aseta `MODE = "show"`, käynnistä ja katso konsolista, että varmuuskopiossa on 10 komponenttia.
2. **Pysäytä v2.4.** Pysäytä `Uponor_script` ja poista siltä *Run on startup*. Tee tämä puhdistamon odotusjakson aikana, ei ulospumppauksen aikana.
3. **Poista v2.4:n komponentit.** `uc-tools`: `MODE = "delete"`, tallenna ja käynnistä. Konsolissa pitää lukea `Done, 0 failed.`. Pysäytä `uc-tools`.
4. **Asenna v3.** Luo uusi skripti (esim. `uponor-clean-v3`) ja lataa koodi:
   ```
   python3 shelly/tools/lataa_shellyyn.py <shellyn-ip> <skriptin-id> shelly/v3/uponor_clean_v3_shelly.js --kaynnista
   ```
   Lataustyökalu kirjoittaa koodin paloina ja vertaa sen laitteelta luettuun. Tiedoston alussa oleva `@meta`-lohko luo yhdeksän komponenttia (Phase, Cycle, Status, Warning, Next pump-out, Batches, Chemical, Sludge ja ryhmä Uponor Clean). Lohkon on oltava tiedoston alussa ja mahduttava ensimmäiseen 1024 tavuun.
5. **Ota automaattinen käynnistys käyttöön** (*Run on startup*).
6. **Tarkista.** Batches-arvon pitää olla sama kuin v2.4:n viimeisin (v3 lukee sen v2.4:n KVS-avaimesta). Phase ja Cycle näyttävät aluksi `Unknown`, kunnes skripti tunnistaa ensimmäisen vaiheen (odotusjaksossa yleensä alle tunnin kuluessa). Tila: `http://<shellyn-ip>/script/<id>/state`.
7. **Syötä arvot puhdistamon näytöltä.**
   - *Chemical*: kemikaalin määrä astiassa litroina. Täytön jälkeen syötä uusi määrä.
   - *Sludge*: lietelaskuri. Nollaa tyhjennyksen jälkeen.
   - *Batches*: jos se eroaa puhdistamon näytöstä, syötä näytön lukema. Laskenta jatkuu siitä.

Home Assistantin Shelly-integraatio tuo uudet komponentit uusina entiteetteinä. Nykyinen kortti (v1.5) käyttää v2.4:n entiteettejä. Kortin v1.6 tekee tämän siirtymän.

## Paluu v2.4:ään

1. Pysäytä ja **poista** v3-skripti. Poisto poistaa myös sen komponentit, ja KVS-tiedot (`uc_*`) säilyvät.
2. `uc-tools`: `MODE = "restore"`, tallenna ja käynnistä. Komponentit palautuvat samoilla ID:illä ja asetuksilla.
3. Käynnistä `Uponor_script` ja ota *Run on startup* takaisin käyttöön.

v3 päivittää myös v2.4:n KVS-avaimet `puhdistamo_batch_count` ja `puhdistamo_process_message`, joten panosmäärä on paluun jälkeen ajan tasalla.

## Komponentit

| Komponentti | Tyyppi | Sisältö |
| --- | --- | --- |
| Phase | enum, vain luku | `pre_aeration`, `aeration`, `chem_filling`, `dosing`, `mixing`, `sedimentation_1`, `sludge_removal`, `sedimentation_2`, `pump_out`, `pump_in`, `waiting`, `off`, `unknown` |
| Cycle | enum, vain luku | `cleaning`, `waiting`, `holiday`, `test`, `unknown` |
| Status | text, vain luku | Esim. "Pump-out at 14:35 (in 1 h 12 min)" tai "Waiting for wastewater \| last pump-out 2026-11-18 10:43", ja tärkein varoitus |
| Warning | enum, vain luku | Tärkein varoitus, ks. alla |
| Next pump-out | text, vain luku | Seuraavan ulospumppauksen alku paikallisena ISO-aikana, tyhjä kun ei tiedossa |
| Batches | number | Panoslaskuri, käyttäjä voi muokata |
| Chemical | number (l) | Kemikaalia astiassa, vähenee 0,04 l annostelua kohden |
| Sludge | number | Lietelaskuri (kuten puhdistamon oma), nollataan tyhjennyksessä |

Varoitukset tärkeysjärjestyksessä: `no_power` (ei sähköä yli 1 min), `air_leak` (teho yli 62 W 2 min, tarkista ilmaletkut), `no_signal` (tehomittaus puuttuu), `compressor_idle` (kompressori ei ole käynyt 4 h), `outlet_blocked` (ulospumppauksen jälkeen uusi annostelu), `high_water` (ilmastus jäi pois tai katkesi), `paused` (prosessi pysähtynyt, esim. paneelista), `chemical_low` (alle 10 päivän kulutus), `sludge_due` (lietelaskuri 800), `sludge_emptied` (sisäänpumppauksen teho nousi, liete tyhjennetty? nollaa Sludge).

## Asetukset

Asetuksia voi muuttaa KVS-avaimella `uc_cfg` (JSON), esim. `{"sludge_limit": 600, "chem_warn_days": 14}`. Muutos tulee voimaan skriptin uudelleenkäynnistyksessä.

| Asetus | Oletus | Merkitys |
| --- | --- | --- |
| `off_max`, `idle_max`, `valve_max`, `dosing_max`, `comp_max`, `aer_max` | 2, 10, 24, 38,5, 52, 64 | Tehoalueiden ylärajat (W, normalisoitu 230 V:iin) |
| `debounce_s` | 6 | Tätä lyhyemmät tasot ohitetaan |
| `dose_l` | 0,04 | Kemikaalia annostelua kohden (l) |
| `chem_warn_days` | 10 | Kemikaalivaroitus, kun jäljellä alle näin monen päivän kulutus |
| `sludge_limit` | 800 | Lietemuistutuksen raja (puhdistamon oletus), 0 = pois |
| `emptying_hint` | true | Tyhjennysvihje sisäänpumppauksen tehosta |
| `fault_high_w` | 62 | Ilmavuotovaroituksen raja (W) |
| `legacy_kvs` | true | Päivitä myös v2.4:n KVS-avaimet |

## KVS-avaimet

| Avain | Sisältö |
| --- | --- |
| `uc_batch` | `{n, ts}`: panokset ja viimeisimmän ulospumppauksen aika |
| `uc_chem` | `{l, day, d}`: kemikaali, päivä ja 14 päivän annostelumäärät |
| `uc_sludge` | `{n, reset}`: lietelaskuri ja viimeisin nollaus |
| `uc_cycle` | jakso, vaihe ja niiden alku (jatkaminen skriptin päivityksen jälkeen), odotusjakson alku (lomajakson ennuste) |
| `uc_base` | sisäänpumppauksen perustaso tyhjennysvihjettä varten |
| `uc_cfg` | käyttäjän asetukset |

## Tapahtumat

Skripti lähettää tapahtuman `uponor` (`Shelly.emitEvent`), jonka muut skriptit ja WebSocket-asiakkaat voivat kuunnella. Kentät: `v` (1), `type` (`phase`, `batch`, `warning`, `chemical`, `sludge`, `start`), `ts` ja tyypin tiedot. Historia ja ilmoitukset voidaan myöhemmin rakentaa näiden varaan muuttamatta v3-skriptiä.
