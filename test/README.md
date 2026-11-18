# Testit

Testit ajavat oikeaa skriptitiedostoa Nodessa. Shellyn rajapinnat (RPC, KVS, virtuaalikomponentit, ajastimet) on korvattu jäljitelmillä ja kello on virtuaalinen, joten viikkojen data ajetaan sekunneissa.

| Tiedosto | Tehtävä |
| --- | --- |
| `harness.js` | Ajoympäristö: lukee HA-historian CSV:n, syöttää tehon ja jännitteen skriptille, kerää tilat ja viestit. |
| `fwsim.js` | Ohjauskeskuksen firmwaresimulaattori: tuottaa synteettisen tehosarjan pseudokoodin vaiheajoista. |
| `scenarios.js` | Firmwareskenaariot (korkea vesi, lähtö tukossa, sähkökatko, odotus- ja lomajakso, testijakso). |
| `validate.js` | Panosmäärät ja siirtymät oikeaa dataa vasten. |
| `compare.js` | Kahden version vertailu (esim. v2.3 ja v2.4). |
| `eqtest.js` | Varmistaa, että kaksi skriptiä (esim. lähde ja tiivistetty) tuottavat samat tulokset. |

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

`shelly_device_mock.js` jäljittelee yhtä Shelly-laitetta, jossa on useita skriptejä: `@meta`-komponentit ja niiden omistajuus, laitekohtainen 10 komponentin raja, KVS, `Script.storage`, tapahtumat skriptien välillä, HTTP-osoitteet ja uudelleenkäynnistys. Lisäksi se tarkistaa, ettei koodissa ole Shellyn tukemattomia kieliominaisuuksia (nuolifunktiot, template-literaalit, `const`, luokat, funktion kutsu ennen sen määrittelyä).

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
node v3_device_test.js      # komponentit, käyttäjän muokkaukset, KVS-siirtymä, uudelleenasennus
V3_FILE=../shelly/v3/uponor_clean_v3_shelly.js node v3_scenarios.js   # tiivistetty versio
```

`v3run.js` ajaa skriptin jäljitelmässä tehosyötteen kanssa (sähkökatkot Shellyn kanssa tai ilman, Shellyn ja skriptin uudelleenkäynnistykset, käyttäjän muokkaukset) ja vertaa vaiheita simulaattorin todellisiin vaiheisiin. Simulaattori (`fwsim.js`) kirjaa jokaisen vaiheen alun ja annostelut, ja siinä voi pysäyttää prosessin paneelista (`pauses`). Tulokset: `docs/v3-testitulokset.md`.
