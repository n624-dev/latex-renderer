---
slug: index
category: Kom i gang
title: Vejledning til LaTeX Renderer
description: Konvertér LaTeX-dokumenter til PDF i browseren, i terminalen eller med en AI-assistent.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Lav din første PDF {#最短でpdfを作る}

1. Åbn [webappen](/app/), og log ind med den metode, administratoren har angivet.
2. Vælg filen `.tex`, og klik på **Konvertér til PDF**. Hvis dokumentet bruger billeder eller bibliografi, skal du pakke dokumentet og de tilhørende filer i et ZIP-arkiv og vælge arkivet.
3. Åbn PDF-filen på resultatsiden. Senere kan du finde den under **Historik** i webappen.

Hvis du ikke har et testdokument, kan du gemme dette eksempel som `main.tex` med UTF-8-kodning.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Eksempel med japansk tekst og opbygning af ZIP-arkivet](/da/docs/projects/)
- [Vejledning til webappen](/da/docs/web/)
- [Gem PDF og PNG, og udtræk SVG igen](/da/docs/outputs/)

Vil du bruge terminalen, skal du [installere kommandolinjeværktøjet til dit system](/da/docs/client/). Sæt forbindelsen op med `n624-latex setup`. I mappen, hvor du gemte `main.tex`, kører du `n624-latex main.tex` for at oprette `main.pdf`.

## Vælg en arbejdsmåde {#利用方法を選ぶ}

| Hvad vil du gøre? | Værktøj | Vejledning |
| --- | --- | --- |
| **Konvertere dokumenter i browseren** | Webapp | [Konvertér i browseren](/da/docs/web/) |
| **Konvertere fra terminalen og gemme resultater lokalt** | CLI til Windows, macOS eller Linux | [Installér CLI](/da/docs/client/) |
| **Konvertere fra ChatGPT eller Claude** | Remote MCP med OAuth | [Forbind ChatGPT eller Claude](/da/docs/mcp/) |
| **Arbejde med lokale dokumenter i Codex eller Claude Code** | CLI, Local MCP og en skill | [Brug Codex eller Claude Code](/da/docs/integrations/) |
| **Automatisere konvertering i din applikation** | HTTP-API | [Offentligt API](/da/docs/api/) |
| **Køre tjenesten på din egen Linux-server** | Egen server | [Drift af egen server](/da/docs/self-hosting/) |

## Forudsætninger {#必要なもの}

- **Webappen og Remote MCP.** Du skal have en konto, som du kan logge ind med efter serveradministratorens anvisninger.
- **CLI, Local MCP og HTTP-API.** Bed administratoren om en API-nøgle til rendering, der begynder med `lrk_`.
- **CLI-krav efter installationsmetode**
  - Debian og Ubuntu med APT: Pakken indeholder sin egen version af Node.js.
  - macOS med Homebrew: Homebrew installerer den nødvendige version af Node.js.
  - Installationsprogram til download på Windows, macOS eller Linux: Du skal have Node.js 24 eller nyere.

Serveren kompilerer dokumenterne. Du behøver ikke installere TeX Live på din egen computer for at bruge disse metoder.

> [!WARNING]
> Indsæt ikke API-nøgler i AI-samtaler, kildekode, Git-repositorier eller logfiler. Har du mistanke om, at en nøgle er lækket, så bed straks administratoren om at tilbagekalde den og udstede en ny.

Se [Fejlfinding](/da/docs/troubleshooting/), hvis du har problemer med at logge ind eller konvertere et dokument.
