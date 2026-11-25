---
slug: server-setup
category: Oma palvelin
title: Palvelimen ohjattu määritys
description: Määritä tunnistautuminen, HTTPS ja suoritusrajat valmistellulla palvelimella selaimessa tai päätteessä.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Menetelmän valitseminen {#どの手順を使うか}

Uutta asennusta varten [valmistele palvelin](/fi/docs/self-hosting/#準備するもの) ja avaa ohjattu määritys **selaimessa**. Samalla työkalulla voit muuttaa käytössä olevan palvelimen kirjautumista ja suoritusrajoja.

- Tarkista vaadittavat paketit ja vapaa levytila ajamalla palvelimella `sudo n624-latex server setup --plan`. Korjaa ilmoitetut puutteet ja toista tarkistus.
- Kun muutat käytössä olevaa erillistä HTTPS-palvelua tai lähiverkon HTTPS-palvelua (Akebi), lisää käynnistyskomentoon `--ingress`.
- Jos Docker ilmoittaa suppeassa palvelinasennuksessa puuttuvista ydinmoduuleista, noudata ohjetta ja yritä uudelleen. Jos esimerkiksi `nf_tables` vaaditaan, ylläpitäjän tulee ajaa `sudo modprobe nf_tables`.

## Avaaminen selaimessa {#ブラウザで開く}

Muodosta SSH-yhteys käyttöönottoon tarkoitetulla tavallisella käyttäjätilillä ja aja seuraava komento. **Pidä pääte auki määrityksen loppuun asti.**

```sh
sudo n624-latex server setup --web
```

1. Tarkista ensiasennuksen valmisteluvaiheet ja jatka kirjoittamalla `PREPARE`. Odota, että allekirjoitettu julkaisu on ladattu, palvelut valmisteltu ja ensimmäinen TeX-ympäristö rakennettu ja tarkistettu.
2. Etsi päätteestä kertakäyttöinen osoite. Se on voimassa **5 minuuttia**.
3. Avaa osoite palvelimella tai käytä **SSH-porttiohjausta** yhdistääksesi omalta koneeltasi samaan porttiin. Jos ilmoitettu portti on `41234`, aja seuraava komento toisessa paikallisessa päätteessä ja avaa selaimessa määritystyökalun ilmoittama osoite.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Pidä määritysosoite omana tietonasi. Älä julkaise sen porttia internetiin tai käänteisvälityspalvelimen kautta.

## Asetusten tarkistaminen ja käyttöönotto {#プレビューから適用まで}

1. **Valitse yhteys- ja kirjautumistapa.** Määritä uudessa asennuksessa HTTPS ja ensimmäinen omistaja. Anna salasanat ja OIDC-asiakassalaisuudet niille tarkoitetuissa peitetyissä kentissä.
2. **Tarkista esikatselu.** Tarkista julkinen osoite ja yhteystapa. Jos vaihdat kirjautumistapaa, valmistele omistajan tunniste uudelle menetelmälle, kun voit vielä kirjautua sisään.
3. **Ota muutokset käyttöön.** Odota palvelujen käynnistymistä tai uudelleenkäynnistymistä.
4. **Kirjaudu ja luo PDF.** [Tarkista asennus](/fi/docs/self-hosting/#導入完了の確認) toisessa selainikkunassa.

Jos otat uudessa asennuksessa käyttöön salasanat ja OIDC:n, rekisteröi omistaja ensin salasanalla ja lisää samalle tilille OIDC-arvot `issuer` ja `subject`. Suoritusrajoissa käynnistyskynnys tarkoittaa ennen työn aloittamista vapaana vaadittua muistia. Ajonaikainen raja määrittää, paljonko muistia säilö voi käyttää.

## Keskeytyneen muutoksen tarkistaminen {#中断した変更を確認する}

- Jos yhteys katkeaa muutosten käyttöönoton alkamisen jälkeen, tarkista ensin saman toiminnon tulos.
- Jos määritystyökalun prosessi päättyi, käynnistä se uudelleen samalle kohteelle ja valitse selaimessa **Recover** tai päätteessä **`RECOVER`**. Jos omistaja on jo rekisteröity, työkalu käyttää olemassa olevaa rekisteröintiä ja jatkaa vahvistukseen. Tämä asetusten palautustoimi ei palauta tietokannan aiempaa varmuuskopiota.
- Palautustiedostot voivat sisältää TLS- tai OIDC-salaisuuksia. Vältä niiden muokkaamista käsin. Ilmoita tukipyynnössä vain näytetty virhekoodi ja vaihe.

## Avaaminen päätteessä {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Kun muutat käytössä olevaa palvelinta, syötä jokainen asetus tai säilytä nykyinen painamalla Enter tyhjässä kentässä. Jos haluat ensiasennuksessa lähiverkon automaattisen HTTPS:n, valitse `LAN` ja seuraa ohjeita. Kun määrität päätteessä ensimmäistä kertaa oman HTTPS:n tai olemassa olevan Cloudflare-reitin, anna pyydetyn muotoinen JSON yhdellä rivillä. Ensikertalaisen on helpointa [aloittaa selaimessa](#ブラウザで開く).

### Aiemmat versiot ja käsin tehdyt asennukset {#旧版-手動配置の場合}

> [!DETAILS] server-setup.mjs-tiedoston suorittaminen suoraan
>
> Jos valmistelit palvelimen ilman APT:tä käyttäen erillistä käyttäjää, Node.js:ää ja Dockeria ilman root-oikeuksia ja sijoitit tarkistetun julkaisun kansioon `/opt/latex-renderer/current`, käynnistä `server-setup.mjs` suoraan. Katso uuden isäntäkoneen valmistelu [käsinasennusohjeesta](/fi/docs/self-hosting/#現在の提供状況).
>
> | Tehtävä | Käynnistysargumentti | Edellytykset |
> | --- | --- | --- |
> | Nykyisen tunnistautumisen tai rajojen muutos | `--existing` | Omistaja on rekisteröity ja palvelut toimivat |
> | Alkuasetukset ja ensimmäisen omistajan rekisteröinti | `--initial` | Jakelu ja ympäristö on valmisteltu, eikä aiempia käyttöasetuksia tai tietokantaa ole |
> | Hallitun erillisen HTTPS:n muuttaminen | `--ingress` | Erillinen itsenäinen HTTPS. Siirtyminen jaetusta Nginxistä on erillinen toimenpide. |
>
> - **Päätekäyttöliittymä**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Selainkäyttöliittymä**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Katso [ohjatun määrityksen syötteet ja palautus](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
