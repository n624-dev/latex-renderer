---
slug: index
category: Kom i gang
title: Veiledning til LaTeX Renderer
description: Konverter LaTeX-dokumenter til PDF i nettleseren, i terminalen eller med en KI-assistent.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Lag din første PDF {#最短でpdfを作る}

1. Åpne [nettappen](/app/) og logg inn med metoden administratoren har oppgitt.
2. Velg filen `.tex` og klikk på **Konverter til PDF**. Hvis dokumentet bruker bilder eller bibliografi, pakk dokumentet og de tilhørende filene i et ZIP-arkiv og velg arkivet.
3. Åpne PDF-filen på resultatsiden. Du finner den igjen under **Historikk** i nettappen.

Har du ikke et testdokument, kan du lagre følgende eksempel som `main.tex` med UTF-8-koding.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Eksempel med japansk tekst og oppbygning av ZIP-arkivet](/no/docs/projects/)
- [Veiledning til nettappen](/no/docs/web/)
- [Lagre PDF og PNG og prøv å hente ut SVG på nytt](/no/docs/outputs/)

Vil du bruke terminalen, [installer kommandolinjeverktøyet for operativsystemet ditt](/no/docs/client/). Sett opp tilkoblingen med `n624-latex setup`. I mappen der du lagret `main.tex`, kjører du `n624-latex main.tex` for å lage `main.pdf`.

## Velg arbeidsmåte {#利用方法を選ぶ}

| Hva vil du gjøre? | Verktøy | Veiledning |
| --- | --- | --- |
| **Konvertere dokumenter i nettleseren** | Nettapp | [Konverter i nettleseren](/no/docs/web/) |
| **Konvertere fra terminalen og lagre resultatene lokalt** | CLI for Windows, macOS eller Linux | [Installer CLI](/no/docs/client/) |
| **Konvertere fra ChatGPT eller Claude** | Remote MCP med OAuth | [Koble til ChatGPT eller Claude](/no/docs/mcp/) |
| **Arbeide med lokale dokumenter i Codex eller Claude Code** | CLI, Local MCP og en ferdighet | [Bruk Codex eller Claude Code](/no/docs/integrations/) |
| **Automatisere konvertering i egen applikasjon** | HTTP-API | [Offentlig API](/no/docs/api/) |
| **Kjøre tjenesten på egen Linux-server** | Egen server | [Drift av egen server](/no/docs/self-hosting/) |

## Forutsetninger {#必要なもの}

- **Nettapp og Remote MCP.** Du trenger en konto for innlogging etter serveradministratorens anvisninger.
- **CLI, Local MCP og HTTP-API.** Be administratoren om en API-nøkkel for rendering som begynner med `lrk_`.
- **CLI-krav etter installasjonsmetode**
  - Debian og Ubuntu med APT: Pakken inneholder sin egen versjon av Node.js.
  - macOS med Homebrew: Homebrew installerer den nødvendige versjonen av Node.js.
  - Nedlastbart installasjonsprogram for Windows, macOS eller Linux: Du trenger Node.js 24 eller nyere.

Dokumentene kompileres på serveren. Du trenger ikke installere TeX Live på din egen maskin for noen av disse metodene.

> [!WARNING]
> Ikke lim API-nøkler inn i KI-samtaler, kildekode, Git-repositorier eller logger. Mistenker du at en nøkkel er lekket, be administratoren trekke den tilbake og utstede en ny med en gang.

Se [Feilsøking](/no/docs/troubleshooting/) hvis du ikke kommer inn eller har problemer med å konvertere et dokument.
