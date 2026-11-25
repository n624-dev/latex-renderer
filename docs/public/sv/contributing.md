---
slug: contributing
category: Utveckling och bidrag
title: Bidra till dokumentationen
description: Redigera guiderna i Markdown och kontrollera ändringarna lokalt.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Redigera en guide {#本文を編集する}

- **Rapportera ett fel.** Om en guide avviker från gränssnittet eller kommandona, öppna ett ärende i [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose). Ange sidan och föreslå en rättelse.
- **Skicka en ändring.** Redigera rätt fil i [Markdown-källorna till de publika guiderna (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) och öppna en pull request.

## Lokala kontroller {#ローカル検証}

Kör följande kommandon efter redigeringen och kontrollera att bygget, länkkontrollerna och kontrollerna av HTTP-huvuden lyckas.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Bygget av `public-web` gör en testkörning med Wrangler och startar en lokal Workers-miljö för att kontrollera representativa sidor, sökindex, 404-svar, omdirigeringar och HTTP-huvuden.

## Kompatibilitet {#互換性}

- Bevara publika sökvägar och rubrikankare (`#...`-fragment som skapas från rubriktexten). Kontrollera länkar från andra sidor om du ändrar en rubrik.
- Om du ändrar CLI-flaggor eller exempel på HTTP-anrop, kontrollera dem mot implementationen och OpenAPI-definitionerna.
