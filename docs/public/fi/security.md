---
slug: security
category: Vianmääritys ja tietoturva
title: Tilien ja asiakirjojen suojaaminen
description: Suojaa tunnistetiedot ja lähetettävät tiedostot. Tutustu käännöspalvelun ja hallinnan käyttöoikeusrajoihin.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Jos API-avain paljastuu, pyydä ylläpitäjää heti mitätöimään se ja myöntämään uusi avain.
- Ilmoita haavoittuvuuksista [GitHubin yksityisellä lomakkeella](https://github.com/n624-dev/latex-renderer/security/advisories/new). Älä julkaise yksityiskohtia julkisessa vikailmoituksessa.

## Tunnistetiedot {#資格情報}

- Älä lisää API-avaimia komentoriviargumentteihin (ne näkyvät esimerkiksi komennolla `ps`), URL-osoitteisiin, Git-tietovarastoihin, lokeihin tai tekoälyavustajan keskusteluihin.
- Käytä paikalliseen tallennukseen Windowsissa DPAPI:a ja Linuxissa tai macOS:ssä vain omistajalle lukuoikeuden antavaa tiedostotilaa `0600`.
- Käytä selaimen salasanoja, OIDC-salaisuuksia ja istuntoevästeitä vain niille tarkoitettuihin toimintoihin. Pidä ne erillään komentorivin ja API:n avaimista (`lrk_` ja `lra_`).

## Projektit {#プロジェクト}

Järjestelmä käsittelee kaikkia LaTeX-lähteitä ja liitteitä epäluotettavana syötteenä. Symboliset linkit, TeXin komentotulkkiyhteys, ulkoisten komentojen suoritus ja verkkoyhteydet säilön ulkopuolelle on estetty. Noudata eristystä, aikarajoja ja tiedostorajoituksia.

## Julkiset ja hallintaan tarkoitetut palvelut {#公開領域と管理領域}

Julkiset ohjeet ja lataukset, kirjautumista edellyttävät sivut (`/app/` ja `/admin/`) sekä käännösrajapinta toimivat eri poluissa samassa ensisijaisessa HTTPS-alkuperässä.

- **Verkkoraja.** Cloudflare-profiilin ainoa sisääntuloreitti on Tunnel/Workers. Itsenäisessä profiilissa se on TLS-käänteisvälityspalvelin. Kaikki sovelluspalvelut kuuntelevat paikallista silmukkaliitäntää. Sisäinen API, SQLite ja hallintasoketit pysyvät yksityisinä. Kirjautumista edellyttävät alueet jätetään hakukoneiden indeksien ulkopuolelle.
- **Selaimen tunnistautuminen ja istunnot.** Ulkoisen tunnistuspalvelun käyttäjätunnisteen `provider + issuer + subject` on täsmättävä tarkasti. Sähköpostiosoite tai näyttönimi ei yhdistä tilejä automaattisesti. Palvelin voi mitätöidä istunnon heti. Tilaa muuttavat pyynnöt vaativat tarkan `Origin`-vastaavuuden ja istuntokohtaisen CSRF-tunnisteen. Salasanat suojataan menetelmällä `scrypt` ja rootin omistamalla palvelinkohtaisella lisäsalaisuudella (pepper). Käytä julkisessa asennuksessa lisäksi välityspalvelimen yhteys- ja pyyntötiheysrajoja sekä palveluntarjoajan DDoS-suojausta.
- **Etä-MCP.** `/mcp`, OAuth-tunnisteiden päätepiste ja palvelun löytämiseen tarvittavat metatiedot ovat julkisia. Työkalun kutsu vaatii lyhytikäisen Bearer-tunnisteen, jonka kohdeyleisö ja käyttöoikeudet ovat rajatut. Valtuutus käyttää palvelun `/app/` selainistuntoa ja kytkee oikeuden nimenomaisesti olemassa olevaan aktiiviseen käyttäjään.
  - Tavallinen vastaus (`content`) sisältää vain jatkamiseen tarvittavat omistajakohtaiset tunnisteet, tilat, kohdistimet ja rajatut diagnostiikkatiedot. Käyttäjän antamat polut ja diagnostiikkatiedot palautetaan epäluotettavina tietoina. Ohjausmerkit poistetaan ja pituutta ja määrää rajoitetaan.
  - Tavalliseen `content`-sisältöön ja diagnostiikkalokeihin ei sisälly OAuth-tunnisteita, API-avaimia, käyttölippuja, raakaa base64-dataa, kokonaisia lähteitä tai lokeja, pinovedoksia, Accessin subject-tunnisteita tai palvelimen sisäisiä polkuja. Kokonaisia PDF-tiedostoja ja lokeja voi lukea vain resurssipyynnöllä, joka tarkistaa omistajuuden uudelleen.

## Paikallinen asetusten verkkokäyttöliittymä {#local-setup-web-ui}

`n624-latex setup --gui` (aiemmin `latex-render setup --gui`) kuuntelee vain oman tietokoneen osoitteen `127.0.0.1` satunnaista porttia.

- Komentorivityökalun avaaman osoitteen fragmentti (`#...`) sisältää kertakäyttöisen käynnistystunnisteen. Selain poistaa sen heti historiasta ja vaihtaa sen lyhytikäiseen istuntoon.
- Jokainen API-toimi edellyttää tarkkaa `Origin`-vastaavuutta, Bearer-istuntoa ja erillistä CSRF-tunnistetta. CORS on poistettu käytöstä. Palvelu tarkistaa Host-otsakkeen ja asiakkaan paikallisen silmukkaosoitteen sekä käyttää tiukkaa CSP-käytäntöä ja asetuksia `frame-ancestors 'none'` ja `no-store`.
- Annettu avain välitetään vain tallennustoiminnolle. Sitä ei palauteta tila-, diagnostiikka- tai koemuunnosvastauksissa. Käyttöliittymä sulkeutuu 30 minuutin käyttämättömyyden tai kahden tunnin kokonaisajan jälkeen.
