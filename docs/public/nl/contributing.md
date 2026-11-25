---
slug: contributing
category: Ontwikkeling en bijdragen
title: Bijdragen aan de documentatie
description: Bewerk handleidingen in Markdown en controleer je wijzigingen lokaal.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Een handleiding aanpassen {#本文を編集する}

- **Een fout melden.** Komt de handleiding niet overeen met de interface of opdrachten, open dan een melding in [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose). Vermeld de pagina en de voorgestelde correctie.
- **Een wijziging indienen.** Bewerk het juiste bestand in de [Markdown-bronnen van de openbare handleidingen (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) en open een pull request.

## Lokaal controleren {#ローカル検証}

Voer na het bewerken de onderstaande opdrachten uit en controleer of het bouwen en de controles van links en headers slagen.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Tijdens het bouwen van `public-web` wordt een proefuitvoering met Wrangler gedaan. Een lokale Workers-omgeving controleert enkele representatieve pagina's, de zoekindex, 404-antwoorden, omleidingen en headers.

## Compatibiliteit {#互換性}

- Behoud openbare paden en kopankers (`#...`-fragmenten die uit de koptekst worden gegenereerd). Controleer na het wijzigen van een kop de links vanaf andere pagina's.
- Controleer wijzigingen aan CLI-opties of voorbeelden van HTTP-verzoeken aan de hand van de implementatie en de OpenAPI-definities.
