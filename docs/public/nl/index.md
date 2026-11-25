---
slug: index
category: Aan de slag
title: Handleiding voor LaTeX Renderer
description: Zet LaTeX-documenten om naar PDF in de browser, vanuit de terminal of met een AI-assistent.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Maak je eerste PDF {#最短でpdfを作る}

1. Open de [webapp](/app/) en meld je aan op de manier die de beheerder heeft aangegeven.
2. Selecteer het bestand `.tex` en klik op **Omzetten naar PDF**. Gebruikt het document afbeeldingen of een bibliografie, verpak dan het document en de bijbehorende bestanden in een ZIP-archief en selecteer dat archief.
3. Open de PDF op de resultatenpagina. Je vindt het resultaat later terug onder **Geschiedenis** in de webapp.

Heb je geen testdocument, sla dan dit voorbeeld op als `main.tex` met UTF-8-codering.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Voorbeeld met Japanse tekst en indeling van het ZIP-archief](/nl/docs/projects/)
- [Handleiding voor de webapp](/nl/docs/web/)
- [PDF en PNG opslaan en de SVG-extractie opnieuw uitvoeren](/nl/docs/outputs/)

Werk je liever in een terminal, [installeer dan de CLI voor je besturingssysteem](/nl/docs/client/). Stel de verbinding in met `n624-latex setup`. Voer in de map met `main.tex` het commando `n624-latex main.tex` uit om `main.pdf` te maken.

## Kies hoe je wilt werken {#利用方法を選ぶ}

| Wat wil je doen? | Hulpmiddel | Handleiding |
| --- | --- | --- |
| **Documenten omzetten in de browser** | Webapp | [Omzetten in de browser](/nl/docs/web/) |
| **Documenten omzetten vanuit de terminal en de resultaten lokaal opslaan** | CLI voor Windows, macOS of Linux | [De CLI installeren](/nl/docs/client/) |
| **Documenten omzetten vanuit ChatGPT of Claude** | Remote MCP met OAuth | [ChatGPT of Claude verbinden](/nl/docs/mcp/) |
| **Lokale documenten verwerken met Codex of Claude Code** | CLI, Local MCP en skill | [Codex of Claude Code gebruiken](/nl/docs/integrations/) |
| **Conversies in je eigen toepassing automatiseren** | HTTP-API | [Openbare API](/nl/docs/api/) |
| **De dienst op je eigen Linux-server draaien** | Eigen server | [Een eigen server beheren](/nl/docs/self-hosting/) |

## Wat heb je nodig? {#必要なもの}

- **Webapp en Remote MCP.** Je hebt een account nodig waarmee je volgens de aanwijzingen van de serverbeheerder kunt inloggen.
- **CLI, Local MCP en HTTP-API.** Vraag de beheerder om een sleutel voor de render-API die begint met `lrk_`.
- **CLI-vereisten per installatiemethode**
  - Debian en Ubuntu met APT: het pakket bevat een eigen versie van Node.js.
  - macOS met Homebrew: Homebrew installeert de benodigde versie van Node.js.
  - Downloadbaar installatieprogramma voor Windows, macOS of Linux: je hebt Node.js 24 of hoger nodig.

De server compileert de documenten. Voor geen van deze methoden hoef je TeX Live op je eigen computer te installeren.

> [!WARNING]
> Plak API-sleutels niet in gesprekken met AI, broncode, Git-repository's of logbestanden. Vermoed je dat een sleutel is uitgelekt, vraag de beheerder dan onmiddellijk om deze in te trekken en een nieuwe uit te geven.

Raadpleeg [Problemen oplossen](/nl/docs/troubleshooting/) bij problemen met inloggen of converteren.
