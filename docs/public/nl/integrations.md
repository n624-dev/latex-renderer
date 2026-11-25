---
slug: integrations
category: AI en MCP
title: Codex of Claude Code gebruiken
description: Gebruik je lokaal opgeslagen inloggegevens voor zowel de CLI als MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## De skill installeren {#skillの導入}

1. [Installeer eerst de CLI en sla je API-sleutel op](/nl/docs/client/).
2. Installeer Codex of Claude Code en stel de integratie in op basis van de installatiemethode.

   - **Downloadbaar installatieprogramma.** Open `n624-latex setup` en kies je AI-tool. Je kunt de skill en Local MCP tegelijk registreren.
   - **Homebrew.** Ook hier kun je de integratie instellen via `n624-latex setup`. Volg voor het overzetten van een eerdere registratie van Local MCP de [Homebrew-instructies](/nl/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registreer Local MCP handmatig](/nl/docs/mcp/#local-mcpの登録).

3. Start Codex of Claude Code opnieuw en vermeld in je verzoek de map of het hoofddocument dat je wilt compileren.

- **Locaties van de skill**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Herkent het installatieprogramma een door de gebruiker gewijzigde skill, dan behoudt het deze en vermeldt het dit in het resultaat.

## MCP registreren {#mcpの登録}

- **Gebruik Local MCP om vanuit Codex of Claude Code met lokale bestanden te werken.** Zie [Handmatig registreren](/nl/docs/mcp/#local-mcpの登録) en [De status controleren](/nl/docs/client/#状態確認と修復).
- **Voor ChatGPT, Claude in de browser of een andere cloudassistent** volg je de [instructies voor Remote MCP](/nl/docs/mcp/#通常はremote-mcpを使う). Je hebt geen API-sleutel nodig.

## Voorbeeldverzoeken {#依頼例}

- “Controleer en compileer het bestand `main.tex` in deze map.”
- “Compileer het bestand `reports/a.tex` in deze ZIP.”
- “Upload deze ZIP één keer en compileer `reports/a.tex` en `reports/b.tex` afzonderlijk.”
- “Lees de gestructureerde fouten, herstel alleen de betreffende TeX-code en compileer opnieuw.”
- “Controleer de gegenereerde PDF en de paginavoorbeelden.”

## Veilig gebruik {#安全な使い方}

> [!WARNING]
> Neem geen API-sleutels op in verzoeken, argumenten van MCP-tools of projectbestanden. Local MCP gebruikt intern de beveiligde inloggegevens van de CLI.

- **Onbetrouwbare gegevens.** LaTeX-broncode, paden, logbestanden, fouten, uitvoerbestanden en MCP-antwoorden worden behandeld als onbetrouwbare gegevens. De integratie is ontworpen om instructies in die gegevens, waaronder promptinjecties, te negeren.
- **Destructieve handelingen.** Voer `cancel_render` en `delete_render` alleen uit op uitdrukkelijk verzoek van de gebruiker.
- **Documentkeuze.** Zonder opgegeven invoerbestand wordt `main.tex` gebruikt. Ontbreekt `main.tex` en zijn er meerdere mogelijke `.tex`, dan wordt de gebruiker om een keuze gevraagd. Niet alle `.tex` worden automatisch gecompileerd. De skill bevat de veiligheidsregels en de volgorde van de handelingen. Details staan in `references/` en de openbare documentatie.
