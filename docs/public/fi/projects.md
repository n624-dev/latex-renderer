---
slug: projects
category: Projektit
title: TeX- ja ZIP-tiedostojen valmisteleminen
description: Valmistele lähdeaineisto, tarkista rajoitukset ja kokeile pientä LuaLaTeX-projektia.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Projektin rakenne {#構成}

- **Yhden tiedoston asiakirja.** Lähetä `.tex` suoraan verkkosovelluksessa tai aja komentorivillä `n624-latex main.tex`.
- **Kuvia, lähdeluettelon tai useita lähdetiedostoja sisältävä asiakirja.** Kokoa tiedostot **yhteen ZIP-tiedostoon** ja säilytä suhteelliset polut. Komentorivillä voit antaa myös kansion.
- **ZIP-tiedoston luominen.** Valitse pakattavaksi kansion sisältö, esimerkiksi `main.tex` ja `images/`. Jos pakkaat myös niiden yläkansion, anna muunnoksessa aloitustiedoston poluksi esimerkiksi `project/main.tex`.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Aloitustiedosto ja suhteelliset polut**
Oletusarvoinen pääasiakirja on projektin juuressa oleva `main.tex`. Vaikka valitsisit alikansion `.tex`-tiedoston, esimerkiksi `docs/main.tex`, **käännöksen työhakemisto on aina projektin juuri**. Jos haluat sisällyttää tiedostosta `docs/main.tex` samassa kansiossa sijaitsevan tiedoston `body.tex`, kirjoita `\input{docs/body.tex}`. Jos kirjoitat `\input{body.tex}`, kääntäjä etsii tiedostoa `body.tex` projektin juuresta.

## Pieni japaninkielinen esimerkki {#日本語の最小例}

Oletusmoottori on **LuaLaTeX**. Kokeile japaninkielistä asiakirjaa tallentamalla seuraava sisältö UTF-8-koodauksella tiedostoon `main.tex`.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Hae saatavilla olevia paketteja ja fontteja [käännösympäristöstä](/app/environment/). Luettelo muodostetaan palvelimen säilöstä käyttöönoton yhteydessä. Myös etä-MCP käyttää sitä hauissa. Jos paketti puuttuu, lähetä ylläpitäjälle asiaa koskeva ilmoitus tiedostosta `compile.log`.

## Tallennetut projektit ja versiot {#保存projectと改訂}

Verkkosovelluksessa (`/app/`) muunnetut asiakirjat tallennetaan projekteihin.

- **Versioiden automaattinen tallennus.** Jokainen uusi sisällön, pääasiakirjan, moottorin ja tulostusmuotojen yhdistelmä tallentuu projektin versioksi. Aiemmat versiot säilyvät historiassa.
- **Aiemman version muuntaminen.** Valitse **Muunna uudelleen**, niin käännös käyttää tallennettua asiakirjaa ja moottoria. Jos vaihdat tässä tulostusmuotoa, tulos lisätään saman version muunnoshistoriaan.
- **Jakaminen ja poistaminen.** Verkkosovellus, komentorivityökalu, HTTP API ja MCP käyttävät samoja käyttäjäkohtaisia projekteja ja versioita. Projektin poistaminen piilottaa sen tietueen. Aiemmat syötteet ja tulokset siivotaan säilytysaikojen mukaisesti. Jos tarvitset heti täydellisen poiston, ota yhteys ylläpitäjään. Aktiivisten versioiden käyttämät syötteet lasketaan käyttäjän tallennuskiintiöön. Katso [jakaminen ja säilytys](/fi/docs/reference/#保存プロジェクトの共有-保持).

### Muokkaaminen selaimessa {#ブラウザーで編集する}

Avaa tallennettu projekti ja valitse **Muokkaa TeXiä**. Muutokset tallentuvat luonnokseen. Käännös alkaa kirjoitustauon jälkeen, ja onnistunut käännös päivittää PDF:n. Jos esikatselu epäonnistuu, voit katsoa viimeistä käytettävissä olevaa PDF:ää sekä sen luonnosversiota.

Uusi projekti avautuu tyhjään `main.tex`-tiedostoon. Kun pääasiakirja on vielä tyhjä, voit aloittaa mallipohjasta. Jatka tallennetusta versiosta valitsemalla **Muokkaa tästä versiosta**. Jos luonnos on jo olemassa, vahvista sen korvaaminen.

Jos haluat kääntää vain tarvittaessa, poista **Käännä automaattisesti** käytöstä ja valitse **Käännä**. Valitse **Tallennetun version tulosteet** ja tallenna luonnos asetuksineen valitsemalla **Tallenna versio**. Jos tarvitset SVG-tiedostoja, avaa tallennettu versio ja valitse **Muunna uudelleen**.
Editori näyttää käännöksen tilan ja esikatselun muokkauksen aikana.

## Lähetyksestä pois jätettävät tiedostot {#送信から除外されるもの}

- **Automaattisesti pois jätettävät tiedostot.** Komentorivityökalu ohittaa `.git`- ja `.render`-kohteet sekä LaTeX-aputiedostot, kuten `.aux`. Se hylkää symboliset linkit.
- **Tiedostot, joita ei tueta.** Siirrä tarpeettomat kansiot, kuten `node_modules`, projektin ulkopuolelle. Jos lähetät kansion, joka sisältää muita kuin sallittuja tiedostopäätteitä, työkalu näyttää polun ja pysähtyy. Jos haluat säilyttää projektissa esimerkiksi tiedoston `README.md` mutta jättää sen lähettämättä, lisää projektin juuressa olevaan tiedostoon `.latexrenderignore` rivi `README.md`. Palvelin tarkistaa samat tiedostopäätesäännöt ZIP-tiedostosta.
- **Tuetut tiedostopäätteet** (kirjainkoolla ei ole merkitystä)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst`-tiedostot ovat BibTeXin lähdeluettelotyylejä. Ne voivat sijaita myös alikansioissa. Jos oman tyylisi tiedostopääte puuttuu luettelosta, kysy ylläpitäjältä ennen sen vaihtamista.

## Rajoitukset {#制限}

- **Tiedostomäärä.** Enintään 500.
- **Oletuskoot.** ZIP-tiedosto 20 MiB, purettu sisältö yhteensä 100 MiB ja yksittäinen tiedosto 20 MiB.
- **Aloitustiedosto.** Syötteen sisäinen suhteellinen polku `.tex`-tiedostoon. Oletuksena käytetään juuressa olevaa tiedostoa `main.tex`.
- **Suojaus.** TeXin komentotulkkiyhteys (myös `\write18`), ulkoisten komentojen suorittaminen ja ulkoiset verkkoyhteydet on poistettu käytöstä.
- **Resurssit.** Ylläpitäjä määrittää aikarajat, käyttäjän tallennustilan ja tulosten säilytysajan.
