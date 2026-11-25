---
slug: contributing
category: Utvikling og bidrag
title: Bidra til dokumentasjonen
description: Rediger veiledningene i Markdown og kontroller endringene lokalt.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Rediger en veiledning {#本文を編集する}

- **Meld fra om feil.** Hvis en veiledning ikke stemmer med grensesnittet eller kommandoene, opprett en sak i [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose). Oppgi siden og foreslå en rettelse.
- **Send inn en endring.** Rediger riktig fil i [Markdown-kildene til de offentlige veiledningene (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) og opprett en pull request.

## Lokal kontroll {#ローカル検証}

Kjør disse kommandoene etter redigeringen og kontroller at bygging og kontroll av lenker og HTTP-hoder lykkes.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Byggingen av `public-web` gjør en prøvekjøring med Wrangler og starter et lokalt Workers-miljø for å kontrollere representative sider, søkeindeks, 404-svar, omdirigeringer og HTTP-hoder.

## Kompatibilitet {#互換性}

- Behold offentlige stier og overskriftsankre (`#...`-fragmenter som genereres fra overskriftsteksten). Sjekk lenker fra andre sider hvis du endrer en overskrift.
- Når du endrer CLI-valg eller eksempler på HTTP-forespørsler, kontroller at de samsvarer med implementasjonen og OpenAPI-definisjonene.
