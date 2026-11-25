---
slug: outputs
category: Web en CLI
title: PDF, PNG en SVG downloaden
description: Sla de PDF op, download afbeeldingen van pagina's en exporteer formules en TikZ-tekeningen als SVG of herhaal de extractie.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Een PDF openen en opslaan {#pdf-を開く-保存する}

- **Webapp.** Selecteer het document in [Geschiedenis](/app/history/) en open `result.pdf` in de bestandenlijst op de resultatenpagina. Heb je PDF en SVG aangevraagd, dan kun je de PDF downloaden zodra deze klaar is.
- **CLI.** Download het resultaat met de weergegeven `<jobId>`. Voeg `--pdf-only` toe om de PDF te downloaden zonder op de SVG's te wachten. Wil je de bestanden van een ander document behouden, kies dan een andere map voor `--output`.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Afbeeldingen van pagina's downloaden {#ページ画像を取得する}

Gebruik PNG-voorbeelden wanneer je afbeeldingen van hele pagina's nodig hebt. In eerste instantie wordt alleen pagina 1 gemaakt. Andere pagina's worden op aanvraag gemaakt. Wordt een voorbeeld nog voorbereid, wacht dan even of open de pagina opnieuw. Intussen kun je de voltooide PDF downloaden.

- **Webapp.** Selecteer op de resultatenpagina het voorbeeld van de gewenste pagina.
- **CLI.** De volgende opdracht downloadt PNG's voor pagina 2 en 5. Ze worden opgeslagen onder namen zoals `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Formules en TikZ opslaan als SVG {#数式と-tikz-を-svg-で保存する}

Je kunt de buitenste wiskundige uitdrukkingen en TikZ-tekeningen op het hoogste niveau als afzonderlijke vectorafbeeldingen extraheren.

- **Webapp.** Open vóór de conversie **Bestemming en uitvoeropties** en selecteer **Formules en TikZ ook als SVG exporteren**. Na de extractie download je de SVG-bestanden op de resultatenpagina.
- **CLI.** Converteer met `--svg`. De SVG's worden opgeslagen in `.render/svg/objects/`. De regels in de oorspronkelijke `.tex` en de bijbehorende PDF-coördinaten staan in `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Als de PDF klaar is maar de SVG-extractie mislukt {#pdf-はあるが-svg-が失敗した場合}

**Gedeeltelijk geslaagd** betekent dat de PDF klaar is en alleen de SVG-extractie is mislukt. Sla de PDF op en probeer de extractie opnieuw zonder de PDF opnieuw te compileren.

- **Webapp.** Klik op de resultatenpagina op **Alleen SVG opnieuw proberen**.
- **CLI.** Voer de volgende opdracht uit.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Voorwaarden en maximumaantal pogingen**
- Je kunt **maximaal 8 pogingen** doen, inclusief de eerste, zolang de oorspronkelijke invoer en definitieve PDF beschikbaar zijn en de TeX-omgeving op de server niet is gewijzigd. Nieuwe pogingen verlengen de bewaartermijn van de bestanden niet.
- Blijft het probleem bestaan, raadpleeg dan de diagnostische informatie op de resultatenpagina of in `.render/svg/errors.json`.
- Verschijnt `SVG_RUNTIME_CHANGED` of ontbreekt de knop bij een oudere taak, [start dan een nieuwe conversie met het oorspronkelijke document of een opgeslagen revisie](/nl/docs/web/#以前の文書や結果を開く).

Zie ook [Downloaden en opnieuw proberen via de HTTP-API](/nl/docs/api/#pdfの先行公開とsvgの再試行) en de [specificatie voor het verwerken van uitvoer](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
