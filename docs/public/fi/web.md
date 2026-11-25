---
slug: web
category: Verkkosovellus
title: Asiakirjan muuntaminen selaimessa
description: Tee PDF-tiedosto TeX-tiedostosta tai ZIP-arkistosta ja tarkastele aiempien muunnosten tuloksia.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## PDF-tiedoston luominen selaimessa {#ブラウザでpdfへ変換}

1. Avaa [verkkosovellus](/app/) ja kirjaudu sisään ylläpitäjän ilmoittamalla tavalla.
2. Valitse tiedostot tai vedä ne sivulle.
   - Jos asiakirjassa on vain yksi tiedosto, valitse `.tex` suoraan.
   - Jos siinä on kuvia, lähdeluettelo tai useita `.tex`-tiedostoja (esimerkiksi `\input`-komennolla liitettyjä), kokoa asiakirja ja sen tarvitsemat tiedostot yhteen `.zip`-arkistoon. Katso [Tuetut tiedostot ja ZIP-arkiston rakenne](/fi/docs/projects/).
   - Jos valitset useita erillisiä `.tex`-tiedostoja, kukin muunnetaan omana asiakirjanaan.
3. Jos ZIP-arkistossa on useita `.tex`-tiedostoja ja näkyviin tulee tiedostonvalitsin, valitse aloitustiedostoksi pääasiakirja.
4. Napsauta **Muunna PDF-muotoon**. Kun muunnos valmistuu, PDF ja sivujen esikatselut näkyvät tulossivulla.

Jos haluat käyttää muuta käännösmoottoria kuin LuaLaTeXia, valitse se kohdasta **Kohde ja tulostusasetukset → Ladontamoottori**. [Renderöintiympäristöstä](/app/environment/) näet käytettävissä olevat moottorit ja sen, onko PDF, SVG ja SVG-kuvien sijainti tarkistettu. pLaTeX ja upLaTeX tarvitsevat palvelimelle japanin kielikokoelman.

## Asiakirjan muokkaaminen selaimessa {#ブラウザーで文書を編集する}

1. Avaa asiakirja [Projekteista](/app/projects/) ja valitse **Muokkaa TeXiä**. Uusi projekti alkaa tyhjällä `main.tex`-tiedostolla. Voit myös valita mallipohjan.
2. Muutokset tallentuvat luonnokseen automaattisesti. Lisää kuvia tai lähdeluettelotiedostoja painikkeella **Liitä tiedosto**.
3. Ota **Käännä automaattisesti** käyttöön, jos haluat PDF:n päivittyvän kirjoitustaukojen aikana. Jos haluat päivityksen heti, valitse **Käännä**.
4. Voit säilyttää lähdeaineiston historiassa valitsemalla **Tallenna versio**. Valitse **Muokkaa tästä versiosta**, jos haluat jatkaa tallennetusta versiosta. Jos luonnos on jo olemassa, sovellus pyytää vahvistusta ennen korvaamista.

Lisää tiedostoja tai liitteitä kohdasta **Hallitse tiedostoja**. Kohdassa **Asetukset** voit valita käännösohjelman, automaattisen käännöksen ja näyttökielen tai tallentaa version. PDF-paneelin **⋯**-painike avaa suurennus- ja PNG-asetukset.

Jos käännös epäonnistuu, luonnos ja viimeisin onnistunut PDF säilyvät. Valitse tiedostonimen ja rivinumeron sisältävä virhe siirtyäksesi kyseiselle riville. Mobiililaitteella voit vaihtaa näkymien **Koodi**, **PDF** ja **Virheet** välillä. Jos PDF latautuu hitaasti, käytä näkymää **PNG (kevyt esikatselu)**.

Tilapäiset esikatselut näkyvät vain editorissa. Jos haluat säilyttää PDF:n, lataa se valitsemalla **Tallenna PDF**.

Editori käyttää UTF-8-koodausta. Avaa Shift_JIS- tai EUC-JP-tiedosto tekstieditorissa alkuperäisellä merkistökoodauksella, tarkista merkit ja tallenna kopio UTF-8-muodossa. Liitä kopio samalla nimellä ja vahvista korvaaminen.

## Kaavojen ja TikZ-kuvien tallennus SVG-muodossa {#数式や-tikz-を-svg-で取得する}

1. Avaa ennen muunnosta **Kohde ja tulostusasetukset** ja valitse **Vie myös kaavat ja TikZ SVG-muodossa**.
2. PDF-tiedoston voi ladata heti sen valmistuttua.
3. **Osittainen onnistuminen** tarkoittaa, että PDF valmistui, mutta SVG-kuvien erotus epäonnistui. Tallenna ensin PDF ja valitse tarvittaessa **Yritä vain SVG:tä uudelleen**.

Aluksi vain ensimmäisestä sivusta luodaan PNG-esikatselu. Muiden sivujen kuvat luodaan, kun avaat ne. Valmiin PDF:n voi ladata esikatselujen valmistelun aikana. Katso [PDF-, PNG- ja SVG-tiedostojen lataaminen](/fi/docs/outputs/).

## Aiempien asiakirjojen ja tulosten avaaminen {#以前の文書や結果を開く}

- **[Historia](/app/history/)** näyttää muunnosten etenemisen ja tulostiedostot. Voit palata samalle tulossivulle selaimen sulkemisen jälkeen.
- **[Projektit](/app/projects/)** näyttää tallennetut asiakirjat ja versiot. Kun haluat muuntaa aiemman lähdeaineiston uudelleen, avaa versio ja valitse **Muunna uudelleen**.
- **[Renderöintiympäristö](/app/environment/)** näyttää palvelimen LaTeX-paketit ja fontit, ja voit tehdä niistä hakuja.

## Julkiset ja yksityiset tiedot {#公開される情報}

- **Kirjautumista vaativat sivut.** Kirjaudu verkkosovellukseen (`/app/`) tarkastellaksesi asiakirjojasi ja muunnoksiasi historiassa tai tulossivuilla. Vain ylläpitäjät ja omistajat pääsevät hallinta-alueelle (`/admin/`). Katso [Tilien ja asiakirjojen tietoturva](/fi/docs/security/).
- **Julkiset sivut.** Jos et pysty kirjautumaan, tarkista [palvelun tila](/status/) tai katso [Vianmääritys](/fi/docs/troubleshooting/). Komentorivityökalu löytyy [lataussivulta](/downloads/) ja integrointimääritykset [julkisen rajapinnan ohjeesta](/fi/docs/api/).
