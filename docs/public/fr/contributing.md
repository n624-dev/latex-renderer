---
slug: contributing
category: Développement et contributions
title: Contribuer à la documentation
description: Modifiez les guides au format Markdown et vérifiez les changements en local.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Modifier un guide {#本文を編集する}

- **Signaler une erreur.** Si un guide ne correspond plus à l’interface ou aux commandes, ouvrez un ticket dans [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) et indiquez la page et la correction proposée.
- **Proposer une modification.** Modifiez le fichier correspondant dans les [sources Markdown des guides publics (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) et ouvrez une pull request.

## Vérifications locales {#ローカル検証}

Après modification, exécutez ces commandes et vérifiez que la compilation et les contrôles des liens et en-têtes réussissent.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

La compilation de `public-web` effectue une simulation avec Wrangler et lance un environnement Workers local pour vérifier des pages représentatives, l’index de recherche, les erreurs 404, les redirections et les en-têtes.

## Compatibilité {#互換性}

- Conservez les chemins publics et les ancres des titres (fragments `#...` générés à partir du texte). Si vous modifiez un titre, vérifiez les liens provenant d’autres pages.
- Si vous modifiez des options de la CLI ou des exemples de requêtes HTTP, vérifiez leur cohérence avec l’implémentation et les définitions OpenAPI.
