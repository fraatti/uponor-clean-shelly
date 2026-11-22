# Uponor Clean -prosessin Shelly-tunnistus

Versio 2.4 — 28.10.2026

Tämä dokumentti kuvaa Uponor Clean -puhdistamon Shelly-skriptin toiminnan, tehdyt muutokset ja simulaatiotulokset.

Skriptistä on kaksi toiminnallisesti identtistä tiedostoa sekä edellinen versio paluuta varten:

| Tiedosto | Käyttö |
|---|---|
| `puhdistamo_skripti_v2_4.js` | kommentoitu referenssiversio (63,8 KB); muutokset tehdään tähän |
| `puhdistamo_skripti_v2_4_shelly.js` | tiivistetty versio Shellyyn liitettäväksi (49 068 merkkiä); kommentit ja sisennykset poistettu, asetukset yksi per rivi |
| `lataa_shellyyn.py` | lataa minkä tahansa version laitteelle paloina, jos editori katkaisee liitetyn tekstin (ks. Asennus) |
| `puhdistamo_skripti_v2_3.js`, `puhdistamo_skripti_v2_3_shelly.js` | edellinen versio; säilytetään paluuta varten |

Tiivistetty versio on tarpeen, jos Shellyn web-editori katkaisee liitetyn tekstin noin 50 000 merkin kohdalla (ks. Asennus). Molemmat versiot tuottavat kaikilla testiaineistoilla tavu tavulta saman tuloksen.

Version 2.4 muutokset perustuvat ohjauskeskuksen firmwaresta purettuun toimintalogiikkaan; ne on koottu lukuun "Versio 2.4: firmwaren vaiheajat". Versioiden 2.1–2.3 muutokset ovat luvussa "Versioissa 2.1–2.3 tehdyt muutokset". Luku "Simulaatiotulokset" kuvaa version 2.0 lähtötason testauksen.

## Yhteenveto (versio 2.0, lähtötaso)

- Mittausaineisto sisältää 20 044 tehomittausta ajalta 5.7.2026 klo 00.00.00–10.7.2026 klo 15.19.59 Suomen kesäaikaa, yhteensä 5 vrk 15 h 19 min 59 s.
- Alkuperäinen skripti tunnisti 11 käsitellyn veden poistopumppausta ja kasvatti tyhjästä aloitetun testilaskurin arvoon 11.
- Kaikki 11 poistopumppausta tunnistettiin tunnetun prosessijärjestyksen kautta. Yhtään epäselvää `COMP_45`-jaksoa ei tarvinnut tulkita poistopumppaukseksi pelkän 10 minuutin keston perusteella.
- Poistopumppausten kesto oli 12 min 56 s–15 min 05 s, keskimäärin 13 min 11 s. Kaikki ylittivät skriptin 10 minuutin laskentarajan.
- Uuden version prosessitulokset ovat 230 V:n simulaatiossa samat kuin alkuperäisen: samat 11 erää, samat tilat ja samat 506 tilasiirtymää.
- Uusi versio pienensi simuloitujen RPC-kutsujen määrän 89 030:stä 37 372:een eli noin 58 %, pääasiassa harventamalla varmistussynkronoinnin yhdestä minuutista viiteen minuuttiin.
- Skriptitiedoston koko pieneni noin 50,4 kilotavusta 48,1 kilotavuun.
- CSV ei sisällä jännitemittausta. Simulaatiossa käytettiin 230 V:ia. Uusi skripti käyttää oikeaa mitattua jännitettä aina kun se on saatavilla ja jatkaa nimellisellä 230 V:lla, jos jännite puuttuu.

Simulaatio todentaa skriptin sisäisen johdonmukaisuuden tällä aineistolla. CSV:ssä ei ole Uponorin omia vaihe- tai lähtötietoja vertailuarvoksi, joten tulos ei yksin todista jokaisen tunnistetun vaiheen fyysistä oikeellisuutta.

## Simulointitapa

Skripti suoritettiin testikehyksessä sellaisenaan Shellyn rajapinnat jäljitellen:

1. CSV:n rivit järjestettiin aikaleiman mukaan.
2. Skriptin yhden sekunnin pääsilmukka ajettiin koko 487 199 sekunnin jakson yli.
3. Uusin teho pidettiin voimassa seuraavaan CSV-riviin saakka, kuten tilapohjaisesta Home Assistant -historiasta tehtävässä uusinnassa on välttämätöntä.
4. `em1:0`-komponentti ja 230 V:n jännite simuloitiin. KVS:n erälaskurin lähtöarvoksi asetettiin 0.
5. Skriptin kolmen sekunnin suodatus, vahvistusajat, sekvenssit, ETA-laskenta, epäselvän kompressorijakson käsittely ja erälaskenta ajettiin alkuperäisellä logiikalla.

Mittausrivien välin mediaani oli noin 15,7 sekuntia. Pisin riviväli oli noin 62 min 19 s ja yli 10 minuutin välejä oli kaksi. Testissä viimeisin arvo pidettiin näidenkin välien yli. Tuotannossa skripti yrittää lukea komponentin nykytilan uudelleen, kun tehosignaali on ollut 600 sekuntia päivittymättä.

### Simulaation oletukset ja rajat

- Jännite puuttuu CSV:stä, joten käytetty 230 V tekee normalisoidusta tehosta saman kuin CSV:n teho.
- CSV on Home Assistantin historiaa eikä Shellyn kaikkien sisäisten statusilmoitusten täydellinen loki.
- Skriptin KVS-laskuri aloitettiin testissä nollasta. Tuotannossa uusi skripti jatkaa KVS:ään tallennetusta arvosta.
- Viimeisen CSV-rivin kohdalla prosessi oli ilmastusvaiheessa, joten aineisto päättyy kesken seuraavan erän.
- Aikaleimat on tässä dokumentissa muunnettu Suomen kesäaikaan (EEST, UTC+3).

## Simulaatiotulokset

### Havaitut tehoalueet

| Tehoalue | Aika | Osuus |
|---|---:|---:|
| `IDLE` | 43,20 h | 31,92 % |
| `VALVE_ONLY` | 0,29 h | 0,21 % |
| `DOSING_COMP` | 0,05 h | 0,03 % |
| `COMP_45` | 22,89 h | 16,91 % |
| `AERATION` | 67,90 h | 50,18 % |
| `BOOST` | 1,00 h | 0,74 % |
| `UNKNOWN` | 2 s | alle 0,01 % |

### Home Assistantiin näkyvät prosessitilat

| Prosessitila | Aika | Osuus |
|---|---:|---:|
| Unknown | 6 min 54 s | 0,08 % |
| Tank Filling | 19,67 h | 14,54 % |
| Aeration | 67,63 h | 49,97 % |
| Chemical Dosing | 0,31 h | 0,23 % |
| Settling | 42,89 h | 31,69 % |
| Sludge Return | 2,30 h | 1,70 % |
| Treated Water Discharge | 2,42 h | 1,79 % |

### Tunnistetut poistopumppaukset

Erälaskuri kasvaa vasta poistovaiheen päättyessä, jos vaihe on kestänyt vähintään 600 sekuntia.

| Erä | Poistopumppaus alkoi | Päättyi / laskuri kasvoi | Kesto |
|---:|---|---|---:|
| 1 | 5.7.2026 04.48.43 | 5.7.2026 05.01.46 | 13 min 03 s |
| 2 | 5.7.2026 15.52.45 | 5.7.2026 16.05.41 | 12 min 56 s |
| 3 | 6.7.2026 01.55.52 | 6.7.2026 02.10.57 | 15 min 05 s |
| 4 | 7.7.2026 01.47.21 | 7.7.2026 02.00.21 | 13 min 00 s |
| 5 | 7.7.2026 14.47.30 | 7.7.2026 15.00.29 | 12 min 59 s |
| 6 | 7.7.2026 20.54.32 | 7.7.2026 21.07.33 | 13 min 01 s |
| 7 | 8.7.2026 19.57.04 | 8.7.2026 20.10.06 | 13 min 02 s |
| 8 | 9.7.2026 01.08.49 | 9.7.2026 01.21.50 | 13 min 01 s |
| 9 | 9.7.2026 15.15.39 | 9.7.2026 15.28.39 | 13 min 00 s |
| 10 | 10.7.2026 02.16.47 | 10.7.2026 02.29.46 | 12 min 59 s |
| 11 | 10.7.2026 12.19.56 | 10.7.2026 12.32.54 | 12 min 58 s |

Lisäksi skripti käynnisti epäselvän `COMP_45`-jakson käsittelyn 10 kertaa. Kuusi lyhyttä, 58–98 sekunnin jaksoa vahvistui todennäköiseksi lietteen palautukseksi ja neljä jäi noin kuuden sekunnin lyhyiksi kompressorijaksoiksi. Yksikään niistä ei kasvanut 600 sekunnin poistopumppaukseksi.

## Skriptin toiminta

### 1. Tehon lukeminen ja normalisointi

Skripti etsii ensimmäisen saatavilla olevan komponentin tässä järjestyksessä:

1. `em1:0`
2. `pm1:0`
3. `switch:0`

Teho normalisoidaan 230 V:iin, kun teho ylittää lepotilan rajan:

`P_norm = (P - 4 W) × (230 V / U)^2 + 4 W`

Alle tai enintään 10 W:n mittauksia ei jännitekorjata. Jos jännitettä ei saada, versio 2.0 käyttää 230 V:n nimellisjännitettä ja tulostaa tästä yhden varoituksen konsoliin.

### 2. Tehoalueet

| Alue | Ehto normalisoidulle teholle | Päämerkitys |
|---|---:|---|
| `IDLE` | alle 10,0 W | laskeutus / laitteet levossa |
| `VALVE_ONLY` | 10,0–24,0 W | kemikaaliventtiili |
| `DOSING_COMP` | yli 24,0–38,5 W | annostelu ja kompressori |
| `COMP_45` | yli 38,5–52,0 W | pumppaus tai lietteen palautus; sekvenssi ratkaisee |
| `AERATION` | yli 52,0–64,0 W | ilmastus |
| `BOOST` | yli 64,0 W | ilmastus sekä pumppu / täyttöpiikki |
| `UNKNOWN` | rajojen ulkopuolinen aukko | suojatila; nykyrajoilla käytännössä vain alustuksessa |

Uusi tehoalue hyväksytään vakaaksi vasta kolmen peräkkäisen yhden sekunnin kierroksen jälkeen. Raaka teho vaikuttaa silti ilmastuksen ja pumppupiikkien virtuaaliantureihin heti.

### 3. Prosessitilat

| Tila | Enum-arvo | Boolean-anturi |
|---|---:|---|
| Unknown | `U` | kaikki prosessibooleansensorit pois, paitsi raakatehosta johdettu ilmastus |
| Tank Filling | `F` | Pump In |
| Aeration | `A` | Aeration |
| Chemical Dosing | `C` | Dosing |
| Settling | `S` | ei erillistä boolean-anturia (laskeutus I ja II) |
| Waiting | `W` | ei erillistä boolean-anturia (odotus- ja lomajakson lepo; versiosta 2.4, vaatii enum-vaihtoehdon W) |
| Sludge Return | `R` | Sludge Removal |
| Treated Water Discharge | `D` | Pump Out |

`COMP_45` ei yksin kerro, onko käynnissä täyttö, lietteen palautus vai poistopumppaus. Skripti ratkaisee merkityksen edeltävistä tiloista, laskeutuksen kestosta, odotetusta poistovaiheesta ja pumppupiikkikuviosta.

Pääjakso, joka johtaa laskettavaan erään, on:

`Aeration → Chemical Dosing → lyhyt Aeration → pitkä Settling → Sludge Return → viimeinen Settling → Treated Water Discharge`

Poistopumppaus kasvattaa laskuria vain, jos `COMP_45`-vaihe kestää vähintään 600 sekuntia. Lyhyt samantehoinen jakso ei kasvata laskuria.

### 4. Pumppupiikkikuvio ja ETA

- Piikiksi tulkitaan vähintään 60,0 W (versiosta 2.1 alkaen; aiemmin 62,0 W, jolloin osa aidoista 61,2–61,6 W:n piikeistä jäi tunnistamatta).
- Kuvio saa alkaa vain vahvistetusta ilmastuksesta.
- Hyväksyttyjen piikkien väli on 80–160 sekuntia.
- Hyväksytty kuvio sisältää kaksi tai kolme piikkiä.
- Viimeisen piikin jälkeen ilmastuksen on vahvistuttava 240 sekunnin kuluessa.
- Kahdelle ja kolmelle piikille asetettu kokonaisaika poistopumppaukseen on sama, 10 000 sekuntia. Arvo on todennettu syyskuun 2026 datalla: kaikissa kahdeksassa erässä purku alkoi noin 165,6 min kuluttua ETA:n käynnistymisestä, eli virhe oli alle minuutin.

ETA tarkentuu prosessin edetessä annostelun, lyhyen ilmastuksen, pitkän laskeutuksen, lietteen palautuksen ja viimeisen laskeutuksen kohdalla. Näkyvä teksti pyöristetään ensin minuutteihin ja viimeisen minuutin aikana kymmeniin sekunteihin.

### 5. Epäselvä `COMP_45`

Jos kompressoriteho alkaa ilman luotettavaa sekvenssikontekstia:

- tila pysyy ensin `Unknown`-tilassa;
- 45 sekunnin jälkeen vaihe näkyy todennäköisenä lietteen palautuksena;
- vähintään 600 sekunnin yhtäjaksoinen vaihe voidaan tulkita poistopumppaukseksi;
- poistuminen tehoalueelta ennen 600 sekuntia päättää sen lyhyenä kompressori- tai lietejaksona eikä kasvata erälaskuria.

### 6. Käynnistys ja signaalikatkot

- Käynnistyksen vähimmäisvarmistus on 15 sekuntia.
- Lepotila vahvistuu 10 sekunnissa, ilmastus käynnistyksessä 20 sekunnissa ja epäselvä `COMP_45` 125 sekunnissa, ellei epäselvän jakson oma logiikka ratkaise tilaa aiemmin.
- Jos tehosignaali ei päivity 600 sekuntiin, komponentin tila luetaan suoraan uudelleen.
- Vähintään 900 sekunnin todellinen katko nollaa prosessikontekstin ja palauttaa näkyvän tilan `Unknown`-tilaan.

### 7. Erälaskuri, viesti ja KVS

Pysyvät avaimet:

| KVS-avain | Sisältö |
|---|---|
| `puhdistamo_batch_count` | valmistuneiden erien kokonaismäärä |
| `puhdistamo_process_message` | viimeisin pysyvä prosessiviesti, tavallisesti `Last: pp.kk.vvvv hh:mm:ss` |

ETA-tekstejä ei tallenneta KVS:ään joka päivityksellä. Erän valmistumisviesti ja laskuri tallennetaan. Versio 2.0 tarkistaa KVS:stä ladattujen arvojen tyypit ennen käyttöä.

Jos KVS:n luku epäonnistuu käynnistyksessä (versiosta 2.1 alkaen), laskuri ja viimeisin `Last: …` -viesti luetaan virtuaalikomponenteista `number:200` ja `text:200`, jotka säilyvät uudelleenkäynnistyksen yli. Aiemmin hetkellinen lukuvirhe olisi nollannut laskurin pysyvästi.

Prosessiviestin etusijajärjestys:

1. sähkönkulutuksen vikaviesti `Warning: …` (versiosta 2.3, ks. luku 9)
2. `Pump out in …` (ETA) ja `Discharge`
3. `Holiday automation | Last: …` (loma-automatiikka, ks. luku 8)
4. `Last: pp.kk.vvvv hh:mm:ss`

Versiosta 2.4 alkaen prosessivaroitus (korkea vesi, lähtö tukossa) lisätään viestin perään muodossa `Pump out in 64 min | Warning: high water`. Sähkönkulutuksen vikaviesti korvaa edelleen koko viestin.

Väliaikaiset viestit (ETA, `Discharge`, `Warning: power signal missing`) palautetaan versiosta 2.1 alkaen viimeisimpään pysyvään viestiin myös, kun ETA pysäytetään pitkän signaalikatkon takia, purku päättyy ennen 600 sekuntia tai tehosignaali palaa.

### 8. Loma-automatiikka (versio 2.2)

Uponorin käyttöohjeen mukaan puhdistamo siirtyy **odotusvaiheeseen**, jos aloitustasoa ei sisäänpumppauksen aikana saavuteta, ja **loma-automatiikan ylläpitovaiheeseen** (englanniksi *holiday automation / holiday cycle*), jos aloitustasoa ei saavuteta kolmeen vuorokauteen. Ylläpitovaihe pitää aktiivilietteen hengissä enintään kolme kuukautta.

Datassa ylläpitovaihe näkyy selvästi (tyhjennys 18.9.2026, ylläpitovaihe alkoi 21.9. klo 10.30, tasan 72 h viimeisen purun jälkeen):

| | Normaali toiminta / odotusvaihe | Ylläpitovaihe |
|---|---|---|
| Kierron pituus | noin 59 min | noin 2 h 51 min |
| Ilmastus | 30 min tai enemmän | 10 min |
| Laskeutus (ei KOHTA1-vaihe) | enintään 18 min | 100 min + 50 min |
| Energiankulutus | noin 0,9 kWh/vrk | noin 0,2 kWh/vrk |

Tunnistus:

- **Päälle:** laskeutus on kestänyt vähintään `TIME.maintenance_settling_detect_s` = 4 800 s (80 min), sekvenssivaihe ei ala `KOHTA1` ja ETA ei ole aktiivinen. Pisin normaalikäytön tapaus aineistossa oli 71 min (KOHTA1-vaiheessa, joka on rajattu pois).
- **Pois:** ilmastus kestää vähintään `TIME.maintenance_exit_aeration_s` = 1 200 s, alkaa annostelu tai purku, käynnistyy pump out -ETA tai tulee pitkä signaalikatko.

Tunnistusviive on noin 2,5 h vaiheen alusta (varovainen 80 minuutin kynnys). Tila ei muuta Cycle Status -arvoa, koska laite tekee ylläpitovaiheessakin tavallisia vaiheita (ilmastus, laskeutus, lietteen palautus). Tieto näkyy prosessiviestissä muodossa `Holiday automation | Last: …`. Teksti vaihdetaan asetuksella `CONFIG.maintenance_text`. Ylläpitotilaa ei tallenneta KVS:ään; uudelleenkäynnistyksen jälkeen se tunnistetaan uudelleen seuraavasta pitkästä laskeutuksesta.

`CONFIG.vc_maintenance` voi osoittaa erilliseen Boolean-virtuaalikomponenttiin, mutta nykyisessä asennuksessa komponenttipaikkoja ei ole vapaana, joten arvo on `null`. Home Assistantiin saa binäärianturin template-anturilla:

```yaml
template:
  - binary_sensor:
      - name: "Puhdistamo loma-automatiikka"
        unique_id: puhdistamo_loma_automatiikka
        state: >
          {{ states('text.storage_room_uponor_clean_1_process_message')
             .startswith('Holiday automation') }}
```

Anturi näyttää `off`, kun ETA- tai purkuviesti on näkyvissä. Tämä on hyväksyttävää, koska silloin panos on tulossa ja loma-automatiikasta poistutaan joka tapauksessa.

### 9. Sähkönkulutuksen vikavalvonta (versio 2.3)

Kompressori on sähkömagneettinen lineaarikalvokompressori (Yasunaga YP-50DU, myös Thomas YP-50DU). Vastapaine rajaa kalvon liikettä, joten ilmavuoto **nostaa** tehoa. Vuototesti 9.7.2026 ilmastuksen aikana:

| Tilanne | Teho | Muutos |
|---|---:|---:|
| Normaali ilmastus | ~56 W | – |
| Pienehkö reikä letkussa | ~58–61 W | +2–5 W |
| Putki puoliksi poikki | ~65–67 W | lähes +10 W |
| Haara kokonaan poikki | ~73–74 W | noin +17 W |

Revennyt kalvo aiheuttaa todennäköisesti saman ilmiön.

Skripti valvoo normalisoitua tehoa joka sekunti:

| Vika | Ehto | Prosessiviesti |
|---|---|---|
| Liian suuri teho | yli `LIMITS.fault_high_power_w` = 62 W yhtäjaksoisesti `TIME.fault_high_power_s` = 120 s | `Warning: high power, check air hoses and compressor` |
| Ei tehoa | alle `LIMITS.fault_off_power_w` = 2 W yhtäjaksoisesti `TIME.fault_off_power_s` = 60 s | `Warning: no power, check plant supply` |
| Kompressori ei käy | alle 10 W yhtäjaksoisesti `TIME.fault_no_activity_s` = 14 400 s | `Warning: compressor not running` |

Rajojen perusteet: normaalissa käytössä pisin yhtäjaksoinen yli 62 W:n jakso oli kaikissa aineistoissa 7 s (täytön piikit), lepoteho 3,5–4 W ja pisin lepo 100 min (loma-automatiikka).

Vikaviesti ohittaa kaikki muut viestit. Kun teho on ollut normaali `TIME.fault_clear_s` = 60 s, viesti palaa ETA-, Discharge-, loma-automatiikka- tai `Last: …` -viestiin. Jos erä valmistuu vian aikana, laskuri kasvaa ja `Last: …` tallentuu KVS:ään normaalisti, mutta näytöllä pysyy vikaviesti. Viestien tekstit ovat asetuksissa `CONFIG.fault_high_text`, `fault_off_text` ja `fault_idle_text`.

Rajoitukset: pientä reikää (+2–5 W) ei voi erottaa normaalista vaihtelusta (56–58 W). Suuri vuoto nostaa ilmastuksen yli 64 W:n, jolloin vaihetunnistus tulkitsee sen täytöksi; vikaviesti kertoo syyn.

## Versio 2.4: firmwaren vaiheajat

Ohjauskeskuksen firmwaresta (GitHub andy778/UClean1, levyn A vedos, kannen tarra VERSION 2.1.2) purettu toimintalogiikka vastaa omaa mittausdataa sekunnin tarkkuudella:

| Vaihe | Firmware | Oma data 8.–18.10.2026 |
|---|---:|---:|
| Esi-ilmastus + ilmastus | 600 + 5400 s | 6000 s |
| Kemikaalin täyttö + annostelu | 90 + 10 s | 16,5 W 90 s, sitten 32–36 W 10 s |
| Sekoitus / laskeutus I / lietteen palautus / laskeutus II | 120 / 2700 / 120 / 900 s | 120 / 2692 / ~125 / 892 s |
| Ulospumppaus | 780 s | 781 s |
| Sisäänpumppaus heti ulospumppauksen perään | enintään 1020 s | 1028 s, joka kerta |
| Odotusjakso: odotus / liete / ilmastus / sisäänpumppaus | 1080 / 60 / 1800 / 600 s | 1071 / ~65 / 1792 / 609 s |
| Sekoituspulssi (MV5) sisäänpumppauksen aikana | 5 s, 125 s välein | 6 s, 125 s välein, ensimmäinen heti alussa |

Täytön 61–67 W piikit ovat siis ilmastusventtiilin sekoituspulsseja (lähtökuvio COMP+MV4+MV5). Sisäänpumppauksesta siirrytään ilmastukseen vain, kun aloitustaso saavutetaan; muulloin perään tulee odotus.

### Muutokset

Jokainen muutos on oman `CONFIG`-kytkimensä takana. Kun kaikki `v24_*`-kytkimet ovat `false`, skripti tuottaa kaikilla testiaineistoilla tavu tavulta saman tilan, viestin ja laskurin kuin versio 2.3.

| Kytkin | Muutos | Peruste | Vaikutus testidatassa |
|---|---|---|---|
| `v24_trip_eta` | Täyttö, jota seuraa ilmastus, tarkoittaa aloitustasoa; ETA = 9 950 s ilmastuksen alusta. Korvaa 2–3 piikin kuvion. Annostelun alku asettaa ETA:n aina, myös ilman ilmastusta. | Piikkikuvio hylkäsi täytöt, joissa oli 4–5 piikkiä | Lokakuu: aikainen ETA 20/20 panoksessa (v2.3: 11/20). ETA:n virhe −6…+5 s |
| `v24_pumpout_780` | Ulospumppaus päättyy 790 s kohdalla, vaikka sisäänpumppauksen ensimmäinen pulssi jäisi huomaamatta | Firmwaren PUMP_OUT on aina 780 s | 15,1 min purut (10.10. ja 15.10.) → 13,2 min; laskuri kasvaa ajallaan |
| `v24_waiting_status` | Odotus- ja lomajakson lepo raportoidaan arvolla `W` (Waiting); laskeutus I ja II pysyvät `S`:nä | Firmwaren nimi on Waiting; laskeutusta on vain puhdistusjaksossa | Vaatii enum-vaihtoehdon W (ks. Asennus). Ilman sitä käytetään S:ää |
| `v24_fast_holiday` | Loma-automatiikka tunnistetaan, kun odotus ylittää 20 min ja edellisestä panoksesta on yli 70 h | Normaali odotus on enintään 18 min; lomajakso alkaa 71,2 h odotusjakson alusta 50 min odotuksella | 21.9.: tunnistus klo 10.51 (v2.3: 13.01; lomajakso alkoi 10.30). Ei vääriä tunnistuksia |
| `v24_process_warnings` | `Warning: high water`, kun ilmastus ohitetaan tai katkeaa; `Warning: outlet blocked?`, kun ulospumppausta seuraa uusi annostelu | Firmware: korkea vesi ohittaa ilmastuksen; jos pinta ei laske ulospumppauksessa, sisäänpumppaus jää pois (E032 toisella kerralla) | Ei varoituksia normaalidatassa; simuloiduissa tapauksissa oikein |
| `v24_restart_batch` | Levosta suoraan alkava yli 31 min ilmastus = sähkökatkon jälkeinen panos → ETA | Firmware aloittaa sähkökatkon jälkeen aina koko puhdistusjakson | Simuloitu katko odotus- ja laskeutusvaiheessa: ETA ja laskuri oikein |

Lisäksi korjautui versiossa 2.3 piilevä virhe: jos korkea vesi ohitti ilmastuksen, piikkikuvio tulkitsi sekoituksen ilmastukseksi, ulospumppaus luokittui lietteen palautukseksi ja panos jäi laskematta. Versio 2.4 laskee sen.

### Paluu vanhaan

- Yksittäisen muutoksen saa pois asettamalla sen kytkimen arvoon `false`.
- Kaikki kytkimet `false` = version 2.3 toiminta (todennettu kaikilla aineistoilla).
- Täysi paluu: liitä `puhdistamo_skripti_v2_3_shelly.js`. Laskuri ja viimeisin viesti säilyvät KVS:ssä, eikä v2.4 tallenna KVS:ään mitään uutta.
- Enum-vaihtoehto W voi jäädä paikalleen; versio 2.3 ei käytä sitä.

### Testaus

Skripti ajettiin sellaisenaan Node.js-testikehyksessä, joka jäljittelee Shellyn rajapintoja (RPC, KVS, ajastimet, tilakäsittelijä, uudelleenkäynnistykset) virtuaalikellolla. Kehyksen tarkkuus todennettiin versiolla 2.3: syyskuun aineistossa 800/800 ja lokakuun aineistossa 940/943 laitteen omaa tilasiirtymää osui ±30 s:n sisään (puuttuvat 3 osuvat Shellyn uudelleenkäynnistyksen sekunteihin), ja lokakuun panokset kasvoivat samalla sekunnilla kuin laitteessa.

| Aineisto | Erät v2.3 / v2.4 | Aikainen ETA v2.3 / v2.4 (kokonaiset panokset) | Kytkimet pois = v2.3 |
|---|---|---|---|
| `history (uponor 2).csv` 5.–10.7. | 11 / 11 | 8 / 11 | identtinen |
| `history (23)–(28).csv` 4.–11.7. | 4, 2, 1, 2 / sama | 5 / 8 | identtinen |
| `history (9).csv` 13.–23.9. | 9 / 9 | 4 / 8 | identtinen |
| `history (11).csv` 8.–18.10. | 20 / 20 | 11 / 20 | identtinen |

Lisäksi firmwaren toimintalogiikasta tehtiin simulaattori, joka tuottaa tehokäyrän (itsetestinotkahdukset ja sekoituspulssit mukana). Kaikki 10 tilannetta läpäisivät:

| Tilanne | Tulos |
|---|---|
| Aloitustaso 1, 2, 3, 4 ja 5 pulssin jälkeen sekä ulospumppauksen jälkeisessä täytössä | aikainen ETA 6/6 (v2.3: 2/6), viimeisen ETA:n virhe 1 s |
| Korkea vesi jakson alussa | varoitus, erä laskettu (v2.3 hukkasi erän) |
| Korkea vesi katkaisee ilmastuksen 40 min kohdalla | varoitus, ETA korjautuu annostelussa |
| Lähtö tukossa kahdesti | varoitus, 3 erää laskettu, varoitus poistuu normaalin sisäänpumppauksen jälkeen |
| Sähkökatko 10 min odotusjaksossa | panoksen ETA 31 min ilmastuksen jälkeen, erä laskettu |
| Sähkökatko laskeutuksessa, Shelly käynnistyy uudelleen | sama |
| Ei aloitustasoa 71 h → lomajakso → aloitustaso | loma-automatiikka tunnistettu alle 25 min lomajakson alusta; ETA |
| Shellyn uudelleenkäynnistys kesken panoksen ilmastuksen | ei väärää ETA:a, erä laskettu |
| Korkea vesi odotusjakson tarkistuksessa | varoitus |
| Test-napin testijakso | ei erää; näyttää hetken väärän ETA:n kuten v2.3 |

Tiivistetty versio tuottaa kaikissa ajoissa tavu tavulta saman lokin kuin kommentoitu. RPC-kutsuja on noin 1,3 % enemmän (ETA-viesti päivittyy pidempään).

### Rajoitukset

- Testijakso (Test-nappi 5–10 s) voi näyttää hetken `Pump out in …` -viestin ja `high water` -varoituksen, koska sen 90 s kemikaalin täyttö näyttää samalta kuin korkean veden tilanne. Erälaskuri ei kasva.
- Sähkökatkon jälkeinen panos tunnistetaan vain, jos Shelly näkee levon ennen ilmastusta. Jos Shelly käynnistyy vasta ilmastuksen jo alettua, ETA tulee annostelun alussa kuten ennen.
- Nopea loma-automatiikan tunnistus tarvitsee edellisen panoksen ajan. Se luetaan `Last: …`-viestistä myös uudelleenkäynnistyksen jälkeen. Muuten käytetään version 2.3 80 minuutin sääntöä.
- Muistin käyttö kasvaa arviolta alle 1,5 kt (13 muuttujaa ja 7 pientä funktiota). Tarkista asennuksen jälkeen `Script.GetStatus`-kutsun `mem_peak`; sen pitäisi pysyä alle noin 21 000 tavun.
- Firmwaren hälytyksiä, jotka eivät näy tehossa (kemikaali E021, lietemuistutus E051, radio E011, GSM E012, pumppukaivo E033, EEPROM E047), ei voi tunnistaa.

## Shellyn virtuaalikomponentit

Skripti olettaa seuraavat komponentit valmiiksi luoduiksi:

| Tyyppi ja ID | Tarkoitus | Arvo |
|---|---|---|
| `number:200` | Batch Counter | kokonaisluku |
| `enum:200` | Cycle Status | `U`, `F`, `A`, `C`, `S`, `R`, `D` ja valinnainen `W` (versio 2.4) |
| `text:200` | Process Message | teksti |
| `boolean:201` | Pump In | true/false |
| `boolean:202` | Pump Out | true/false |
| `boolean:203` | Sludge Removal | true/false |
| `boolean:204` | Dosing | true/false |
| `boolean:205` | Aeration | true/false |
| `number:201` | Normalized Consumption | watit, yksi desimaali |

Sama numeerinen ID voi esiintyä eri komponenttityypeillä, koska varsinainen avain on muotoa `tyyppi:id`, esimerkiksi `number:200` ja `enum:200`. Shellyn dokumentaation mukaan virtuaalikomponenttien ID-alue on 200–299 ja laitekohtainen raja 10 komponenttia; tämä skripti käyttää yhdeksää. Kohdelaitteessa uusia virtuaalikomponentteja ei voi enää lisätä, joten uudet tiedot (kuten loma-automatiikka) välitetään prosessiviestin kautta. Katso [Shellyn Virtual Components -dokumentaatio](https://shelly-api-docs.shelly.cloud/gen2/DynamicComponents/Virtual/).

Shellyn nykyisen dokumentaation mukaan nämä virtuaalikomponentit ovat käytettävissä Gen3-laitteissa ja Gen2 Pro -laitteissa. Koska alkuperäinen skripti käyttää jo samoja komponentteja, kohdelaitteen pitäisi täyttää tämä ehto, mutta asia kannattaa tarkistaa laitetta vaihdettaessa.

## RPC-kirjoitusjono

Virtuaalikomponenttien päivitykset ja KVS-operaatiot kulkevat yhden jonon läpi. Jonossa:

- on vain yksi aktiivinen `Shelly.call` kerrallaan;
- saman virtuaalianturin odottava arvo korvataan uusimmalla;
- epäonnistunut kutsu yritetään enintään kolme kertaa;
- yksittäisen kutsun aikakatkaisu on viisi sekuntia;
- onnistuneeksi muistettua tilaa ei kirjoiteta jatkuvasti uudelleen;
- varmistussynkronointi sallii saman tilan lähettämisen uudelleen viiden minuutin välein.

Jono kannattaa säilyttää. Shelly asettaa skripteille resurssirajoja muun muassa ajastimien, statuskäsittelijöiden ja RPC-kutsujen määrälle. Katso [Shellyn scripting language resource limits](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference/) ja [Shelly Core -rajapinta](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly).

## Versiossa 2.0 tehdyt muutokset

| Muutos | Peruste | Vaikutus |
|---|---|---|
| Puuttuvan jännitteen 230 V fallback | Alkuperäinen pääsilmukka ei edennyt, jos komponentti ei ilmoittanut jännitettä | Skripti toimii myös pelkällä tehotiedolla; mitattua jännitettä käytetään edelleen ensisijaisesti |
| Pääsilmukka vaatii vain tehon | Jännite on normalisoinnin lisätieto, ei prosessin ehdoton edellytys | Estää hiljaisen pysähtymisen jännitekentän puuttuessa |
| Varmistussynkronointi 60 s → 300 s | RPC-jono yrittää jo epäonnistuneita kutsuja kolme kertaa | Simuloidut RPC-kutsut vähenivät noin 58 % ilman prosessituloksen muutosta |
| `PENDING_STATE` säilytetään varmistussynkronoinnissa | Käynnissä tai jonossa olevaa kirjoitusta ei pidä unohtaa | Vähentää päällekkäisiä kirjoituksia ja jonon kasvua |
| KVS-arvojen tyyppitarkistus | Väärä tai käsin muokattu arvo saattoi rikkoa laskennan tai tekstikäsittelyn | Virheellinen laskuri palautuu nollaan ja viesti `-`-arvoon turvallisesti |
| `resetPumpingCounters()`-apufunktio | Sama kolmen muuttujan nollaus toistui useassa paikassa | Vähemmän toistoa ja pienempi riski unohtaa yksi laskuri muutoksissa |
| `decideBoostStatusOnEnter()` yksinkertaistettu | Neljä haaraa tekivät käytännössä saman nollauksen ja siirtymän | Sama toiminta selkeämmin |
| Käyttämättömät muuttujat ja tyhjä funktio poistettu | Niitä kirjoitettiin mutta ei koskaan luettu | Pienempi ylläpitopinta ilman toiminnallista muutosta |
| Otsikko ja versionumero lisätty | Tiedoston tarkoitus ei käynyt ilmi suoraan lähdekoodista | Helpompi erottaa tuotantoversiot |

Tehorajoja, vahvistusaikoja, prosessisekvenssiä, ETA-aikoja ja 600 sekunnin erälaskentasääntöä ei versiossa 2.0 muutettu. Tämä oli tietoinen valinta: aineisto ei osoittanut niissä sellaista virhettä, joka oikeuttaisi riskialttiin uudelleenkalibroinnin.

## Versioissa 2.1–2.3 tehdyt muutokset

| Versio | Muutos | Peruste | Vaikutus |
|---|---|---|---|
| 2.1 | `BOOST` ohitetaan Chemical Dosing -vaiheessa | 2.0:n yksinkertaistus laajensi siirtymän Tank Filling -tilaan tahattomasti myös annosteluun | Täsmälleen alkuperäinen käytös |
| 2.1 | `LIMITS.pumpin_peak_min` 62,0 → 60,0 W | 11.7.2026 datassa neljä aitoa pumppupiikkiä jäi 0,4–0,8 W rajan alle, eikä ETA käynnistynyt | Varhaisia ETA:ita 6 → 9, vääriä hälytyksiä 0 |
| 2.1 | `KOHTA1_PEAK_PATTERN_AERATION_CONFIRMED` lisätty tunnettuihin lietevaiheisiin | Lyhyt lietteen palautus vahvistetun piikkikuvion jälkeen luokittui lyhyeksi kompressorijaksoksi | Lietteen palautus näkyy oikein |
| 2.1 | KVS-lukuvirheen varalla laskuri ja viesti luetaan virtuaalikomponenteista | Hetkellinen `KVS.Get`-virhe olisi nollannut erälaskurin pysyvästi | Laskuri säilyy |
| 2.1 | Väliaikaisten viestien siivous (`clearTransientProcessMessage`) | ETA-, `Discharge`- ja varoitusteksti saattoi jäädä näkyviin pysyvästi | Viesti palaa aina pysyvään viestiin |
| 2.2 | Loma-automatiikan tunnistus ja viesti | Tyhjennyksen jälkeen laite siirtyi ylläpitovaiheeseen, jota skripti ei tunnistanut | `Holiday automation \| Last: …` näkyy prosessiviestissä |
| 2.2 | Tiivistetty Shelly-versio | Web-editori katkaisee liitetyn tekstin noin 50 000 merkin kohdalla | Skripti mahtuu editoriin (44 KB) |
| 2.3 | Sähkönkulutuksen vikavalvonta prosessiviestiin | Ilmavuoto nostaa tehoa jopa 17 W; sähkökatko ja pysähtynyt kompressori eivät näkyneet mitenkään | Vika näkyy ilman Home Assistantia; tiivistetty versio 46,6 KB |

### Testiaineistot ja tulokset (versio 2.3)

| Aineisto | Jakso | Sisältö | Erät | Huomiot |
|---|---|---|---:|---|
| `history (uponor 2).csv` | 5.–10.7.2026 | teho + jännite | 11 | sisältää vuototestin 9.7.: `high power` klo 12.52, `no power` klo 12.56 |
| `history (23).csv` | 4.–6.7.2026 | normalisoitu teho | 4 | identtinen |
| `history (24).csv` | 7.7.2026 | normalisoitu teho | 2 | identtinen |
| `history (26).csv` | 8.7.2026 | normalisoitu teho | 1 | identtinen |
| `history (28).csv` | 10.–11.7.2026 | teho + jännite | 2 | 11.37 piikkikuvio tunnistuu 60 W rajalla |
| `history (9).csv` | 13.–23.9.2026 | normalisoitu teho + laitteen tilat | 9 | tilasekvenssi 804/804 laitteen kanssa; loma-automatiikka tunnistui 21.9. klo 13.01 |

Missään aineistossa loma-automatiikka tai vikavalvonta ei aktivoitunut normaalin käytön aikana (vuototestiä lukuun ottamatta), tilasiirtymät ovat identtiset v2.2:n kanssa, eikä yksikään alle 600 s `COMP_45`-jakso kasvattanut erälaskuria. Tiivistetty Shelly-versio tuotti kaikilla aineistoilla tavu tavulta saman lokin kuin kommentoitu versio.

## Miksi skriptiä ei kirjoitettu kokonaan uusiksi

Skriptin pituudesta huolimatta suurin osa monimutkaisuudesta tulee aidosta mittausongelmasta: sama noin 45 W teho tarkoittaa eri kohdissa täyttöä, lietteen palautusta tai käsitellyn veden poistoa. Pelkkä lyhyempi tehorajaskripti kadottaisi sekvenssikontekstin ja kasvattaisi väärien tunnistusten riskiä.

Versiossa 2.0 tehtiin siksi rajattu refaktorointi. Prosessitunnistus pidettiin ennallaan ja muutokset kohdistettiin virheensietoon, kirjoituskuormaan, kuolleeseen koodiin ja selvästi toistuvaan logiikkaan.

## Asennus ja käyttöönotto

1. Varmuuskopioi Shellyssä nykyinen skripti ja KVS-arvot.
2. Varmista, että yllä luetellut yhdeksän virtuaalikomponenttia ovat olemassa ja enum sisältää arvot `U`, `F`, `A`, `C`, `S`, `R`, `D`.
3. Versio 2.4: lisää enum:200:aan vaihtoehto `W` otsikolla `Waiting` (Shellyn web-käyttöliittymä → Components → Cycle Status → muokkaa → lisää vaihtoehto). Ilman sitä skripti raportoi odotuksen S:nä kuten ennen. Home Assistantin select-entiteettiin tulee uusi tila `Waiting`.
4. Pysäytä nykyinen Shelly-skripti ennen koodin korvaamista. Shellyn `Script.PutCode` ei hyväksy käynnissä olevan skriptin ylikirjoitusta. Katso [Shellyn Script-komponentin dokumentaatio](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Script).
5. Kopioi **tiivistetty** `puhdistamo_skripti_v2_4_shelly.js` (49 068 merkkiä) Shellyn skriptieditoriin. Tarkista ennen tallennusta, että editorin viimeinen rivi on `}`. Jos editori katkaisee tekstin, lataa koodi tietokoneelta paloina: `python3 lataa_shellyyn.py <ip> <skriptin id> puhdistamo_skripti_v2_4.js --kaynnista` (lisää `--salasana …`, jos laitteessa on salasana). Työkalu lukee koodin takaisin ja vertaa sitä tiedostoon ennen käynnistystä; näin mahtuu myös kommentoitu versio.
6. Käynnistä skripti käsin ja tarkista konsolista rivit `Power component: ...`, `System ready...` ja `Enum option W found` (tai `missing`).
7. Tarkista, että Normalized Consumption päivittyy ja Cycle Status poistuu käynnistyksen jälkeen `U`-tilasta.
8. Ota automaattinen käynnistys käyttöön vasta onnistuneen testin jälkeen.
9. Seuraa vähintään yksi kokonainen jakso: `Pump out in …` -viestin pitää ilmestyä noin 15 s aloitustason jälkeen, ja Pump Out -vaiheen pitää kestää noin 13 min.
10. Tarkista vuorokauden kuluttua `Script.GetStatus`-kutsun `mem_peak`.

Älä nollaa KVS-avainta `puhdistamo_batch_count`, ellet tarkoituksella halua aloittaa erälaskuria alusta.

## Jatkokehitys ja kalibrointi

### Muuta ensin vain `LIMITS`- ja `TIME`-arvoja

Prosessilogiikkaa ei yleensä tarvitse muuttaa, jos laitteen kulutus hieman muuttuu. Tee kalibrointi tässä järjestyksessä:

1. kerää vähintään viikon teho- ja jännitedata;
2. merkitse käsin vähintään kaksi oikeaa täydellistä prosessijaksoa;
3. tarkista tehoalueiden väliset marginaalit;
4. muuta vain yhtä rajaa tai aikaa kerrallaan;
5. aja sama vertailuaineisto ennen ja jälkeen muutoksen;
6. hyväksy muutos vain, jos kaikkien testiaineistojen erämäärät (ks. taulukko yllä) säilyvät eikä uusia vääriä eriä tai loma-automatiikkatunnistuksia synny.

### Erityisesti seurattavat arvot

- `LIMITS.comp_min`, `comp_max`, `aeration_min` ja `boost_min`: tärkeimmät 45 W kompressorin, ilmastuksen ja pumppupiikin erottelulle.
- `TIME.ambiguous_sludge_confirm_s`: kuinka nopeasti epäselvä 45 W vaihe näytetään lietteen palautuksena.
- `TIME.discharge_count_min_s`: tärkein väärien erien esto; älä pienennä ilman merkittyä vertailudataa.
- `TIME.pumpout_after_final_sludge_settling_s` ja `pumpout_detect_tolerance_s`: poistopumppauksen odotetun alun ikkuna.
- `TIME.pumpin_peak_interval_min_s` ja `pumpin_peak_interval_max_s`: hyväksytyn pumppupiikkisarjan rytmi.
- `TIME.force_resync_interval_s`: vaikuttaa vain virtuaalianturien varmistuskirjoituksiin, ei prosessin tunnistukseen.
- `LIMITS.pumpin_peak_min`: pumppupiikin raja (60,0 W). Havaitut aidot piikit ovat 61,2–67,4 W; normaalin ilmastuksen aikana arvoja 58–62 W ei esiintynyt.
- `TIME.maintenance_settling_detect_s`: loma-automatiikan tunnistuskynnys. 60 min lyhentäisi viivettä noin tunnilla mutta pienentäisi marginaalia normaaliin käyttöön (pisin 71 min).

### Suositeltava seuraava testiaineisto

Seuraavaan CSV-vientiin kannattaa ottaa mukaan:

- teho;
- jännite;
- Shellyn laskema Cycle Status;
- Pump In, Pump Out, Sludge Removal, Dosing ja Aeration;
- mahdollinen Uponorin todellinen lähtö- tai reletila, jos sen saa mitattua.

Tällöin seuraava simulaatio voidaan tehdä todellisella jännitekorjauksella ja tunnistuksia voidaan verrata fyysisiin lähtöihin eikä vain prosessisekvenssin sisäiseen johdonmukaisuuteen.

## Hyväksymiskriteerit tuleville muutoksille

- Skripti läpäisee syntaksitarkistuksen.
- Kaikista testiaineistoista tulee edelleen sama erämäärä (11, 4, 2, 1, 2 ja 9).
- Yksikään alle 600 sekunnin `COMP_45`-jakso ei kasvata erälaskuria.
- Poistopumppauksen 11 alkamis- ja päättymisaikaa eivät siirry yli kolmea sekuntia ilman perusteltua debounce-muutosta.
- Puuttuva jännite ei pysäytä pääsilmukkaa.
- Pitkä tehosignaalikatko palauttaa tilan turvallisesti `Unknown`-tilaan.
- RPC-jono ei kasva jatkuvasti normaalissa käytössä.
- Loma-automatiikka ei aktivoidu normaalin käytön aineistoissa ja aktivoituu syyskuun 2026 aineistossa.
- Tiivistetty Shelly-versio on alle 50 000 merkkiä ja tuottaa saman lokin kuin kommentoitu versio (`node eqtest.js puhdistamo_skripti_v2_4.js puhdistamo_skripti_v2_4_shelly.js`).
- Vikavalvonta ei aktivoidu normaalin käytön aineistoissa ja aktivoituu heinäkuun vuototestissä.
- Versio 2.4, kaikki `v24_*`-kytkimet `false`: tila, viesti ja laskuri tavu tavulta samat kuin versiossa 2.3 kaikilla aineistoilla.
- Versio 2.4: lokakuun aineistossa aikainen ETA kaikille 20 panokselle, virhe alle ±15 s; kaikki firmware-simulaattorin 10 tilannetta läpäisevät (`node scenarios.js`).

## Versiohistoria

| Versio | Päivä | Kuvaus |
|---|---|---|
| 1.x | ennen 10.7.2026 | käyttäjän alkuperäinen lähes toimiva skripti |
| 2.0 | 10.7.2026 | jännite-fallback, RPC-kuorman vähennys, KVS-validointi, rajattu refaktorointi ja dataan perustuva regressiotesti |
| 2.1 | 7/2026 | pumppupiikin raja 60 W, lietevaiheen korjaus, KVS-lukuvirheen varmistus, väliaikaisten viestien siivous |
| 2.2 | 23.9.2026 | loma-automatiikan tunnistus (`Holiday automation`), tiivistetty Shelly-versio |
| 2.3 | 23.9.2026 | sähkönkulutuksen vikavalvonta: liian suuri teho, ei tehoa, kompressori ei käy |
| 2.4 | 28.10.2026 | firmwaren vaiheajat: aloitustaso täytöstä ja ilmastuksesta (ETA kaikille panoksille), ulospumppaus 780 s, odotus omana tilanaan (W), nopeampi loma-automatiikka, korkean veden ja tukkeutuneen lähdön varoitukset, sähkökatkon jälkeinen panos; jokainen muutos kytkettävissä pois |
