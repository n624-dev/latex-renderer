---
slug: outputs
category: Verkkosovellus ja CLI
title: PDF-, PNG- ja SVG-tiedostojen lataaminen
description: Tallenna PDF, lataa sivuja kuvina ja vie kaavat ja TikZ-kuvat SVG-muodossa tai yritä niiden erotusta uudelleen.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## PDF:n avaaminen ja tallentaminen {#pdf-を開く-保存する}

- **Verkkosovellus.** Valitse asiakirja [Historiasta](/app/history/) ja avaa tulossivun tiedostoluettelosta `result.pdf`. Jos pyysit PDF- ja SVG-tiedostoja, PDF:n voi ladata heti sen valmistuttua.
- **CLI.** Lataa tulos näkyvällä tunnisteella `<jobId>`. Lisää `--pdf-only` ladataksesi PDF:n odottamatta SVG-tiedostoja. Jos haluat säilyttää toisen asiakirjan tiedostot, valitse eri `--output`-kansio.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Sivujen lataaminen kuvina {#ページ画像を取得する}

Käytä PNG-esikatseluja, kun tarvitset kokonaisista sivuista kuvia. Aluksi luodaan vain sivu 1. Muut sivut luodaan pyynnöstä. Jos esikatselua valmistellaan, odota hetki tai avaa sama sivu uudelleen. Voit samalla ladata valmiin PDF:n.

- **Verkkosovellus.** Valitse tulossivulta haluamasi sivun esikatselu.
- **CLI.** Seuraava komento lataa sivut 2 ja 5 PNG-tiedostoina. Tiedostot saavat nimet kuten `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Kaavojen ja TikZ-kuvien tallennus SVG-muodossa {#数式と-tikz-を-svg-で保存する}

Uloimmat matemaattiset lausekkeet ja ylimmän tason TikZ-kuvat voidaan erottaa omiksi vektorikuvikseen.

- **Verkkosovellus.** Avaa ennen muunnosta **Kohde ja tulostusasetukset** ja valitse **Vie myös kaavat ja TikZ SVG-muodossa**. Lataa SVG-tiedostot tulossivulta erotuksen valmistuttua.
- **CLI.** Muunna valitsimella `--svg`. SVG-tiedostot tallennetaan kansioon `.render/svg/objects/`. Alkuperäisen `.tex`-tiedoston rivit ja vastaavat PDF-koordinaatit löytyvät tiedostosta `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## PDF valmistui, mutta SVG-kuvien erotus epäonnistui {#pdf-はあるが-svg-が失敗した場合}

**Osittainen onnistuminen** tarkoittaa, että PDF on valmis ja vain SVG-kuvien erotus epäonnistui. Tallenna PDF ja yritä erotusta uudelleen kääntämättä asiakirjaa uudelleen.

- **Verkkosovellus.** Valitse tulossivulla **Yritä vain SVG:tä uudelleen**.
- **CLI.** Suorita seuraava komento.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Ehdot ja yritysten määrä**
- Yrityksiä saa olla **enintään 8**, ensimmäinen mukaan lukien, jos alkuperäinen lähdeaineisto ja valmis PDF ovat saatavilla eikä palvelimen TeX-ympäristö ole muuttunut. Uusi yritys ei pidennä tiedostojen säilytysaikaa.
- Jos ongelma jatkuu, lue diagnostiikka tulossivulta tai tiedostosta `.render/svg/errors.json`.
- Jos näet koodin `SVG_RUNTIME_CHANGED` tai aiemman työn uusintapainike ei ole käytettävissä, [aloita uusi muunnos alkuperäisestä asiakirjasta tai tallennetusta versiosta](/fi/docs/web/#以前の文書や結果を開く).

Katso myös [Lataaminen ja uusintayritys HTTP-rajapinnalla](/fi/docs/api/#pdfの先行公開とsvgの再試行) ja [tulostiedostojen käsittelymääritys](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
