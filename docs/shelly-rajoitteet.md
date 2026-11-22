# Shellyn skriptiympäristön rajoitteet

[English](shelly-limits.md) | **Suomi**

Rajoitteet, jotka tulivat vastaan tätä skriptiä tehdessä. Ne on todettu Shelly EM Mini Gen4:llä, firmware 2.2.0 (`20261109-150305/2.2.0-g7968dca`), marraskuussa 2026. Muut laitteet ja firmwareversiot voivat poiketa. Testien Shelly-jäljitelmä (`test/shelly_device_mock.js`) tarkistaa suurimman osan näistä, joten virhe näkyy jo testissä eikä vasta laitteella.

## Kieli ja kirjasto

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Varovainen ES5-tason JavaScript: ei nuolifunktioita, template-literaaleja, `const`-, `class`-, `async`- tai spread-syntaksia. Kaikkia näistä ei ole kokeiltu laitteella; jäljitelmä hylkää ne varmuuden vuoksi. | – | `function`, merkkijonojen yhdistäminen `+`:lla, `let` |
| Funktion pitää olla määritelty ennen kuin sitä kutsutaan (myös ylimmällä tasolla) | Virhe, funktiota ei löydy | Funktiot järjestyksessä, käynnistys ajastimesta |
| `Array.prototype.shift`, `unshift` ja `concat` puuttuvat | Virhe, funktiota ei löydy | `splice(0, 1)`, `push`, silmukka. `splice`, `slice`, `pop`, `push`, `indexOf` ja `join` toimivat. |
| `Date.UTC` ja `getTimezoneOffset` puuttuvat | Virhe, funktiota ei löydy | Päivämäärät lasketaan omalla funktiolla, aikavyöhyke Sys-ajasta (`Shelly.getComponentStatus("sys")`) |
| `Date.toISOString` toimii | – | – |

## Pino ja muisti

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| **Kutsupino on matala.** Natiivikutsu (esim. `Shelly.getComponentStatus`) 11 funktion syvyydessä kaatoi skriptin, 10 toimi. Pitkät lausekkeet (sisäkkäiset `?:` ja merkkijonojen yhdistäminen) syövät pinoa lisää. | `Uncaught Error: Too much recursion - the stack is about to overflow`, skripti pysähtyy | Tapahtumakäsittelijät vain muuttavat tilaa ja asettavat lippuja. `tick()` kirjoittaa komponentit, KVS:n ja tapahtumat ylimmältä tasolta. Pitkät lausekkeet pilkotaan välimuuttujiin. Jokainen natiivikutsu lasketaan, myös `push`, `JSON.stringify` ja `Math`: versiosta 3.1.0 alkaen myös laskurit ja KVS-arvojen `JSON.stringify` käsitellään `tick()`-funktiossa. Jäljitelmä hylkää yli 7 tason Shelly-rajapintakutsut, ja `test/v3_depth_test.js` tarkistaa jokaisen funktion: 3.1.0:ssa mikään ei suoritu yli 8 tason syvyydessä (3.0.2:ssa panos johti 9 tason syvyiseen `push`-kutsuun). Vika löytyi vasta laitteella 19.11.2026: v3.0.0–3.0.1 kaatui ensimmäisen puhdistusjakson alussa. |
| Ei rekursiota: synkroninen rekursio noin 6 tasoa sulkeumineen kaatoi skriptin | Kuten yllä | Silmukat ja asynkroniset ketjut (callback tai ajastin aloittaa tyhjästä pinosta) |
| Skripteillä on yhteensä noin 25 kt muistia | `Out of memory`, skripti pysähtyy | v3 3.1.0 käyttää noin 16,4 kt (huippu 20 kt; 3.0.2: 14 ja 19 kt). Kaksi isoa skriptiä ei mahdu yhtä aikaa. |
| Globaalit muuttujat ja funktiot vievät muistia koko ajan: noin 28–56 tavua ominaisuutta ja 70–85 tavua funktiota kohden | Muisti loppuu | Taulukot funktioiksi, harvoin muuttuvat asetukset vakioiksi |
| Suuret RPC-vastaukset (esim. `Shelly.GetComponents` kaikkine asetuksineen, noin 3 kt) | `out_of_memory` | Pienet kyselyt yksi kerrallaan |
| Enintään 5 ajastinta ja 5 samanaikaista RPC-kutsua | Virhe | Yksi toistuva `tick()`-ajastin, KVS-kirjoitukset jonossa yksi kerrallaan |
| KVS: avain enintään 42 merkkiä, arvo enintään 253 merkkiä, enintään 50 avainta (Shellyn dokumentaatio) | Pidempää arvoa ei tallenneta | Tila on jaettu useaan `uc_*`-avaimeen (3.1.0:ssa 8). Pisin arvo on `uc_vc`, noin 210 merkkiä. `test/v3_device_test.js` tarkistaa koot. |

## Skriptit ja tiedostojärjestelmä

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Käynnissä voi olla enintään 3 skriptiä kerrallaan (Shellyn ohje: "Up to 3 scripts can be running at any given time"). Skriptejä voi olla tallennettuna useampia. | `Script.Start` epäonnistuu: `Too many scripts running` | Käynnissä ovat vain tunnistusskripti ja sovelluksen latainsivu. Sovelluksen data-skriptejä ei käynnistetä koskaan. Asennus kertoo, jos kolme skriptiä on jo käynnissä. |
| Skripti ei voi pitää muistissa eikä tarjota isoa sivua: muistia on noin 25 kt (ks. yllä), sovellus on noin 210 000 merkkiä | Sivua ei voi tarjota skriptin HTTP-osoitteesta | Sovellus on pakattuna (gzip + base64) skripteissä, joita ei käynnistetä. Latainsivu tarjoaa pienen sivun, joka lukee ne `Script.GetCode`-kutsulla ja purkaa selaimessa. Asennus: [`sovellus.md`](sovellus.md#shellystä-suositus) (sovelluksen asetuksista, web-käyttöliittymästä tai Python-työkalulla). |
| Skriptimuutokset (`Script.Create`, `Script.Delete`, `Script.PutCode`) voivat vastata yli 10 s:n viiveellä heti isojen skriptien poiston jälkeen (tiedostojärjestelmä kiireinen). Todettu 22.11.2026: sovelluksen 1.4.1 asennus katkesi, kun `Script.Create` ei vastannut 10 s:ssa. | Asennus katkeaa aikakatkaisuun, vaikka skripti syntyy | Sovellus odottaa skriptimuutoksia 30 s ja etsii vastauksen viivästyessä luodun skriptin nimellä. Python-työkalu odottaa 40 s. |
| Tiedostojärjestelmä on yhteensä 768 kt (`fs_size`). Testilaitteella vapaata on sovelluksen 1.6.2 (95 kt) ja skriptin 3.1.0 kanssa noin 104 kt. Shelly ei kerro, paljonko tilaa firmware-päivitys tarvitsee. | Liian täysi tiedostojärjestelmä voi estää firmware-päivityksen (ei kokeiltu) | Sovellus ja Python-työkalu jättävät aina vähintään 100 kt vapaaksi, ks. [`sovellus.md`](sovellus.md#tila-ja-shellyn-firmware-päivitykset). |

## Virtuaalikomponentit

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Laitteella on 10 virtuaalikomponenttipaikkaa (ryhmä mukaan lukien) | Uusia ei voi luoda | v3 käyttää 9 |
| `@meta`-lohko luetaan vain tiedoston ensimmäiseltä 1024 tavulta | Yli jäävät roolit ohitetaan ilman virhettä, ja jo luodut komponentit poistetaan | v3 ei käytä `@meta`-lohkoa |
| Home Assistantin Shelly-integraatio ei luo entiteettejä skriptin omistamille (`@meta`) komponenteille | Komponentit puuttuvat Home Assistantista | `Virtual.Add` ja tunnukset KVS:ään (`uc_vc`) |
| Skriptin omistamaa komponenttia ei voi poistaa `Virtual.Delete`-kutsulla | Virhe −107 | Ne poistuvat skriptin mukana |
| Komponenttien tunnukset voivat vaihtua uudelleenasennuksessa | Home Assistantin entiteetit vaihtuvat | Tunnukset tallennetaan KVS:ään ja käytetään uudelleen |
| `change`-tapahtuma tulee myös skriptin omasta `setValue`-kutsusta, vaikka arvo ei muuttuisi | Skripti luulee käyttäjän muuttaneen arvoa | Verrataan viimeksi kirjoitettuun arvoon |
| `setValue` astuu voimaan vasta, kun skriptin meneillään oleva kutsu päättyy (Shellyn dokumentaatio: "applied asynchronously as soon as the current execution context of the script exits") | Heti kirjoituksen jälkeen luettu arvo on vanha | Skripti pitää viimeksi kirjoittamansa arvot itse muistissa |
| Komponentit, joilla on `persisted: false`, palaavat oletusarvoonsa, kun Shelly käynnistyy uudelleen | Phase, Cycle, Status ja Warning ovat uudelleenkäynnistyksen jälkeen tyhjiä, kunnes skripti kirjoittaa ne | Skripti kirjoittaa ne käynnistyessään. Laskurit ovat `persisted: true` ja tallessa myös KVS:ssä. |
| Shellyn käyttöliittymä näyttää lukutilan enum-arvon rikkinäisen kuvan kuvakkeen kanssa | Kosmeettinen | – |
| Shelly-sovellus piirtää komponentin historiaa vain, jos sen asetuksissa on pilvitilasto (`meta.cloud`, esim. `["counter"]`) | Graafia ei ole | Batches luodaan asetuksella `cloud: ["counter"]`, jolloin sovellus näyttää kasvun päiväkohtaisena graafina. Kun asetus lisättiin samaan komponenttiin (`number:200`), jota v2.4 oli käyttänyt, graafi jatkui vanhasta historiasta. |

## Home Assistant

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Integraatio etsii skriptin tapahtumatyypit vain skriptin ensimmäisestä 5 kt:sta (`Shelly.emitEvent("tyyppi"`) | Tapahtumaentiteettiä ei synny | Tiivistetyn version toinen rivi mainitsee `Shelly.emitEvent("uponor"` |
| Integraatio lukee komponentit vain uudelleenlatauksessa tai Home Assistantin käynnistyksessä | Uudet komponentit puuttuvat | Integraation uudelleenlataus asennuksen jälkeen |

## Muuta

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Web-editorin tekstikentän enimmäispituus on 50 000 merkkiä (`maxlength`). Testattu 19.11.2026: 60 000 merkin liitoksesta jäi 50 000, ja tallennus vei katkaistun koodin laitteelle. Laite itse hyväksyy pidemmän koodin RPC:llä (`Script.PutCode`, testattu 60 000 merkkiä). | Liitos katkeaa **ilman varoitusta**, ja katkaistu skripti tallentuu | Tiivistetty versio (noin 44 000 merkkiä) tai `shelly/tools/lataa_shellyyn.py`, joka kirjoittaa paloina. Ilmoitettu Shellylle web-käyttöliittymän Feedback-lomakkeella. |
| HTTP-kyselyyn, jossa on toisen sivun `Origin`-otsake, Shelly vastaa 503. Koskee RPC-kutsuja ja skriptin omia HTTP-osoitteita, myös paikallisesta tiedostosta avattua sivua (`Origin: null`). CORS-otsake skriptin vastauksessa ei auta. Asetusta tälle ei ole. Testattu 22.11.2026. | Selainsovellus ei voi käyttää HTTP-rajapintaa | WebSocket (`ws://<shelly>/rpc`) toimii toiselta sivulta. Skriptin tila luetaan kutsulla `Script.Eval` (`JSON.stringify(stateObject())`), tehohistoria `EM1Data.GetData`-kutsulla |
| EM1Data-minuuttienergia (`total_act_energy`) on porrastettu noin 0,2072 Wh:n askeliin. Siitä laskettu minuutin keskiteho saa vain arvot 0; 12,4; 24,9; 37,3; 49,7 ja 62,2 W ja voi olla minuutin pienintä tehoa pienempi. Todettu 22.11.2026. | Energiasta laskettu tehokäyrä hyppii | Minuutin teho pienimmästä ja suurimmasta tehosta (`min_act_power`, `max_act_power`); vuorokauden energian summa on silti oikein |
| `EM1Data.GetData` palauttaa laitteella enintään 31 minuuttitietuetta kyselyä kohden (HTTP ja WebSocket), vaikka pyydetty väli olisi pidempi. Kysely vie noin 100 ms, joten 7 vuorokautta (noin 10 000 tietuetta) vie noin 35 s. Rinnakkaiset kyselyt eivät nopeuta. Todettu 22.11.2026. | Viikon tehohistorian lataus kestää | Sovellus hakee ensin näkyvän välin ja piirtää sen, loput taustalla (`next_record_ts`) |
| Shelly ottaa vastaan vain muutaman WebSocket-yhteyden kerrallaan (`ws://<shelly>/rpc`). Kun Home Assistant ja kaksi selainsovellusta olivat yhteydessä, jokainen uusi yhteys sulki jonkin vanhan (koodi 1000): ensin Home Assistantin, jonka Uponor-entiteetit olivat 1–3 s tilassa unavailable, ja sitten aiemmin avatun, toimettoman yhteyden. Home Assistant yhdisti heti uudelleen ja saattoi sulkea vuorostaan jonkin toisen. Shellyn ohjeissa mainitaan vain 6 samanaikaisen ei-pysyvän RPC-kanavan raja. Todettu 22.11.2026. | Uuden sovellussivun avaaminen tai yhteyskatko näkyy Home Assistantissa lyhyenä katkona | Sovellus käyttää yhtä yhteyttä, sulkee sen taustalla olevalla sivulla minuutin jälkeen ja hakee uudelleen yhdistäessään vain puuttuvat minuutit. Sovellus kannattaa pitää auki vain yhdessä paikassa. |
| Shellyssä ei ole salattua paikallista yhteyttä (ei `https://` eikä `wss://`). Selain estää salaamattoman `ws://`-yhteyden salatulta (`https://`) sivulta. | Sovellus ei saa yhteyttä, jos se avataan esim. GitHub Pagesista, Home Assistantin etäyhteydellä tai chat-sovelluksen esikatselusta | Sovellus avataan Shellystä, Home Assistantin paikallisesta `http://`-osoitteesta tai tiedostona. Kodin ulkopuolelta VPN:llä. |
| Shellyn pilven rajapinnalla ei voi lukea skriptin tilaa eikä `EM1Data`-tehohistoriaa | Sovellus ei toimi pilven kautta | VPN-yhteys kotiverkkoon |
| `EM1Data` säilyttää minuuttitiedot noin 7 vuorokautta. Vanhat tiedot poistuvat 6 tunnin erissä: vanhin tietue oli 22.11.2026 klo 11.26 15.11. klo 8.00 ja klo 17.30 15.11. klo 14.00 (Suomen aikaa), eli 7–7¼ vrk vanha. | Pidempää tehohistoriaa ei ole | Sovellus hakee 7 vuorokautta. Menneet vaiheet päätellään tältä ajalta. |
| `Sys`-komponentin `unixtime` on kokonaisia sekunteja, `uptime` sekunnin murto-osina. Kun aika lasketaan niistä (unixtime − uptime + hetki), tulos heiluu sekunnin verran luvusta toiseen. Todettu 22.11.2026: Home Assistantin seuraavan ulospumppauksen aika muuttui vuorokaudessa 217 kertaa, niistä 190 kertaa vain 1–2 s. | Ajat (`eta`, `since`) muuttuvat sekunnin verran ilman todellista muutosta, ja historiaan kertyy turhia muutoksia | Skripti 3.1.0 pitää muistissa suurimman havaitun `unixtime`- ja `uptime`-erotuksen ja aloittaa alusta vain, jos kello hyppää yli 2 s (ajan synkronointi). Seuraavan ulospumppauksen komponentti kirjoitetaan uudelleen vain yli 2 s:n muutoksesta, koska arvio ankkuroidaan uudelleen jokaisessa vaiheessa ja vaiheiden alut mitataan sekunnin tarkkuudella. Sovellus jättää alle 2 s:n muutokset huomiotta. |
| EM1Data-historia ei näytä lyhyttä uudelleenkäynnistystä aukkona | Shellyn uudelleenkäynnistystä ei erota lyhyestä sähkökatkosta | Käynnistyssyy `Sys.GetStatus`-kutsun `reset_reason`-kentästä |
| `Sys`-komponentin `unixtime` ja `time` ovat `null`, kunnes kello on synkronoitu NTP-palvelimelta (Shellyn dokumentaatio). Uudelleenkäynnistyksen, esim. laiteohjelmistopäivityksen, jälkeen skripti voi käynnistyä ennen kuin kello on asetettu. Laitteella tätä ei ole nähty; testit olettavat, että se on mahdollista. | Ennen uudelleenkäynnistystä tallennettua vaihetta ei voi ajoittaa. Skripti 3.0.2 hylkäsi sen, ja vaihe oli tuntematon jopa 100 minuuttia. | Skripti 3.1.0 pitää tallennettua vaihetta tallessa enintään 5 minuuttia ja jatkaa sitä, kun kello on asetettu. Sillä välin laskettu panos saa aikansa silloin. |
| `reset_reason` puuttuu Shellyn dokumentaatiosta. Testilaitteella ohjelmallinen uudelleenkäynnistys antoi 3. Virrankytkennän arvot (1, 9 ja 14 ESP32-piirin ohjelmiston numeroinnissa) on oletettu, niitä ei ole nähty. | Sähkökatkoa ei voi varmasti erottaa uudelleenkäynnistyksestä | Skripti tulkitsee arvot 1, 9 ja 14 tai puuttuvan kentän ensimmäisten 5 minuutin aikana sähkökatkoksi (myös puhdistamo käynnistyy uudelleen ja aloittaa uuden puhdistusjakson), muut arvot uudelleenkäynnistykseksi (puhdistamo jatkaa). |
| Shellyn käyttöliittymän alapalkissa näkyy laitteen MAC-osoite | Näkyy kuvakaappauksissa | Rajaa alapalkki pois |
