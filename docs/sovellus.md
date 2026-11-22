# Selainsovellus

[English](app.md) | **Suomi**

`app/uponor-clean-app.html` näyttää puhdistamon tilan ja sähkönkulutuksen suoraan Shellystä. Home Assistantia ei tarvita. Sovellus on yksi HTML-tiedosto, joka ei hae mitään internetistä. Shelly voi jakaa sen itse, jolloin se aukeaa kotiverkossa myös puhelimella.

Sovelluksessa on kaksi näkymää, joiden välillä vaihdetaan otsikon vieressä: **Kuva** ja **Tiedot**.

![Selainsovellus: Kuva](img/sovellus_kuva.jpg)

## Kuva

Kuva-näkymä on sama piirros kuin Home Assistant -kortissa ([kortin ohje](../ha-card/README.md)). Home Assistantia se ei tarvitse: kortin koodi on sovelluksen sisällä, ja tiedot tulevat suoraan Shellystä.

- puhdistamo sivuleikkauksena tai ylhäältä, letkut, pumppujen virtaus, säiliöiden pinnat ja lietekerros vaiheen mukaan
- vaihe ja sen eteneminen, seuraava ulospumppaus, panokset, teho, energia vuorokaudessa, pinnan arvio, kemikaali ja lietemuistutus
- aikajana tehoineen 2, 6 tai 48 tunnin ajalta; aikajanaa voi selata ja toistaa, jolloin piirros näyttää valitun hetken
- lokikirja

Kemikaalin määrän ja lietelaskurin voi syöttää kynäkuvakkeesta. Sovellus tallentaa ne suoraan Shellyn skriptille.

Teho ja energia tulevat Shellyn tallentamasta minuuttihistoriasta (noin 7 vuorokautta). Vaiheita, panoksia ja varoituksia Shelly ei tallenna. Siksi aikajanan vaiheet, lokikirja ja panokset päivittäin karttuvat siitä alkaen, kun sovellus on ollut auki. Selain muistaa ne 8 vuorokautta, mutta vain samassa selaimessa. Kun sovellus avataan ensimmäistä kertaa, aikajanalla näkyy vain nykyinen vaihe.

## Tiedot

![Selainsovellus: Tiedot](img/sovellus.jpg)

- **Nyt**: vaihe, jakso ja vaihekoodi (esim. `S103`), vaiheen alkamisaika ja eteneminen firmwaren vaiheajoista.
- **Seuraava ulospumppaus** kellonaikana ja aikana siihen. Odotusjaksossa sovellus näyttää, milloin loma-automatiikka alkaa, jos aloitustasoa ei saavuteta. Lisäksi näkyy viimeisin ulospumppaus.
- **Teho** normalisoituna 230 V:iin (alla mitattu teho ja jännite) noin 3 sekunnin välein, **panokset**, **kemikaali** ja sen riittävyys sekä **lietelaskuri**.
- **Varoitukset** palkkina sivun yläosassa.
- **Tehonkulutus** käyränä 6 tunnin, 24 tunnin tai 7 vuorokauden ajalta. Käyrä on normalisoitu 230 V:n jännitteelle samalla kaavalla kuin skriptissä, joten jännitteen vaihtelu ei heiluta tasoja (ilmastus noin 57 W, sisäänpumppaus noin 43 W). 6 ja 24 tunnin näkymässä käyrällä on piste minuutin välein, 7 vuorokauden näkymässä 15 minuutin keskiarvo. Käyrän yläpuolella on valitun jakson keskiteho ja energia mitattuina. Osoittimen kohdalla näkyy normalisoitu teho sekä mitattu teho ja jännite.
- **Tapahtumat** sinä aikana, kun sovellus on auki: vaihemuutokset, valmiit panokset, varoitukset, kemikaalin ja laskurien syötöt sekä skriptin käynnistykset.
- **Laite**: skriptin ja Shellyn versio, käyntiaika ja kellon tila.

Sovellus on suomeksi tai englanniksi (selaimen kielen mukaan tai asetuksista). Vaalea ja tumma teema seuraavat käyttöjärjestelmää. Kapealla näytöllä tiedot ovat allekkain.

<img src="img/sovellus_kapea.jpg" alt="Sovellus kapealla näytöllä" width="300">

## Avaaminen

Sovellus ottaa yhteyden Shellyyn kotiverkossa. Helpointa on antaa Shellyn jakaa se itse.

### Shellystä (suositus)

Shellyyn tehdään kaksi skriptiä:

- `uponor-clean-app` on pieni latainsivu. Se käynnistyy Shellyn mukana ja vie muistia noin 2 kt (huippu alle 4 kt).
- `uponor-clean-app-data` ja `uponor-clean-app-data2` ovat itse sovellus pakattuna (yhteensä noin 86 000 merkkiä, enintään 45 000 merkkiä skriptiä kohden). Niitä ei käynnistetä koskaan, vaan ne ovat pelkkä varasto. Jos sovellus kasvaa, se jatkuu skripteissä `-data3` jne.

Helpointa on antaa sovelluksen tehdä skriptit itse. Ne voi tehdä myös Shellyn web-käyttöliittymässä tai Python-työkalulla. Mikään tapa ei koske tunnistusskriptiin. Nimien pitää olla tarkalleen nämä, koska latainsivu etsii sovelluksen nimellä ja sovellus erottaa tunnistusskriptin nimen perusteella.

#### Sovelluksen asetuksista (helpoin)

1. Lataa `app/uponor-clean-app.html` GitHubista koneelle ja avaa se selaimella (Chrome, Edge, Firefox tai Safari).
2. Anna Shellyn osoite ja yhdistä.
3. Avaa asetukset (rataskuvake) ja paina **Asenna Shellyyn**.

Sovellus tallentaa itsensä Shellyyn, käynnistää latainsivun ja näyttää sovelluksen osoitteen. Ennen kirjoittamista se tarkistaa, että Shellyyn jää vähintään 100 kt vapaata tilaa (ks. [Tila ja Shellyn firmware-päivitykset](#tila-ja-shellyn-firmware-päivitykset)), ja lopuksi se lukee kirjoittamansa skriptit takaisin ja vertaa ne. Asetuksissa näkyy myös, mikä versio Shellyssä on.

Uusi versio asennetaan samoin: avaa se koneella ja paina **Päivitä Shellyyn**. Asennus onnistuu myös Home Assistantin kautta avatusta sovelluksesta.

#### Web-käyttöliittymästä

1. Avaa Shellyn web-käyttöliittymä (`http://<shellyn-ip>/`), avaa **Scripts** ja valitse **Create script**. Anna nimeksi `uponor-clean-app-data`.
2. Avaa GitHubissa tiedosto `app/uponor-clean-app-data.txt`, valitse **Raw**, kopioi koko sisältö (Ctrl+A, Ctrl+C), liitä se editoriin ja tallenna (levykekuvake). Tiedosto on enintään 45 000 merkkiä, joten se mahtuu editoriin (enintään 50 000 merkkiä). Tee samoin skripti `uponor-clean-app-data2` tiedostosta `uponor-clean-app-data2.txt` (ja `-data3` jne., jos sellaisia on). **Älä käynnistä tätä skriptiä äläkä ota sille käyttöön Run on startup -asetusta**: se on pakattua dataa eikä ohjelmakoodia.
3. Palaa **Scripts**-sivulle, valitse **Create script** ja anna nimeksi `uponor-clean-app`.
4. Liitä editoriin tiedoston `app/uponor_clean_app_loader.js` sisältö samalla tavalla, tallenna ja käynnistä (**Start**). Konsoliin tulee rivi `Uponor Clean app: http://<shelly>/script/<id>/app`.
5. Palaa **Scripts**-sivulle ja ota `uponor-clean-app`-skriptille käyttöön **Run on startup**.

Kun sovellus päivittyy, poista vanha `uponor-clean-app-data` (ja mahdolliset `-data2`, `-data3`) ja tee uusi kohtien 1–2 mukaan. Latainsivua ei yleensä tarvitse päivittää.

#### Python-työkalulla

```
python3 shelly/tools/sovellus_shellyyn.py 192.168.0.102            # salasanan kanssa: --salasana SALASANA
```

Työkalu tekee skriptit, vertaa ne laitteelta luettuun ja käynnistää latainsivun. Kuten sovellus, se poistaa päivityksessä ensin vanhat data-skriptit ja jättää Shellyyn vähintään 100 kt vapaata tilaa. Kun sovellus päivittyy, aja työkalu uudelleen. `--poista` poistaa sovelluksen skriptit.

#### Sovelluksen osoite

Sen jälkeen sovellus aukeaa millä tahansa kotiverkon laitteella, myös puhelimella, osoitteesta `http://<shellyn-ip>/script/<id>/app`, esim. `http://192.168.0.102/script/3/app`. `<id>` on `uponor-clean-app`-skriptin numero (Scripts-listan oikeassa reunassa, esim. `script:3`), ja koko osoite näkyy sovelluksen asetuksissa, skriptin konsolissa ja työkalun tulosteessa. Kirjoita alkuun `http://`. Shellyn osoitetta ei kysytä, koska sivu tulee Shellyltä. Home Assistantia, muuta palvelinta tai internetyhteyttä ei tarvita. Puhelimessa sivun voi lisätä aloitusnäytölle.

#### Päivitys ja poisto

Sovellusta päivitettäessä vanha poistetaan ja uusi tehdään tilalle. **Päivitä Shellyyn** poistaa ensin vanhat `uponor-clean-app-data`-skriptit ja kirjoittaa sitten uudet, joten Shellyssä ei ole kahta versiota yhtä aikaa. Latainsivu `uponor-clean-app` jää paikalleen ja pitää numeronsa, joten sovelluksen osoite ja puhelimen kirjanmerkki eivät muutu.

**Poista Shellystä** asetuksissa (painetaan kahdesti) tai `sovellus_shellyyn.py <ip> --poista` poistaa sovelluksen skriptit. Tunnistusskripti jää paikalleen.

#### Tila ja Shellyn firmware-päivitykset

Skriptit ovat samassa tiedostojärjestelmässä kuin Shellyn omat tiedostot ja asetukset. Testilaitteessa (Shelly Mini EM Gen4, firmware 2.2.0) tiedostojärjestelmä on 768 kt, ja sovelluksen (1.4.0, 87 kt) kanssa vapaata on noin 116 kt.

Shelly ei kerro, paljonko vapaata tilaa firmware-päivitys tarvitsee. Shellyn ESP32-laitteiden firmware perustuu Mongoose OS:ään (siksi esim. [mgos32-to-tasmota32](https://github.com/tasmota/mgos32-to-tasmota32) toimii sen päivitysmekanismilla); Gen4:n osalta tätä ei ole varmistettu. Mongoose OS:n [ohjeen](https://mongoose-os.com/docs/mongoose-os/userguide/ota.md) mukaan päivitys kirjoittaa uuden firmwaren ja sen tiedostojärjestelmän erilliseen osioon ja siirtää sinne käyttäjän tiedostot, kuten skriptit. Jos jokin vaihe epäonnistuu, päivitys keskeytyy ja vanha firmware jää käyttöön. Käyttäjän tiedostojen pitää siis mahtua uuden firmwaren tiedostojärjestelmään.

Siksi sovellus ja työkalu jättävät aina vähintään 100 kt vapaaksi. Raja on varmuusvara, ei Shellyn ilmoittama luku. Jos firmware-päivitys silti epäonnistuu, poista sovellus Shellystä, päivitä firmware ja asenna sovellus uudelleen.

### Muut tavat

1. **Tiedostona**: lataa `app/uponor-clean-app.html` koneelle ja avaa se selaimella. Puhelimessa tiedoston avaaminen riippuu selaimesta, joten puhelimella kannattaa käyttää Shellyn osoitetta.
2. **Home Assistantin kautta**: kopioi tiedosto Home Assistantin kansioon `/config/www/` (kuten kortti). Sovellus aukeaa kotiverkossa osoitteesta `http://homeassistant.local:8123/local/uponor-clean-app.html`. Home Assistant vain jakaa tiedoston; tiedot tulevat suoraan Shellystä.
3. **Muulta kotiverkon palvelimelta** `http://`-osoitteesta (esim. NAS).

Näin avattuna sovellus kysyy ensimmäisellä kerralla Shellyn osoitteen (esim. `192.168.0.102`). Osoitteen voi antaa myös linkissä: `uponor-clean-app.html?host=192.168.0.102`. Sovellus muistaa sen samassa selaimessa. Kielen voi valita linkissä `&lang=fi` tai `&lang=en`.

`https://`-osoitteesta (esim. GitHub Pages, Home Assistantin etäyhteys tai keskustelusovelluksen esikatselu) avattu sivu ei saa yhteyttä. Selain estää salatulta sivulta salaamattoman `ws://`-yhteyden, eikä Shellyssä ole salattua paikallista yhteyttä. Sovellus kertoo tästä.

**Kodin ulkopuolelta** sovellus toimii VPN-yhteydellä kotiverkkoon. Shellyn pilven kautta tiedot eivät tule: pilven rajapinnalla ei voi lukea skriptin tilaa eikä tehohistoriaa.

## Salasana

Jos Shellyssä on salasana, sovellus pyytää sen. Tunnistus on Shellyn digest-tunnistus (SHA-256). Kun valitset *Muista salasana tällä laitteella*, selaimeen tallentuu salasanasta laskettu tiiviste, ei itse salasanaa. Tiivisteellä pääsee kuitenkin Shellyyn, joten älä valitse muistamista yhteiskäyttöisellä koneella.

Salasanatoiminto on testattu Shelly-jäljitelmällä, joka toimii Shellyn ohjeen mukaan. Oikeassa laitteessa tätä ei ole kokeiltu, koska testilaitteessa ei ole salasanaa.

## Miten sovellus toimii

Kaikki kulkee Shellyn WebSocket-rajapinnan kautta (`ws://<shelly>/rpc`):

| Tieto | RPC-kutsu | Väli |
| --- | --- | --- |
| Skripti | `Script.List` (nimi alkaa `uponor-clean`, ei sovelluksen omat skriptit) | yhteyden alussa |
| Skriptin tila | `Script.Eval` → `JSON.stringify(stateObject())` | 6 s ja tapahtuman jälkeen |
| Teho ja jännite | `EM1.GetStatus` tai Shellyn lähettämä `NotifyStatus` | 3 s |
| Tapahtumat | skriptin `uponor`-tapahtumat (`NotifyEvent`) | heti |
| Tehohistoria | `EM1Data.GetData` (minuuttitiedot: energia, pienin ja suurin teho, jännite) | alussa 7 vrk, sitten minuutin välein uudet |
| Energiamittari | `EM1Data.GetStatus` (`total_act_energy`) | minuutin välein |
| Skriptin komponentit | `KVS.Get` → `uc_vc` (kemikaalin ja lietelaskurin syöttö `Number.Set`-kutsulla) | yhteyden alussa |

Skriptin tilakysely `http://<shelly>/script/<id>/state` ei kelpaa selaimelle: Shelly vastaa 503, jos HTTP-kyselyssä on toisen sivun `Origin`-otsake (ks. [`shelly-rajoitteet.md`](shelly-rajoitteet.md)). Siksi sovellus lukee saman tilan `Script.Eval`-kutsulla. Skriptiin ei tarvittu muutoksia; funktion `stateObject()` nimi on nyt sovitun rajapinnan osa.

Minuutin teho lasketaan minuutin pienimmästä ja suurimmasta tehosta. Shellyn minuuttienergia on porrastettu noin 0,207 Wh:n askeliin, joten siitä laskettu keskiteho hyppisi 12,4 W:n portain (ks. [`shelly-rajoitteet.md`](shelly-rajoitteet.md)). Jos teho muuttui kesken minuutin, käytetään energiasta laskettua keskiarvoa pienimmän ja suurimman tehon välissä. Teho normalisoidaan kaavalla (P − 4) · (230 / U)² + 4, kun P on yli 10 W.

Shellyn jakamana latainsivu hakee pakatun sovelluksen samasta osoitteesta `Script.GetCode`-kyselyillä, purkaa sen selaimessa ja avaa sen. Kyselyt menevät samaan osoitteeseen kuin sivu, joten `Origin`-rajoite ei koske niitä.

Kuva-näkymä on Home Assistant -kortti `ha-card/uponor-clean-card.js` sellaisenaan. `app/tools/build_app.js` lisää sen sovellukseen (tiivistettynä, jos terser on asennettu: `npm install --no-save terser@5.31.6`) ja tekee pakatut tiedostot uudelleen. Sovellus antaa kortille Home Assistantin tilalle pienen sovittimen: skriptin tila entiteetteinä, niiden historia selaimen muistista, tehohistoria ja energiamittari Shellystä sekä `number.set_value` Shellyn `Number.Set`-kutsuna skriptin komponenteille.

**Asenna Shellyyn** tallentaa sivun sellaisena kuin selain sen latasi (`document.documentElement.outerHTML` ennen kuin skripti muuttaa sivua), pakkaa sen selaimessa (gzip ja base64, 76 merkin rivit) ja kirjoittaa sen WebSocketin kautta `Script.PutCode`-kutsuilla 1 024 merkin paloina. Latainsivun koodi on sovelluksen sisällä samana kuin tiedostossa `app/uponor_clean_app_loader.js`.

Vaiheiden historiaa sovellus ei näytä, koska Shelly ei tallenna sitä. Tapahtumaloki alkaa, kun sovellus avataan.

## Testaus ilman laitetta

`test/shelly_ws_mock.js` ajaa oikeaa v3-skriptiä Shelly-jäljitelmässä simuloidun puhdistamon päällä ja vastaa samoihin WebSocket-kutsuihin kuin Shelly:

```
node test/shelly_ws_mock.js --port 8098 --days 3
# avaa app/uponor-clean-app.html?host=127.0.0.1:8098
node test/shelly_ws_mock.js --port 8097 --days 1 --password salainen   # salasanan kanssa
```

Jäljitelmä simuloi ensin annetun määrän vuorokausia (noin 10 s vuorokautta kohden) ja jatkaa sitten reaaliajassa.

Jäljitelmä osaa myös tallentaa skriptejä ja vastata niiden HTTP-osoitteisiin, joten Shellyyn asennusta voi kokeilla sillä:

```
python3 shelly/tools/sovellus_shellyyn.py 127.0.0.1:8098
# avaa http://127.0.0.1:8098/script/<id>/app
```

`test/app_picture_test.js` kokeilee Kuva-näkymää: kortti, vaihe, tehohistoria, energia, selaimen muistama historia, kemikaalin ja lietelaskurin syöttö sekä kielen vaihto.

`test/app_install_test.js` kokeilee Asenna Shellyyn -painiketta jäljitelmää vastaan Playwrightilla: asennus tiedostosta, Shellyn jakaman sovelluksen avaaminen, monen osan asennus, Python-työkalu, liian vähäinen tila ja kolme käynnissä olevaa skriptiä.
