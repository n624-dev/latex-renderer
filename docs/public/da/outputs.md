---
slug: outputs
category: Web og CLI
title: Hent PDF, PNG og SVG
description: Gem PDF-filen, hent sidebilleder, og eksportér formler og TikZ-figurer til SVG eller gentag udtrækket.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Åbn og gem en PDF {#pdf-を開く-保存する}

- **Webapp.** Vælg dokumentet i [Historik](/app/history/), og åbn `result.pdf` i fillisten på resultatsiden. Hvis du har anmodet om PDF og SVG, kan du hente PDF-filen, så snart den er klar.
- **CLI.** Hent resultatet med det viste `<jobId>`. Tilføj `--pdf-only` for at hente PDF-filen uden at vente på SVG. Vælg en anden `--output`-mappe, hvis du vil bevare filerne fra et andet dokument.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Hent billeder af sider {#ページ画像を取得する}

Brug PNG-forhåndsvisninger, når du har brug for billeder af hele sider. I første omgang oprettes kun side 1. De øvrige oprettes på anmodning. Hvis en side er under klargøring, kan du vente lidt eller åbne siden igen. Du kan hente den færdige PDF i mellemtiden.

- **Webapp.** Vælg forhåndsvisningen af den ønskede side på resultatsiden.
- **CLI.** Følgende kommando henter PNG-filer for side 2 og 5. De gemmes med navne som `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Gem formler og TikZ som SVG {#数式と-tikz-を-svg-で保存する}

Du kan udtrække de yderste matematiske udtryk og TikZ-figurer på øverste niveau som selvstændige vektorbilleder.

- **Webapp.** Åbn **Destination og outputindstillinger** før konvertering, og vælg **Eksportér også formler og TikZ som SVG**. Hent SVG-filerne fra resultatsiden, når udtrækket er færdigt.
- **CLI.** Konvertér med `--svg`. SVG-filerne gemmes i `.render/svg/objects/`. De tilhørende linjer i den oprindelige `.tex`-fil og koordinaterne i PDF-filen findes i `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Når PDF-filen er klar, men SVG-udtrækket mislykkes {#pdf-はあるが-svg-が失敗した場合}

**Delvis gennemført** betyder, at PDF-filen er færdig, og at kun SVG-udtrækket mislykkedes. Gem PDF-filen, og prøv udtrækket igen uden at genkompilere dokumentet.

- **Webapp.** Klik på **Prøv kun SVG igen** på resultatsiden.
- **CLI.** Kør følgende kommando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Betingelser og antal forsøg**
- Du har **højst 8 forsøg** inklusive det første, så længe det oprindelige input og den færdige PDF er tilgængelige, og serverens TeX-miljø ikke er ændret. Nye forsøg forlænger ikke filernes opbevaringstid.
- Hvis problemet fortsætter, se diagnostikken på resultatsiden eller i `.render/svg/errors.json`.
- Hvis `SVG_RUNTIME_CHANGED` vises, eller knappen til nyt forsøg mangler ved et ældre job, skal du [starte en ny konvertering fra det oprindelige dokument eller en gemt revision](/da/docs/web/#以前の文書や結果を開く).

Se også [Hent og prøv igen via HTTP-API'et](/da/docs/api/#pdfの先行公開とsvgの再試行) og [specifikationen for behandling af output](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
