# Mitä skripti osaa ja mitä ei

[English](features.md) | **Suomi**

Shelly-skripti v3 päättelee kaiken puhdistamon ohjauskeskuksen sähkönkulutuksesta. Puhdistamoon ei asenneta antureita, eikä skripti ohjaa puhdistamoa. Se vertaa tehotasojen vaihteluja ohjauskeskuksen firmwaren vaiheaikoihin (Uponor Clean I, ohjauskortti A, ohjelmistoversio 2.1.2) ja seuraa niiden avulla, missä vaiheessa puhdistamo on.

Asennus: [`v3-asennus.md`](v3-asennus.md). Home Assistant: [`home-assistant.md`](home-assistant.md).

## Mitä skripti osaa

### Jaksot ja vaiheet

| Jakso | Tunnistetut vaiheet |
| --- | --- |
| Puhdistus (panos) | esi-ilmastus, ilmastus, kemikaalin täyttö, annostelu, sekoitus, laskeutus I, lietteen palautus, laskeutus II, ulospumppaus, sisäänpumppaus |
| Odotus | odotus, lietteen palautus, ilmastus, sisäänpumppaus (toistuu, kunnes aloitustaso saavutetaan) |
| Loma | loma-automatiikan odotukset, ilmastukset ja sisäänpumppaukset |
| Testi | ohjauskeskuksen Test-napin käynnistämä testijakso |

- Vaihe ja jakso päivittyvät muutamassa sekunnissa vaihteen jälkeen (alle 6 sekunnin tasot, kuten ohjauskeskuksen itsetestit, jätetään huomiotta). Lisäksi skripti näyttää vaihekoodin, jonka ohjauskeskuksen näyttö näyttää Test-napin lyhyellä painalluksella (esim. `S204`).
- Aloitustason saavuttaminen näkyy jakson vaihtumisena odotuksesta puhdistukseen.
- Sisäänpumppauksen sekoituspulssit erotetaan ilmastuksesta (alle 12 sekunnin piikki on pulssi).

### Laskurit

| Laskuri | Miten |
| --- | --- |
| Panokset | +1 ulospumppauksen lopussa (780 s sen alusta). Alkuarvoksi syötetään ohjauskeskuksen näytön lukema. Shelly-sovellus näyttää kasvun päiväkohtaisena graafina. |
| Kemikaali | −0,04 l jokaisesta annostelusta. Määrä syötetään täytön jälkeen. Skripti laskee myös, montako päivää kemikaali riittää viime päivien kulutuksella. |
| Liete | Panokset lietteen tyhjennyksestä. Muistutus 800 panoksen kohdalla (ohjauskeskuksen oletus). |

Laskurit tallentuvat Shellyn KVS-muistiin, joten ne säilyvät skriptin päivityksissä, uudelleenkäynnistyksissä ja sähkökatkoissa.

### Ennusteet

- **Seuraava ulospumppaus** kellonaikana, kun panos on alkanut (noin 2 h 45 min ennen ulospumppausta). Simulaattorissa virhe oli enintään 10 s.
- **Loma-automatiikan alku**: aika, jolloin odotusjakso vaihtuu lomajaksoksi, jos aloitustasoa ei saavuteta (noin 71 h odotusjakson alusta).
- **Kemikaalin riittävyys** päivinä.

### Varoitukset

| Varoitus | Mistä skripti sen päättelee |
| --- | --- |
| Ei sähköä | Puhdistamon teho on nolla yli minuutin, vaikka Shellyssä on virta |
| Suuri teho, tarkista ilmaletkut | Teho yli 62 W 2 minuuttia, esim. tukkeutunut ilmaletku |
| Tehomittaus puuttuu | Shelly ei anna tehoa |
| Kompressori ei käy | Kompressori ei ole käynyt 4 tuntiin |
| Lähtö tukossa? | Ulospumppauksen jälkeen alkaa heti uusi annostelu, koska aloitustaso ei laskenut |
| Korkea vesi | Ilmastus jäi pois tai katkesi kesken |
| Prosessi pysäytetty? | Ohjauskeskus on ollut pysähdyksissä yli 5 min odotettua pidempään (esim. pysäytys radiopaneelista) |
| Kemikaali vähissä | Kemikaali riittää alle 10 päivää |
| Lietteen tyhjennys | Lietelaskuri on 800 |
| Liete tyhjennetty? | Sisäänpumppauksen teho nousi noin 1 W, kuten tyhjennyksen jälkeen. Muistutus nollata lietelaskuri. |

Varoitukset näkyvät Warning-komponentissa (tärkein ensin) ja tilatekstissä, ja jokaisesta lähtee tapahtuma Home Assistantille.

### Poikkeustilanteet

- **Sähkökatko**: Shellyn käynnistyssyystä skripti tietää, että ohjauskeskus aloittaa uuden puhdistusjakson alusta, ja seuraa sitä heti.
- **Shellyn tai skriptin uudelleenkäynnistys** (esim. päivitys): skripti jatkaa tallennetusta vaiheesta ja arvioi katkon aikana alkaneet vaiheet firmwaren ajoista.
- **Pysäytys radiopaneelista**: vaihe jätetään odottamaan ja sitä jatketaan siirrettynä, kun sama tehotaso palaa.
- **Korkea vesi** (ilmastus ohitetaan tai katkeaa) ja **tukossa oleva lähtö** (uusi annostelu heti ulospumppauksen jälkeen) seurataan firmwaren mukaan.
- **Testijakso** tunnistetaan, eikä se kasvata panoslaskuria.

### Missä tiedot näkyvät

- Shellyn selainkäyttöliittymä ja Shelly-sovellus: 8 komponenttia ryhmässä Uponor Clean, ja panoslaskurin graafi sovelluksessa.
- Home Assistant: komponentit entiteetteinä, tapahtumat tapahtumaentiteettinä ja Lovelace-kortti ([`kortti.md`](kortti.md)).
- Selainsovellus kotiverkossa: livetiedot ja Shellyn tallentama tehohistoria ([`sovellus.md`](sovellus.md)).
- Tilakysely `http://<shellyn-ip>/script/<numero>/state` JSON-muodossa (esim. `curl`; selaimesta sama tila luetaan WebSocketin kautta).

## Mitä skripti ei osaa

**Se ei mittaa mitään suoraan.** Kaikki on päätelty sähkönkulutuksesta ja firmwaren ajoista.

- **Vedenpintaa ei mitata.** Aloitustason skripti tietää vain siitä, että panos alkoi. Kortin pinnat ovat arvioita.
- **Kemikaalin ja lietteen määrät ovat laskennallisia.** Kemikaali on syötetty määrä miinus annokset, ja liete on panosten määrä tyhjennyksestä. Täytöt ja tyhjennykset on merkittävä itse. Tyhjennysvihje on vain vihje.
- **Jäteveden määrä on arvio** (panokset × 170 l), ei mittaus.
- **Ohjauskeskuksen omia hälytyksiä ja näyttöä se ei näe.** Esimerkiksi ohjauskeskuksen virhekoodit tai hälytysvalo eivät näy, vain skriptin omat, tehosta päätellyt varoitukset.
- **Se ei ohjaa puhdistamoa.** Skripti ei voi käynnistää, pysäyttää tai kuitata mitään.
- **Vika, joka ei muuta sähkönkulutusta, ei näy.** Esimerkiksi biologisen prosessin toiminta, lähtevän veden laatu tai vuoto säiliössä eivät näy tehossa.
- **Tunnistus vaatii hetken.** Asennuksen tai pitkän katkon jälkeen vaihe on *Unknown*, kunnes skripti tunnistaa ensimmäisen vaiheen: odotusjaksossa yleensä alle tunnissa, puhdistusjaksossa viimeistään seuraavassa vaihteessa. Sähkökatkon jälkeen tieto on heti oikein.
- **Shellyn on mitattava vain puhdistamoa.** Jos samassa piirissä on muita laitteita, niiden teho sekoittaa tehotasot.
- **Tehotasot ja ajat on sovitettu yhteen puhdistamoon.** Rajat (2, 10, 24, 38,5, 52 ja 64 W 230 V:n jännitteellä) ja vaiheajat vastaavat Uponor Clean I:tä, jonka ohjauskortti A ja ohjelmisto 2.1.2. Muita malleja, kortteja, ohjelmistoversioita tai muutettuja huoltoasetuksia ei ole kokeiltu. Rajoja voi muuttaa asetuksista (`uc_cfg`), mutta vaiheajat ovat koodissa.
- **Kellonajat tarvitsevat synkronoidun kellon.** Ilman sitä vaiheet ja panokset toimivat, mutta kellonajat puuttuvat.
- **Shellyssä on tilaa yhdelle näin suurelle skriptille.** Skripti käyttää 9 virtuaalikomponenttipaikkaa 10:stä ja noin 15–19 kt muistista 25 kt:sta, joten muut suuret skriptit eivät mahdu rinnalle.
- **Historiaa skripti ei tallenna.** Laitteessa on vain laskurit ja nykyinen tila. Historia on Home Assistantissa tai Shelly-sovelluksen panosgraafissa.

## Tarkkuus

| Testi | Tulos |
| --- | --- |
| Firmwaresimulaattori, 14 skenaariota (normaalit jaksot, korkea vesi, lähtö tukossa, sähkökatkot, loma, testijakso, paneelipysäytys, viikon käyttö) | Vaiheet oikein 99,6–99,9 % ajasta, kaikki panokset, ulospumppauksen ennuste ±10 s |
| Tallennettu data heinä–lokakuu 2026 | 49 / 49 panosta samaan aikaan kuin v2.4 (±5 s) |
| Laite 19.11.2026 alkaen | Käytössä. Testattu Shelly EM Mini Gen4:llä (firmware 2.2.0). |

Yksityiskohdat: [`v3-testitulokset.md`](v3-testitulokset.md).

Jos skripti ei toimi toisella puhdistamolla, tehosta voi tehdä nauhoituksen vianetsintää varten: [Nauhoitus vianetsintää varten](v3-asennus.md#nauhoitus-vianetsintää-varten).
