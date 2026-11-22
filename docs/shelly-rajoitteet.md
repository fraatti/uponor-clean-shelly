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
| **Kutsupino on matala.** Natiivikutsu (esim. `Shelly.getComponentStatus`) 11 funktion syvyydessä kaatoi skriptin, 10 toimi. Pitkät lausekkeet (sisäkkäiset `?:` ja merkkijonojen yhdistäminen) syövät pinoa lisää. | `Uncaught Error: Too much recursion - the stack is about to overflow`, skripti pysähtyy | Tapahtumakäsittelijät vain muuttavat tilaa ja asettavat lippuja. `tick()` kirjoittaa komponentit, KVS:n ja tapahtumat ylimmältä tasolta. Pitkät lausekkeet pilkotaan välimuuttujiin. Jäljitelmä hylkää yli 7 tason natiivikutsut, ja testit tulostavat syvimmän ketjun (3.0.2:ssa enintään 7). Vika löytyi vasta laitteella 19.11.2026: v3.0.0–3.0.1 kaatui ensimmäisen puhdistusjakson alussa. |
| Ei rekursiota: synkroninen rekursio noin 6 tasoa sulkeumineen kaatoi skriptin | Kuten yllä | Silmukat ja asynkroniset ketjut (callback tai ajastin aloittaa tyhjästä pinosta) |
| Skripteillä on yhteensä noin 25 kt muistia | `Out of memory`, skripti pysähtyy | v3 käyttää noin 15 kt (huippu 19 kt). Kaksi isoa skriptiä ei mahdu yhtä aikaa. |
| Globaalit muuttujat ja funktiot vievät muistia koko ajan: noin 28–56 tavua ominaisuutta ja 70–85 tavua funktiota kohden | Muisti loppuu | Taulukot funktioiksi, harvoin muuttuvat asetukset vakioiksi |
| Suuret RPC-vastaukset (esim. `Shelly.GetComponents` kaikkine asetuksineen, noin 3 kt) | `out_of_memory` | Pienet kyselyt yksi kerrallaan |
| Enintään 5 ajastinta ja 5 samanaikaista RPC-kutsua | Virhe | Yksi toistuva `tick()`-ajastin, KVS-kirjoitukset jonossa yksi kerrallaan |

## Virtuaalikomponentit

| Rajoite | Mitä tapahtuu | Miten kierretty |
| --- | --- | --- |
| Laitteella on 10 virtuaalikomponenttipaikkaa (ryhmä mukaan lukien) | Uusia ei voi luoda | v3 käyttää 9 |
| `@meta`-lohko luetaan vain tiedoston ensimmäiseltä 1024 tavulta | Yli jäävät roolit ohitetaan ilman virhettä, ja jo luodut komponentit poistetaan | v3 ei käytä `@meta`-lohkoa |
| Home Assistantin Shelly-integraatio ei luo entiteettejä skriptin omistamille (`@meta`) komponenteille | Komponentit puuttuvat Home Assistantista | `Virtual.Add` ja tunnukset KVS:ään (`uc_vc`) |
| Skriptin omistamaa komponenttia ei voi poistaa `Virtual.Delete`-kutsulla | Virhe −107 | Ne poistuvat skriptin mukana |
| Komponenttien tunnukset voivat vaihtua uudelleenasennuksessa | Home Assistantin entiteetit vaihtuvat | Tunnukset tallennetaan KVS:ään ja käytetään uudelleen |
| `change`-tapahtuma tulee myös skriptin omasta `setValue`-kutsusta, vaikka arvo ei muuttuisi | Skripti luulee käyttäjän muuttaneen arvoa | Verrataan viimeksi kirjoitettuun arvoon |
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
| Web-editorin tekstikentän enimmäispituus on 50 000 merkkiä (`maxlength`). Testattu 19.11.2026: 60 000 merkin liitoksesta jäi 50 000, ja tallennus vei katkaistun koodin laitteelle. Laite itse hyväksyy pidemmän koodin RPC:llä (`Script.PutCode`, testattu 60 000 merkkiä). | Liitos katkeaa **ilman varoitusta**, ja katkaistu skripti tallentuu | Tiivistetty versio (noin 40 000 merkkiä) tai `shelly/tools/lataa_shellyyn.py`, joka kirjoittaa paloina. Ilmoitettu Shellylle web-käyttöliittymän Feedback-lomakkeella. |
| HTTP-kyselyyn, jossa on toisen sivun `Origin`-otsake, Shelly vastaa 503. Koskee RPC-kutsuja ja skriptin omia HTTP-osoitteita, myös paikallisesta tiedostosta avattua sivua (`Origin: null`). CORS-otsake skriptin vastauksessa ei auta. Asetusta tälle ei ole. Testattu 22.11.2026. | Selainsovellus ei voi käyttää HTTP-rajapintaa | WebSocket (`ws://<shelly>/rpc`) toimii toiselta sivulta. Skriptin tila luetaan kutsulla `Script.Eval` (`JSON.stringify(stateObject())`), tehohistoria `EM1Data.GetData`-kutsulla |
| EM1Data-minuuttienergia (`total_act_energy`) on porrastettu noin 0,2072 Wh:n askeliin. Siitä laskettu minuutin keskiteho saa vain arvot 0; 12,4; 24,9; 37,3; 49,7 ja 62,2 W ja voi olla minuutin pienintä tehoa pienempi. Todettu 22.11.2026. | Energiasta laskettu tehokäyrä hyppii | Minuutin teho pienimmästä ja suurimmasta tehosta (`min_act_power`, `max_act_power`); vuorokauden energian summa on silti oikein |
| `EM1Data.GetData` palauttaa laitteella enintään 31 minuuttitietuetta kyselyä kohden (HTTP ja WebSocket), vaikka pyydetty väli olisi pidempi. Kysely vie noin 100 ms, joten 7 vuorokautta (noin 10 000 tietuetta) vie noin 35 s. Rinnakkaiset kyselyt eivät nopeuta. Todettu 22.11.2026. | Viikon tehohistorian lataus kestää | Sovellus hakee ensin näkyvän välin ja piirtää sen, loput taustalla (`next_record_ts`) |
| Shelly ottaa vastaan vain muutaman WebSocket-yhteyden kerrallaan (`ws://<shelly>/rpc`). Kun Home Assistant ja kaksi selainsovellusta olivat yhteydessä, jokainen uusi yhteys sulki jonkin vanhan (koodi 1000): ensin Home Assistantin, jonka Uponor-entiteetit olivat 1–3 s tilassa unavailable, ja sitten aiemmin avatun, toimettoman yhteyden. Home Assistant yhdisti heti uudelleen ja saattoi sulkea vuorostaan jonkin toisen. Shellyn ohjeissa mainitaan vain 6 samanaikaisen ei-pysyvän RPC-kanavan raja. Todettu 22.11.2026. | Uuden sovellussivun avaaminen tai yhteyskatko näkyy Home Assistantissa lyhyenä katkona | Sovellus käyttää yhtä yhteyttä, sulkee sen taustalla olevalla sivulla minuutin jälkeen ja hakee uudelleen yhdistäessään vain puuttuvat minuutit. Sovellus kannattaa pitää auki vain yhdessä paikassa. |
| EM1Data-historia ei näytä lyhyttä uudelleenkäynnistystä aukkona | Shellyn uudelleenkäynnistystä ei erota lyhyestä sähkökatkosta | Käynnistyssyy `Sys.GetStatus`-kutsun `reset_reason`-kentästä |
| Shellyn käyttöliittymän alapalkissa näkyy laitteen MAC-osoite | Näkyy kuvakaappauksissa | Rajaa alapalkki pois |
