---
slug: index
category: Premiers pas
title: Guide de LaTeX Renderer
description: Convertissez vos documents LaTeX en PDF depuis un navigateur, un terminal ou un assistant IA.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Créer son premier PDF {#最短でpdfを作る}

1. Ouvrez l’[application web](/app/) et connectez-vous avec la méthode indiquée par l’administrateur.
2. Sélectionnez le fichier `.tex` et cliquez sur **Convertir en PDF**. Si votre document utilise des images ou une bibliographie, regroupez les fichiers avec le document dans une archive ZIP et sélectionnez cette archive.
3. Ouvrez le PDF dans les résultats. Pour le retrouver ultérieurement, ouvrez **Historique** dans l’application web.

Si vous n’avez pas de document de test, enregistrez cet exemple sous le nom `main.tex` avec l’encodage UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Exemple en japonais et structure du ZIP](/fr/docs/projects/)
- [Guide de l’application web](/fr/docs/web/)
- [Enregistrer les PDF et PNG et relancer l’extraction des SVG](/fr/docs/outputs/)

Pour travailler dans le terminal, [installez la CLI pour votre système](/fr/docs/client/). Configurez la connexion avec `n624-latex setup`. Dans le dossier où vous avez enregistré `main.tex`, exécutez `n624-latex main.tex` pour créer `main.pdf`.

## Choisir son outil {#利用方法を選ぶ}

| Votre objectif | Outil | Guide |
| --- | --- | --- |
| **Convertir un document dans le navigateur** | Application web | [Convertir dans le navigateur](/fr/docs/web/) |
| **Convertir dans le terminal et enregistrer les résultats sur votre machine** | CLI pour Windows, macOS ou Linux | [Installer la CLI](/fr/docs/client/) |
| **Convertir depuis ChatGPT ou Claude** | Remote MCP avec OAuth | [Connecter ChatGPT ou Claude](/fr/docs/mcp/) |
| **Travailler sur des documents locaux dans Codex ou Claude Code** | CLI, Local MCP et compétence | [Utiliser Codex ou Claude Code](/fr/docs/integrations/) |
| **Automatiser la conversion depuis une application** | API HTTP | [API publique](/fr/docs/api/) |
| **Exécuter le service sur votre serveur Linux** | Auto-hébergement | [Administrer son serveur](/fr/docs/self-hosting/) |

## Prérequis {#必要なもの}

- **Application web et Remote MCP.** Utilisez un compte de connexion fourni ou indiqué par l’administrateur du serveur.
- **CLI, Local MCP et API HTTP.** Demandez à l’administrateur une clé d’API de rendu commençant par `lrk_`.
- **Version de Node.js requise pour la CLI selon l’installation**
  - Debian et Ubuntu avec APT : le paquet inclut sa propre version de Node.js.
  - macOS avec Homebrew : Homebrew installe la version nécessaire de Node.js.
  - Programme d’installation à télécharger pour Windows, macOS ou Linux : Node.js 24 ou ultérieur est requis.

Le serveur compile les documents. Vous pouvez utiliser tous ces outils sans installer TeX Live sur votre machine.

> [!WARNING]
> Gardez les clés d’API hors des conversations avec une IA, du code source, des dépôts Git et des journaux. Si vous pensez qu’une clé a été divulguée, demandez immédiatement à l’administrateur de la révoquer et d’en émettre une autre.

En cas de problème de connexion ou de conversion, consultez le [guide de dépannage](/fr/docs/troubleshooting/).
