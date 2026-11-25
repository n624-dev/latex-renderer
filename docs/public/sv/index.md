---
slug: index
category: Kom igång
title: Guide till LaTeX Renderer
description: Konvertera LaTeX-dokument till PDF i webbläsaren, terminalen eller med en AI-assistent.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Skapa din första PDF {#最短でpdfを作る}

1. Öppna [webbappen](/app/) och logga in på det sätt som administratören har angett.
2. Välj filen `.tex` och klicka på **Konvertera till PDF**. Om dokumentet använder bilder eller en bibliografi, packa dokumentet och tillhörande filer i ett ZIP-arkiv och välj arkivet.
3. Öppna PDF-filen på resultatsidan. Senare hittar du den under **Historik** i webbappen.

Om du saknar ett testdokument kan du spara följande exempel som `main.tex` med UTF-8-kodning.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Japanskt sättningsexempel och ZIP-arkivets struktur](/sv/docs/projects/)
- [Guide till webbappen](/sv/docs/web/)
- [Spara PDF och PNG och försök extrahera SVG igen](/sv/docs/outputs/)

Vill du använda terminalen, [installera kommandoradsverktyget för ditt system](/sv/docs/client/). Konfigurera anslutningen med `n624-latex setup`. I mappen där du sparade `main.tex` kör du `n624-latex main.tex` för att skapa `main.pdf`.

## Välj arbetssätt {#利用方法を選ぶ}

| Vad vill du göra? | Verktyg | Guide |
| --- | --- | --- |
| **Konvertera dokument i webbläsaren** | Webbapp | [Konvertera i webbläsaren](/sv/docs/web/) |
| **Konvertera i terminalen och spara resultaten lokalt** | CLI för Windows, macOS eller Linux | [Installera CLI](/sv/docs/client/) |
| **Konvertera från ChatGPT eller Claude** | Remote MCP med OAuth | [Anslut ChatGPT eller Claude](/sv/docs/mcp/) |
| **Arbeta med lokala dokument i Codex eller Claude Code** | CLI, Local MCP och en skill | [Använd Codex eller Claude Code](/sv/docs/integrations/) |
| **Automatisera konverteringar i din app** | HTTP-API | [Publikt API](/sv/docs/api/) |
| **Kör tjänsten på en egen Linuxserver** | Egen server | [Driv en egen server](/sv/docs/self-hosting/) |

## Förutsättningar {#必要なもの}

- **Webbappen och Remote MCP.** Du behöver ett konto för inloggning enligt serveradministratörens anvisningar.
- **CLI, Local MCP och HTTP-API.** Be administratören om en API-nyckel för rendering som börjar med `lrk_`.
- **CLI-krav för olika installationsmetoder**
  - Debian och Ubuntu med APT: paketet innehåller en egen version av Node.js.
  - macOS med Homebrew: Homebrew installerar den version av Node.js som behövs.
  - Nedladdat installationsprogram för Windows, macOS eller Linux: du behöver Node.js 24 eller senare.

Servern kompilerar dokumenten. Du kan använda alla metoder utan att installera TeX Live på din egen dator.

> [!WARNING]
> Klistra inte in API-nycklar i AI-konversationer, källkod, Git-arkiv eller loggar. Misstänker du att en nyckel har läckt, be omedelbart administratören att återkalla den och utfärda en ny.

Om du inte kan logga in eller konvertera ett dokument, se [Felsökning](/sv/docs/troubleshooting/).
