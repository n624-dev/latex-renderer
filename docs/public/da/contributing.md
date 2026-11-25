---
slug: contributing
category: Udvikling og bidrag
title: Bidrag til dokumentationen
description: Rediger vejledningerne i Markdown, og kontroller dine ændringer lokalt.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Rediger en vejledning {#本文を編集する}

- **Rapportér en fejl.** Stemmer vejledningen ikke med brugerfladen eller kommandoerne, så opret en sag i [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose). Angiv siden og den foreslåede rettelse.
- **Indsend en ændring.** Rediger den relevante fil i [Markdown-kilderne til de offentlige vejledninger (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public), og opret en pull request.

## Lokal kontrol {#ローカル検証}

Kør følgende kommandoer efter redigeringen, og kontroller, at bygningen og kontrollen af links og HTTP-headere lykkes.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Bygningen af `public-web` laver en prøvekørsel med Wrangler og starter et lokalt Workers-miljø, der kontrollerer repræsentative sider, søgeindeks, 404-svar, omdirigeringer og headere.

## Kompatibilitet {#互換性}

- Bevar de offentlige stier og overskrifternes ankre (`#...`-fragmenter dannet ud fra overskriftsteksten). Hvis du ændrer en overskrift, skal du kontrollere links fra andre sider.
- Hvis du ændrer CLI-valg eller eksempler på HTTP-kald, skal du kontrollere dem mod implementeringen og OpenAPI-definitionerne.
