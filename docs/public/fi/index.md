---
slug: index
category: Aloitus
title: LaTeX Rendererin käyttöopas
description: Muunna LaTeX-asiakirjoja PDF-muotoon selaimessa, päätteessä tai tekoälyavustajan avulla.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Luo ensimmäinen PDF-tiedosto {#最短でpdfを作る}

1. Avaa [verkkosovellus](/app/) ja kirjaudu sisään ylläpitäjän ilmoittamalla tavalla.
2. Valitse tiedosto `.tex` ja napsauta **Muunna PDF-muotoon**. Jos asiakirjassa käytetään kuvia tai lähdeluetteloa, pakkaa asiakirja ja sen tarvitsemat tiedostot ZIP-arkistoksi ja valitse arkisto.
3. Avaa PDF-tiedosto tulossivulta. Löydät tuloksen myöhemmin verkkosovelluksen kohdasta **Historia**.

Jos sinulla ei ole testiasiakirjaa, tallenna seuraava esimerkki nimellä `main.tex` käyttäen UTF-8-koodausta.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Japaninkielinen ladontaesimerkki ja ZIP-arkiston rakenne](/fi/docs/projects/)
- [Verkkosovelluksen ohje](/fi/docs/web/)
- [PDF- ja PNG-tiedostojen tallennus ja SVG-kuvien erotuksen uusiminen](/fi/docs/outputs/)

Jos haluat käyttää päätettä, [asenna käyttöjärjestelmäsi komentorivityökalu](/fi/docs/client/). Määritä yhteys komennolla `n624-latex setup`. Siirry kansioon, johon tallensit tiedoston `main.tex`, ja suorita `n624-latex main.tex`. Tuloksena on `main.pdf`.

## Valitse käyttötapa {#利用方法を選ぶ}

| Mitä haluat tehdä? | Työkalu | Ohje |
| --- | --- | --- |
| **Muuntaa asiakirjan selaimessa** | Verkkosovellus | [Muuntaminen selaimessa](/fi/docs/web/) |
| **Muuntaa asiakirjan päätteessä ja tallentaa tulokset omalle koneelle** | CLI Windowsille, macOS:lle tai Linuxille | [Komentorivityökalun asennus](/fi/docs/client/) |
| **Muuntaa asiakirjan ChatGPT:llä tai Claudella** | Remote MCP ja OAuth | [ChatGPT:n tai Clauden yhdistäminen](/fi/docs/mcp/) |
| **Käsitellä paikallisia asiakirjoja Codexissa tai Claude Codessa** | CLI, Local MCP ja taito | [Codexin tai Claude Coden käyttö](/fi/docs/integrations/) |
| **Automatisoida muunnokset omassa sovelluksessa** | HTTP-rajapinta | [Julkinen rajapinta](/fi/docs/api/) |
| **Ylläpitää palvelua omalla Linux-palvelimella** | Oma palvelin | [Oman palvelimen ylläpito](/fi/docs/self-hosting/) |

## Mitä tarvitset? {#必要なもの}

- **Verkkosovellus ja Remote MCP.** Tarvitset tilin, jolla voit kirjautua palvelimelle ylläpitäjän ohjeen mukaan.
- **CLI, Local MCP ja HTTP-rajapinta.** Pyydä ylläpitäjältä renderöintirajapinnan avain, jonka alussa on `lrk_`.
- **Komentorivityökalun vaatimukset asennustavan mukaan**
  - Debian ja Ubuntu, APT-asennus: paketti sisältää oman Node.js-version.
  - macOS, Homebrew-asennus: Homebrew asentaa tarvittavan Node.js-version.
  - Ladattava asennusohjelma Windowsille, macOS:lle tai Linuxille: tarvitset Node.js-version 24 tai uudemman.

Palvelin kääntää asiakirjat. Mikään näistä käyttötavoista ei vaadi TeX Liven asentamista omalle koneelle.

> [!WARNING]
> Älä liitä API-avaimia tekoälykeskusteluihin, lähdekoodiin, Git-tietovarastoihin tai lokeihin. Jos epäilet avaimen vuotaneen, pyydä ylläpitäjää mitätöimään se ja myöntämään uusi viipymättä.

Jos kirjautuminen tai muuntaminen ei onnistu, katso [Vianmääritys](/fi/docs/troubleshooting/).
