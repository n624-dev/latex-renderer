---
slug: outputs
category: Nettapp og CLI
title: Hent PDF, PNG og SVG
description: Lagre PDF-filen, last ned sidebilder og eksporter formler og TikZ-figurer som SVG eller gjenta uthentingen.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Åpne og lagre en PDF {#pdf-を開く-保存する}

- **Nettapp.** Velg dokumentet i [Historikk](/app/history/) og åpne `result.pdf` i fillisten på resultatsiden. Hvis du ba om PDF og SVG, kan du laste ned PDF-filen så snart den er klar.
- **CLI.** Last ned resultatet med den viste `<jobId>`. Legg til `--pdf-only` for å hente PDF-filen uten å vente på SVG. Velg en annen mappe for `--output` hvis du vil beholde filene fra et annet dokument.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Hent bilder av sider {#ページ画像を取得する}

Bruk PNG-forhåndsvisninger når du trenger bilder av hele sider. Først opprettes bare side 1. Andre sider opprettes på forespørsel. Hvis en side klargjøres, vent litt eller åpne siden på nytt. Du kan laste ned den ferdige PDF-filen i mellomtiden.

- **Nettapp.** Velg forhåndsvisningen av den ønskede siden på resultatsiden.
- **CLI.** Følgende kommando laster ned PNG for side 2 og 5. Filene får navn som `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Lagre formler og TikZ som SVG {#数式と-tikz-を-svg-で保存する}

Du kan hente ut de ytterste matematiske uttrykkene og TikZ-figurene på øverste nivå som separate vektorbilder.

- **Nettapp.** Åpne **Mål og utdatavalg** før konvertering og velg **Eksporter også formler og TikZ som SVG**. Last ned SVG-filene fra resultatsiden når uthentingen er ferdig.
- **CLI.** Konverter med `--svg`. SVG-filene lagres i `.render/svg/objects/`. I tillegg finner du linjene fra den opprinnelige `.tex`-filen og tilsvarende PDF-koordinater i `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Når PDF-filen er klar, men uthentingen av SVG mislykkes {#pdf-はあるが-svg-が失敗した場合}

**Delvis vellykket** betyr at PDF-filen er ferdig, og at bare SVG-uthentingen mislyktes. Lagre PDF-filen og prøv uthentingen på nytt uten å kompilere dokumentet en gang til.

- **Nettapp.** Klikk på **Prøv bare SVG på nytt** på resultatsiden.
- **CLI.** Kjør følgende kommando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Vilkår og antall forsøk**
- Du kan gjøre **høyst 8 forsøk** medregnet det første så lenge opprinnelige inndata og den ferdige PDF-filen finnes, og TeX-miljøet på serveren er uendret. Nye forsøk forlenger ikke lagringstiden.
- Hvis problemet vedvarer, se diagnostikken på resultatsiden eller i `.render/svg/errors.json`.
- Hvis `SVG_RUNTIME_CHANGED` vises eller knappen for nytt forsøk mangler for en eldre jobb, [start en ny konvertering fra originaldokumentet eller en lagret revisjon](/no/docs/web/#以前の文書や結果を開く).

Se også [Last ned og prøv på nytt via HTTP-API-et](/no/docs/api/#pdfの先行公開とsvgの再試行) og [spesifikasjonen for behandling av utdata](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
