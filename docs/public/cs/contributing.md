---
slug: contributing
category: Vývoj a příspěvky
title: Přispívání do dokumentace
description: Upravte návody v Markdownu a ověřte změny místně.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Úprava návodu {#本文を編集する}

- **Hlášení chyby.** Neodpovídá-li návod rozhraní nebo příkazům, otevřete hlášení v [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose). Uveďte stránku a navrženou opravu.
- **Návrh změn.** Upravte odpovídající soubor ve [zdrojích veřejných návodů v Markdownu (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) a otevřete pull request.

## Místní ověření {#ローカル検証}

Po úpravě spusťte následující příkazy a ověřte sestavení, odkazy a hlavičky.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Sestavení `public-web` provede zkušební běh Wrangleru a spustí místní prostředí Workers pro kontrolu vybraných stránek, vyhledávacího indexu, odpovědí 404, přesměrování a hlaviček.

## Kompatibilita {#互換性}

- Zachovejte veřejné cesty a kotvy nadpisů (fragmenty `#...` vytvořené z textu nadpisu). Při změně nadpisu prověřte odkazy z jiných stránek.
- Při změně voleb CLI nebo příkladů požadavků HTTP ověřte shodu s implementací a definicemi OpenAPI.
