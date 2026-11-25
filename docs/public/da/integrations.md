---
slug: integrations
category: AI og MCP
title: Brug Codex eller Claude Code
description: Brug de samme lokalt gemte loginoplysninger i CLI og MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Installér en skill {#skillの導入}

1. Begynd med at [installere CLI og gemme API-nøglen](/da/docs/client/).
2. Når Codex eller Claude Code er installeret, skal du konfigurere integrationen ud fra din installationsmetode.

   - **Downloadet installationsprogram.** Åbn `n624-latex setup`, og vælg dit AI-værktøj. Du kan registrere en skill og Local MCP samtidig.
   - **Homebrew.** Du kan også konfigurere integrationen med `n624-latex setup`. Følg [Homebrew-vejledningen](/da/docs/client/#配布インストーラー版から-homebrew-へ移行する), hvis du vil flytte en tidligere registrering af Local MCP.
   - **APT.** [Registrer Local MCP manuelt](/da/docs/mcp/#local-mcpの登録).

3. Genstart Codex eller Claude Code, og angiv den mappe eller det hoveddokument, du vil kompilere, i din forespørgsel.

- **Placering af skills**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Finder installationsprogrammet en skill, som brugeren har ændret, bevares den, og det fremgår af resultatet.

## Registrer MCP {#mcpの登録}

- **Brug Local MCP til lokale filer i Codex eller Claude Code.** Se [Manuel registrering](/da/docs/mcp/#local-mcpの登録) og [Kontroller status](/da/docs/client/#状態確認と修復).
- **For ChatGPT, Claude i browseren eller en anden cloudbaseret assistent** skal du følge [tilslutningsvejledningen til Remote MCP](/da/docs/mcp/#通常はremote-mcpを使う). Du behøver ingen API-nøgle.

## Eksempler på forespørgsler {#依頼例}

- »Gennemgå og kompilér filen `main.tex` i denne mappe.«
- »Kompilér filen `reports/a.tex` i dette ZIP-arkiv.«
- »Upload kun dette ZIP-arkiv én gang, og kompilér `reports/a.tex` og `reports/b.tex` hver for sig.«
- »Læs de strukturerede fejl, ret kun den berørte TeX-kode, og kompilér igen.«
- »Kontroller den genererede PDF og forhåndsvisningerne af siderne.«

## Sikker brug {#安全な使い方}

> [!WARNING]
> Medtag ikke API-nøgler i forespørgsler, MCP-værktøjsargumenter eller projektfiler. Local MCP bruger de beskyttede loginoplysninger fra CLI internt.

- **Ikke-betroede data.** LaTeX-kode, stier, logfiler, fejl, outputfiler og MCP-svar behandles som ikke-betroede data. Integrationen er udformet til at ignorere instruktioner i dem, herunder forsøg på promptinjektion.
- **Destruktive handlinger.** Kør kun `cancel_render` og `delete_render` på brugerens udtrykkelige anmodning.
- **Dokumentvalg.** Uden en angivet startfil bruges `main.tex`. Hvis `main.tex` mangler, og der er flere mulige `.tex`, bliver brugeren bedt om at vælge. Alle `.tex` kompileres aldrig automatisk. Værktøjets skill indeholder sikkerhedsregler og rækkefølgen af handlinger. Detaljerede specifikationer findes i `references/` og i den offentlige dokumentation.
