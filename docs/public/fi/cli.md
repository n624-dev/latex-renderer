---
slug: cli
category: Komentorivityökalu
title: Asiakirjojen muuntaminen ja tulosten lataaminen komentoriviltä
description: Käännä TeX-tiedostoja päätteessä ja lataa PDF:t, lokit ja esikatselukuvat.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Aja tiedoston `main.tex` sisältävässä kansiossa `n624-latex main.tex`, niin PDF tallentuu samaan kansioon. [Asenna komentorivityökalu](/fi/docs/client/) ja määritä yhteys ennen ensimmäistä käyttökertaa.

## Tunnistautuminen {#認証}

Avaa asetukset selaimessa ja tallenna API-avain.

```sh
n624-latex setup --gui
```

Jos et voi avata selainta esimerkiksi SSH-istunnossa, anna avain **vakiosyötteestä**, jotta se ei näy komennon argumenteissa. Aja Bashissa tai Zsh:ssa ensimmäinen rivi, liitä avain, paina Enter ja aja sitten seuraavat rivit.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Windowsissa voit käyttää myös [asennusohjelman peitettyä syöttökenttää](/fi/docs/windows/#インストール).

Ensimmäinen komento tarkistaa, onko avain tallennettu. Toinen poistaa sen.

```sh
n624-latex auth status
n624-latex auth logout
```

- Jos ympäristömuuttuja `LATEX_RENDER_API_KEY` on asetettu, sen arvo ohittaa paikallisesti tallennetun avaimen.
- `logout` poistaa vain paikallisesti tallennetun avaimen. Poista tarvittaessa ympäristömuuttuja käytöstä tai mitätöi avain palvelimella erikseen.

### Palvelimen valitseminen {#接続先サーバー}

Komentorivityökalu ottaa oletuksena yhteyden ylläpidettyyn palveluun (`https://latex-render.n624.jp`). Jos käytät omaa palvelinta, aseta sen HTTPS-osoite siinä pääteistunnossa, jossa ajat komennot.

- Jätä osoitteen lopusta pois `/app/` ja `/api/v1/`.
- Käytä kyseisen palvelimen myöntämää API-avainta.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Asetukset ja diagnostiikka {#セットアップと診断}

Avaa yhteyden ja integraatioiden asetukset komennolla `n624-latex setup`. Jos yhteys epäonnistuu, tarkista ensin tila seuraavilla komennoilla. Jos `n624-latex` ei löydy, katso [asennus ja PATH](/fi/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` tarkistaa asennuksen ja tunnistetiedot tekemättä muutoksia. Se ei näytä API-avaimen arvoa. Jos ongelmia löytyy, paluuarvo on `2`.

| Asennustapa | Päivitys ja korjaus |
| --- | --- |
| APT | [Päivitä APT:llä](/fi/docs/client/#apt-版の更新) tai [asenna uudelleen](/fi/docs/client/#状態確認と修復) vaurioituneet paketit. [Rekisteröi paikallinen MCP käsin](/fi/docs/mcp/#local-mcpの登録). |
| Homebrew | [Päivitä Homebrew’lla](/fi/docs/client/#homebrew-版の更新) tai [asenna uudelleen](/fi/docs/client/#状態確認と修復) vaurioituneet paketit. Määritä tekoälyintegraatiot komennolla `n624-latex setup`. |
| Ladattava asennusohjelma | [Päivitä asetuksista](/fi/docs/client/#配布インストーラー版の更新). Korjaa hallitut integraatiot ja käynnistimet komennolla `n624-latex setup repair`. |

Poista asennus [asennustavan mukaisella ohjeella](/fi/docs/client/#アンインストール). Asetuskäyttöliittymä toimii paikallisesti ja sulkeutuu, kun komentorivityökalu päättyy.

## Muuntaminen {#レンダリング}

### TeX-tiedoston muuntaminen suoraan {#tex-ファイルを直接変換する}

Anna projektikansion `.tex`-tiedosto PDF:n luomista varten. Voit viitata kuviin, lähdeluetteloihin ja paikallisiin `.sty`-tiedostoihin suhteellisilla poluilla.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Jos jätät valitsimen `-o` pois, PDF tallennetaan komennon suorituskansioon samalla kantanimellä, esimerkiksi `main.pdf`.
- Jos LaTeX-käännös epäonnistuu, näet tunnistetun tiedoston, rivin ja työn tunnuksen siltä osin kuin ne ovat saatavilla. Viimeisin onnistuneesti tallennettu PDF säilyy, jos käännös tai lataus epäonnistuu.

#### LaTeX-moottorin valitseminen {#latex-のエンジンを選ぶ}

Jos haluat käyttää XeLaTeXiä, kirjoita moottorin nimi ennen tiedostoa.

```sh
n624-latex xelatex main.tex
```

Jos et määritä moottoria, komentorivityökalu etsii asiakirjan alusta direktiiviä `% !TeX program = xelatex` tai
`% !TEX TS-program = xelatex`. Jos kumpaakaan ei ole, se lukee tiedoston
`.n624-latex.json` projektin juuresta. Voit jakaa tiedoston
Gitissä, jotta muutkin koneet käyttävät samaa moottoria.

```json
{"engine":"xelatex"}
```

Jos moottoria ei ole määritetty missään, käytetään LuaLaTeXiä. pLaTeX ja upLaTeX edellyttävät,
että palvelimen suoritusympäristö sisältää japanin kielen kokoelman.

| Moottori | Tarkista asiakirjaa siirrettäessä |
| --- | --- |
| LuaLaTeX | Tarkista asetukset, jos asiakirja käyttää pakettia `fontspec` tai LuaTeX-ja:ta. |
| pdfLaTeX | Ei tue pakettia `fontspec`. Käytä pdfLaTeXille tarkoitettuja fonttiasetuksia. |
| XeLaTeX | Tukee pakettia `fontspec`. Tarkista, onko asiakirjassa vain LuaTeXissä toimivia paketteja. |
| pLaTeX / upLaTeX | Käytä moottorin kanssa yhteensopivaa japaninkielistä asiakirjaluokkaa. Jos käytät upLaTeXissä luokkaa `jsarticle`, anna luokkavalitsin `uplatex`. |

Lähdeluettelon käsittely riippuu asiakirjan paketeista ja asetuksista. Sisällytä `.bib`-tiedostot ja omat `.bst`-tiedostot. BibTeX-asiakirjat käyttävät pLaTeXissä pBibTeXiä ja upLaTeXissä upBibTeXiä. Katso [käännösympäristöstä](/app/environment/) PDF:n, SVG:n ja SVG-sijaintien tarkistukset.

### ZIP-tiedoston muuntaminen tai usean tulosteen pyytäminen {#zip-複数の出力を指定する}

Käytä alikomentoa `render` ZIP-tiedoston muuntamiseen tai kaikkien tulosten, myös lokien, esikatselujen ja SVG-tiedostojen, lataamiseen.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Esimerkkejä**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Oletuspolku on nykyinen kansio, ja asetuksen `--entrypoint` oletusarvo on `main.tex`. Komentorivityökalu valmistelee enintään 500 tiedoston syötteen ja odottaa työn päättymistä. Aloitustiedosto voi olla suhteellinen polku `.tex`-tiedostoon. Palvelin tarkistaa polun turvallisuuden ja tiedoston olemassaolon.
- Valitsin `--svg` tallentaa myös uloimmat matemaattiset lausekkeet ja ylätason TikZ-kaaviot erillisiksi SVG-tiedostoiksi.

### Saman syötteen käyttäminen usealle asiakirjalle {#同じ入力から複数の文書を作る-source-の再利用}

Jos kansiossa tai ZIP-tiedostossa on useita pääasiakirjoja, lähetä aineisto vain kerran komennolla `source upload` ja käytä sen tunnusta uudelleen. Käytä jokaiselle työlle eri tuloskansiota (`--output`).

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Kohteen siivous, pois jätettävät tiedostot ja päällekkäiset lähetykset
>
> - **Aiemmat tulokset.** Jos käytät samaa tallennuskohdetta uudelleen, työkalu poistaa vain aiemmassa `job.json`-tiedostossa luetellut PDF:t, esikatselut ja SVG:t, jotka puuttuvat uudesta tuloksesta. Työhön kuulumattomat käyttäjän tiedostot säilyvät.
> - **Kohteen tarkistus.** Symbolisia linkkejä sisältäviä polkuja ei sallita. POSIX-järjestelmissä tarkistetaan myös omistaja sekä ryhmän ja muiden käyttäjien kirjoitusoikeudet. Windowsissa POSIX-oikeusbittejä ei tarkisteta.
> - **Tuloskansion jättäminen pois.** Jos `--output` osoittaa projektin alikansioon, juuri tämä kansio jätetään pois seuraavasta ZIP-tiedostosta. Samankaltaisesti nimetyt kansiot otetaan mukaan. Projektin juurta ei voi käyttää tuloskansiona.
> - **Päällekkäiset lähetykset.** Jos palvelimella on saman omistajan kelvollinen ZIP samalla SHA-256-tiivisteellä, se palauttaa arvon `uploadRequired: false` ja ohittaa siirron. Vain sama omistaja voi käyttää syötteen tunnusta myöhemmissä töissä.

## Tallennetut projektit ja versiot {#保存projectと改訂}

Hallitse ja käännä palvelimelle tallennettuja projekteja ja versioita komentorivillä. Verkko, API, MCP ja saman käyttäjän muut avaimet käyttävät samoja projekteja. Tilapäiset toimet `render` ja `source upload` eivät vaadi projektin tallentamista.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** valmistelee kansion tai ZIP-tiedoston syötteeksi ja tallentaa projektiin muuttumattoman version. Valitsimella `--svg` version alkuperäiset tulostusmuodot ovat PDF ja SVG.
- **`render`** luo työn tallennetusta versiosta. Vain `--svg` ohittaa tallennetut tulostusasetukset.
- **`list`, `get` ja `jobs`** hyväksyvät valitsimen `--cursor` seuraavan sivun hakemiseen.
- **`delete`** piilottaa projektin luettelosta. Olemassa olevia töitä ei poisteta heti.

## Töiden käsitteleminen {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Lataaminen ja odottaminen.** Nämä komennot uusivat lyhytikäisen tunnisteen API-avaimella. `jobs download` odottaa työn päättymistä ennen tallennettujen tulosten korvaamista. Jos odotus epäonnistuu tai keskeytyy, aiempi tulosjoukko säilyy. `delete` koskee vain päättyneitä töitä.
- **Lisää PNG-esikatseluja.** Aluksi luodaan vain ensimmäinen sivu. Tavallinen lataus noutaa valmiit PNG:t. Esimerkiksi `--preview-page 2 5` luo pyydetyt sivut, tarkistaa niiden koon ja SHA-256-tiivisteen ja tallentaa ne. Tämä ei käännä PDF:ää uudelleen eikä pidennä säilytysaikaa.
- **PDF ensin ja SVG:n uudelleenyritys.** Kun työ tuottaa PDF:n ja SVG:t, saat PDF:n odottamatta SVG-tiedostoja komennolla `--pdf-only`. Jos vain SVG-vaihe epäonnistuu, PDF säilyy ja tulos on osittainen. `retry-svg` yrittää vain SVG-tiedostojen muodostusta uudelleen. Yrityksiä sallitaan ensimmäinen mukaan lukien kahdeksan, eivätkä ne pidennä säilytysaikaa. Jos suoritusympäristö on muuttunut, luo uusi työ. Katso [PDF:n noutaminen ja SVG:n uudelleenyritys](/fi/docs/api/#pdfの先行公開とsvgの再試行).
- **Verkkovirheiden uudelleenyritykset.** Tilapäisen tilakyselyvirheen jälkeen työkalu yrittää uudelleen. Tunnistautumis- ja käyttöoikeusvirheet palautetaan heti. Jos työkalu lakkaa odottamasta, palvelin voi jatkaa työtä. Tarkista sama `<jobId>` ennen kuin luot uuden työn. Katso [komentorivityökalun odotus ja uudelleenyritykset](/fi/docs/reference/#cliの待機と再試行).

## Tulostiedostot {#成果物}

Jos haluat ladata PDF:n ensin, valita PNG-sivuja tai yrittää SVG-vaihetta uudelleen, katso [PDF-, PNG- ja SVG-tiedostojen noutaminen](/fi/docs/outputs/).

| Polku | Sisältö |
| --- | --- |
| `.render/result.pdf` | Onnistuneesti luotu PDF |
| `.render/compile.log` | LaTeX-käännöksen loki |
| `.render/errors.json` | Virheiden rakenteiset tiedot |
| `.render/job.json` | Työn lopullinen tila |
| `.render/previews/page-N.png` | Enintään 100 sivun esikatselut |
| `.render/svg/manifest.json` | SVG-tiedostojen, lähdekohtien ja PDF-koordinaattien vastaavuudet |
| `.render/svg/objects/*.svg` | Erillinen SVG kustakin matemaattisesta lausekkeesta tai TikZ-kaaviosta |

## JSON-tuloste {#json出力}

Lisää komentoon `--json`, jos haluat vakiotulosteeseen yhden JSON-objektin ilman edistymisviestejä. Objekti käyttää samaa `client-core`-tulosta kuin tavallinen näyttö eikä sisällä API-avaimia tai lyhytikäisiä tunnisteita.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Katso onnistumisten ja virheiden skeemat sekä paluuarvot kohdasta [komentorivityökalun JSON-muoto](/fi/docs/reference/#cliのjson形式).
