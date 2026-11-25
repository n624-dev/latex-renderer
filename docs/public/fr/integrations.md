---
slug: integrations
category: IA et MCP
title: Utiliser Codex ou Claude Code
description: Utilisez les mêmes identifiants locaux pour la CLI et MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Installer la compétence {#skillの導入}

1. Commencez par [installer la CLI et enregistrer votre clé d’API](/fr/docs/client/).
2. Une fois Codex ou Claude Code installé, configurez l’intégration selon la méthode d’installation de la CLI.

   - **Programme d’installation à télécharger.** Ouvrez `n624-latex setup` et choisissez votre outil d’IA. Vous pouvez inscrire la compétence et Local MCP ensemble.
   - **Homebrew.** Vous pouvez aussi configurer l’intégration avec `n624-latex setup`. Pour migrer une inscription Local MCP existante, suivez les [instructions Homebrew](/fr/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Inscrivez Local MCP manuellement](/fr/docs/mcp/#local-mcpの登録).

3. Redémarrez Codex ou Claude Code et indiquez dans votre demande le dossier ou le document principal à compiler.

- **Emplacement des compétences**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Si le programme d’installation détecte une compétence modifiée par l’utilisateur, il la conserve et le signale dans les résultats.

## Inscrire MCP {#mcpの登録}

- **Pour travailler sur des fichiers locaux dans Codex ou Claude Code**, utilisez Local MCP. Consultez l’[inscription manuelle](/fr/docs/mcp/#local-mcpの登録) et la [vérification de l’état](/fr/docs/client/#状態確認と修復).
- **Pour utiliser ChatGPT, Claude sur le web ou un autre assistant hébergé**, suivez les [instructions de connexion à Remote MCP](/fr/docs/mcp/#通常はremote-mcpを使う). Aucune clé d’API n’est nécessaire.

## Exemples de demandes {#依頼例}

- « Vérifie et compile le fichier `main.tex` de ce dossier. »
- « Compile le fichier `reports/a.tex` de ce ZIP. »
- « Envoie ce ZIP une seule fois et compile `reports/a.tex` et `reports/b.tex` séparément. »
- « Lis les erreurs structurées, corrige uniquement le code TeX concerné et recompile. »
- « Vérifie le PDF généré et les aperçus des pages. »

## Sécurité d’utilisation {#安全な使い方}

> [!WARNING]
> Gardez les clés d’API hors des demandes, des arguments d’outils MCP et des fichiers du projet. Local MCP utilise en interne les identifiants protégés enregistrés par la CLI.

- **Données non fiables.** Le code LaTeX, les chemins, journaux, erreurs, fichiers de sortie et réponses MCP sont considérés comme non fiables. L’intégration est conçue pour ignorer les instructions qu’ils contiennent, y compris les injections de prompt.
- **Actions destructrices.** Exécutez `cancel_render` et `delete_render` uniquement à la demande explicite de l’utilisateur.
- **Choix du document.** Si aucun point d’entrée n’est indiqué, la valeur par défaut est `main.tex`. Si `main.tex` est absent et que plusieurs fichiers `.tex` conviennent, l’utilisateur doit choisir. Les fichiers `.tex` ne sont jamais tous compilés automatiquement. La compétence contient les règles de sécurité et l’enchaînement des opérations. Les spécifications détaillées se trouvent dans `references/` et dans la documentation publique.
