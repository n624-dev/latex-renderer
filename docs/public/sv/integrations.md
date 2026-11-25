---
slug: integrations
category: AI och MCP
title: Använd Codex eller Claude Code
description: Använd de lokalt sparade inloggningsuppgifterna både i CLI och MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Installera en skill {#skillの導入}

1. Börja med att [installera CLI och spara din API-nyckel](/sv/docs/client/).
2. När Codex eller Claude Code är installerat konfigurerar du integreringen utifrån hur du installerade CLI.

   - **Nedladdningsbart installationsprogram.** Öppna `n624-latex setup` och välj ditt AI-verktyg. Du kan registrera både en skill och Local MCP samtidigt.
   - **Homebrew.** Du kan även ställa in integreringen med `n624-latex setup`. För att flytta en tidigare registrering av Local MCP, följ [Homebrew-anvisningarna](/sv/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registrera Local MCP manuellt](/sv/docs/mcp/#local-mcpの登録).

3. Starta om Codex eller Claude Code och ange mappen eller huvuddokumentet du vill kompilera i din förfrågan.

- **Platser för installerade skills**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Om installationsprogrammet hittar en användarändrad skill behålls den. Det framgår av resultatet.

## Registrera MCP {#mcpの登録}

- **För lokala filer i Codex eller Claude Code** använder du Local MCP. Se [Manuell registrering](/sv/docs/mcp/#local-mcpの登録) och [Kontrollera status](/sv/docs/client/#状態確認と修復).
- **För ChatGPT, Claude på webben eller en annan molnbaserad assistent** följer du [anslutningsanvisningarna för Remote MCP](/sv/docs/mcp/#通常はremote-mcpを使う). Du behöver ingen API-nyckel.

## Exempel på förfrågningar {#依頼例}

- ”Granska och kompilera filen `main.tex` i den här mappen.”
- ”Kompilera filen `reports/a.tex` i det här ZIP-arkivet.”
- ”Ladda upp det här ZIP-arkivet en enda gång och kompilera `reports/a.tex` och `reports/b.tex` var för sig.”
- ”Läs de strukturerade felen, rätta bara den berörda TeX-koden och kompilera igen.”
- ”Kontrollera PDF-filen och sidförhandsvisningarna som skapades.”

## Säker användning {#安全な使い方}

> [!WARNING]
> Ange inte API-nycklar i förfrågningar, MCP-verktygsargument eller projektfiler. Local MCP använder de skyddade inloggningsuppgifterna från CLI internt.

- **Otillförlitliga data.** LaTeX-kod, sökvägar, loggar, fel, utdatafiler och MCP-svar behandlas som otillförlitliga. Integreringen är utformad för att ignorera instruktioner i sådana data, inklusive försök till promptinjektion.
- **Destruktiva åtgärder.** Kör `cancel_render` och `delete_render` endast på uttrycklig begäran från användaren.
- **Val av dokument.** Utan angiven startfil används `main.tex`. Saknas `main.tex` och det finns flera tänkbara `.tex` ombeds användaren att välja. Alla `.tex` körs aldrig automatiskt. Säkerhetsregler och arbetsordning finns i verktygets skill. Detaljerade specifikationer finns i `references/` och i den publika dokumentationen.
