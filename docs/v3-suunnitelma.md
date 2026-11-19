# Puhdistamoskripti v3 – suunnitelma

Suunnitelman ajantasainen versio on Claude Docs -dokumentissa (yksityinen):
https://claude.ai/artifact/KPHL42Q6ccvpDkne5X2qkA

Toteutus ja asennus: `docs/v3-asennus.md`, Home Assistant: `docs/home-assistant.md`, testit: `docs/v3-testitulokset.md`.

Tiivistelmä (18.11.2026):

- Skripti toimii ilman Home Assistantia ja luo komponenttinsa itse (firmware ≥ 2.2.0). Toteutuksessa `@meta`-lohko vaihtui `Virtual.Add`-kutsuun, koska Home Assistant ei näytä skriptin omistamia komponentteja (`docs/v3-testitulokset.md`).
- Komponentit: Phase, Cycle, Status, Warning, Next pump-out, Batches, Chemical, Sludge ja ryhmä Uponor Clean (9/10 paikkaa).
- Prosessimalli peilaa ohjausyksikön firmwaren jaksot (puhdistus, odotus, loma, testi) ja vaiheet; ETA ankkuroidaan vaiheiden alkuihin.
- Kaikki tekstit englanniksi, arvot kieliriippumattomina avaimina.
- Kemikaali: käyttäjä syöttää litrat täytön jälkeen, −0,04 l / annostelu, varoitus alle 10 vrk:n riittävyydellä.
- Liete: nollaus kirjoittamalla 0, muistutus 800 panoksessa (firmwaren SLUDGE_LIMIT), tyhjennyksestä vain vihje.
- Pysyvä tieto KVS:ssä (`uc_*`), joka säilyy skriptin päivityksessä ja poistossa.
- Laajennusvaraus: `Shelly.emitEvent("uponor", …)` -tapahtumat ja `/script/<id>/state`-tilakysely historiaa, ilmoituksia, HTML-sovellusta ja radiolaitetta varten.
