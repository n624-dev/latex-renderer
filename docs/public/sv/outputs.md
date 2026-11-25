---
slug: outputs
category: Webb och CLI
title: Hämta PDF, PNG och SVG
description: Spara PDF-filen, hämta sidbilder och exportera formler och TikZ-bilder som SVG eller gör om extraktionen.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Öppna och spara en PDF {#pdf-を開く-保存する}

- **Webbapp.** Välj dokumentet i [Historik](/app/history/) och öppna `result.pdf` i fillistan på resultatsidan. Om du har begärt både PDF och SVG kan du hämta PDF-filen så snart den är klar.
- **CLI.** Hämta resultatet med det `<jobId>` som visas. Lägg till `--pdf-only` för att hämta PDF-filen utan att invänta SVG. Välj en annan `--output`-mapp om du vill behålla filer från ett annat dokument.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Hämta bilder av sidor {#ページ画像を取得する}

Använd PNG-förhandsvisningarna om du behöver bilder av hela sidor. Först skapas bara sidan 1. Övriga sidor skapas på begäran. Om en sida förbereds, vänta en stund eller öppna sidan igen. Den färdiga PDF-filen går att hämta under tiden.

- **Webbapp.** Välj förhandsvisningen av önskad sida på resultatsidan.
- **CLI.** Följande kommando hämtar PNG-filer för sidorna 2 och 5. De får namn som `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Spara formler och TikZ som SVG {#数式と-tikz-を-svg-で保存する}

Du kan extrahera de yttersta matematiska uttrycken och TikZ-bilder på översta nivån som separata vektorbilder.

- **Webbapp.** Öppna **Mål och utdataalternativ** före konverteringen och välj **Exportera även formler och TikZ som SVG**. Hämta SVG-filerna på resultatsidan när extraktionen är klar.
- **CLI.** Konvertera med `--svg`. SVG-filerna sparas i `.render/svg/objects/`. Motsvarande rader i den ursprungliga `.tex`-filen och koordinater i PDF-filen finns i `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Om PDF-filen är klar men SVG-extraktionen misslyckas {#pdf-はあるが-svg-が失敗した場合}

**Delvis slutförd** betyder att PDF-filen är klar och att bara SVG-extraktionen misslyckades. Spara PDF-filen och försök extrahera SVG igen utan att kompilera om dokumentet.

- **Webbapp.** Klicka på **Försök igen med endast SVG** på resultatsidan.
- **CLI.** Kör följande kommando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Villkor och antal försök**
- Du kan göra **högst 8 försök** inklusive det första, så länge det ursprungliga underlaget och den färdiga PDF-filen finns kvar och serverns TeX-miljö är oförändrad. Nya försök förlänger inte filernas lagringstid.
- Kvarstår felet, läs diagnostiken på resultatsidan eller i `.render/svg/errors.json`.
- Om `SVG_RUNTIME_CHANGED` visas eller knappen för nytt försök saknas för ett äldre jobb, [starta en ny konvertering från originaldokumentet eller en sparad revision](/sv/docs/web/#以前の文書や結果を開く).

Se även [Hämta och försök igen via HTTP-API:t](/sv/docs/api/#pdfの先行公開とsvgの再試行) och [specifikationen för utdatahantering](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
