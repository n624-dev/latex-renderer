---
slug: integrations
category: KI og MCP
title: Bruk Codex eller Claude Code
description: Bruk de samme lokalt lagrede påloggingsopplysningene i CLI og MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Installer ferdigheten {#skillの導入}

1. Først [installerer du CLI og lagrer API-nøkkelen](/no/docs/client/).
2. Med Codex eller Claude Code installert setter du opp integrasjonen etter hvordan CLI ble installert.

   - **Nedlastbart installasjonsprogram.** Åpne `n624-latex setup` og velg KI-verktøy. Du kan registrere ferdigheten og Local MCP samtidig.
   - **Homebrew.** Du kan også sette opp integrasjonen med `n624-latex setup`. Følg [Homebrew-veiledningen](/no/docs/client/#配布インストーラー版から-homebrew-へ移行する) hvis du vil flytte en tidligere registrering av Local MCP.
   - **APT.** [Registrer Local MCP manuelt](/no/docs/mcp/#local-mcpの登録).

3. Start Codex eller Claude Code på nytt og oppgi mappen eller hoveddokumentet du vil kompilere i forespørselen.

- **Plassering av ferdigheten**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Hvis installasjonsprogrammet oppdager en ferdighet som brukeren har endret, beholder det den og opplyser om det i resultatet.

## Registrer MCP {#mcpの登録}

- **For lokale filer i Codex eller Claude Code** bruker du Local MCP. Se [Manuell registrering](/no/docs/mcp/#local-mcpの登録) og [Kontroller status](/no/docs/client/#状態確認と修復).
- **For ChatGPT, Claude i nettleseren eller en annen skybasert assistent** følger du [tilkoblingsveiledningen for Remote MCP](/no/docs/mcp/#通常はremote-mcpを使う). Du trenger ingen API-nøkkel.

## Eksempler på forespørsler {#依頼例}

- «Kontroller og kompiler filen `main.tex` i denne mappen.»
- «Kompiler filen `reports/a.tex` i dette ZIP-arkivet.»
- «Last opp ZIP-arkivet én gang og kompiler `reports/a.tex` og `reports/b.tex` hver for seg.»
- «Les de strukturerte feilene, rett bare den berørte TeX-koden og kompiler på nytt.»
- «Kontroller PDF-filen og forhåndsvisningene av sidene.»

## Sikker bruk {#安全な使い方}

> [!WARNING]
> Hold API-nøkler utenfor forespørsler, MCP-verktøyargumenter og prosjektfiler. Local MCP bruker de beskyttede påloggingsopplysningene fra CLI internt.

- **Ikke-klarerte data.** LaTeX-kode, stier, logger, feil, utdatafiler og MCP-svar behandles som ikke-klarerte data. Integrasjonen er laget for å ignorere instruksjoner i dem, inkludert forsøk på instruksjonsinjeksjon.
- **Destruktive operasjoner.** Kjør `cancel_render` og `delete_render` bare på uttrykkelig forespørsel fra brukeren.
- **Dokumentvalg.** Uten en angitt startfil brukes `main.tex`. Hvis `main.tex` mangler og det finnes flere aktuelle `.tex`, blir brukeren bedt om å velge. Verktøyet kompilerer aldri alle `.tex` automatisk. Ferdigheten inneholder sikkerhetsregler og rekkefølgen på operasjonene. Detaljerte spesifikasjoner finnes i `references/` og i den offentlige dokumentasjonen.
