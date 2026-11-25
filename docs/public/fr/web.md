---
slug: web
category: Application web
title: Convertir des documents dans le navigateur
description: Créez un PDF à partir d’un fichier TeX ou d’une archive ZIP et retrouvez vos conversions précédentes.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Créer un PDF dans le navigateur {#ブラウザでpdfへ変換}

1. Ouvrez l’[application web](/app/) et connectez-vous avec la méthode indiquée par l’administrateur.
2. Sélectionnez les fichiers ou déposez-les sur la page.
   - Pour un document constitué d’un seul fichier, sélectionnez directement le `.tex`.
   - S’il comporte des images, une bibliographie ou plusieurs `.tex` (par exemple via `\input`), regroupez le document et ses dépendances dans un `.zip`. Consultez les [fichiers acceptés et la structure du ZIP](/fr/docs/projects/).
   - Si vous sélectionnez plusieurs fichiers `.tex` séparément, chacun est converti comme un document indépendant.
3. Si le ZIP comporte plusieurs fichiers `.tex` et qu’un sélecteur apparaît, choisissez le document principal comme point d’entrée.
4. Cliquez sur **Convertir en PDF**. Une fois l’opération terminée, la page des résultats affiche le PDF et les aperçus des pages.

Pour utiliser un moteur autre que LuaLaTeX, sélectionnez-le dans **Destination et options de sortie → Moteur**. L’[environnement de rendu](/app/environment/) indique les moteurs disponibles et les vérifications réalisées pour le PDF, les SVG et leur position. pLaTeX et upLaTeX nécessitent la collection japonaise sur le serveur.

## Modifier un document dans le navigateur {#ブラウザーで文書を編集する}

1. Ouvrez un document dans [Projets](/app/projects/) et sélectionnez **Modifier le TeX**. Un nouveau projet contient un fichier `main.tex` vide. Vous pouvez aussi choisir un modèle.
2. Les modifications sont automatiquement enregistrées dans le brouillon. Utilisez **Joindre un fichier** pour ajouter des images ou une bibliographie.
3. Activez **Compilation automatique** pour actualiser le PDF lorsque vous cessez de saisir du texte. Pour l’actualiser immédiatement, cliquez sur **Compiler**.
4. Cliquez sur **Enregistrer une version** pour conserver les fichiers sources dans l’historique. Utilisez **Modifier à partir de cette révision** pour reprendre une version enregistrée. Si un brouillon existe, une confirmation est demandée avant son remplacement.

Ouvrez **Gérer les fichiers** pour ajouter ou joindre des fichiers. Dans **Paramètres**, vous pouvez changer le moteur, la compilation automatique et la langue, ou enregistrer une révision. Le bouton **⋯** du panneau PDF donne accès au zoom et à l’affichage PNG.

En cas d’échec de compilation, le brouillon et le dernier PDF valide sont conservés. Sélectionnez une erreur indiquant le fichier et la ligne pour accéder à cette ligne. Sur mobile, basculez entre **Code**, **PDF** et **Erreurs**. Si le PDF tarde à s’afficher, choisissez **PNG (aperçu léger)**.

Les aperçus temporaires sont disponibles uniquement dans l’éditeur. Pour conserver un PDF, téléchargez-le avec **Enregistrer le PDF**.

L’éditeur utilise UTF-8. Ouvrez les fichiers Shift_JIS ou EUC-JP dans un éditeur de texte avec leur encodage d’origine, vérifiez leur affichage et enregistrez une copie en UTF-8. Joignez cette copie sous le même nom et confirmez le remplacement.

## Obtenir les équations et schémas TikZ en SVG {#数式や-tikz-を-svg-で取得する}

1. Avant la conversion, ouvrez **Destination et options de sortie** et cochez **Exporter aussi les formules et TikZ en SVG**.
2. Vous pouvez télécharger le PDF dès qu’il est prêt.
3. Si le résultat indique **Réussite partielle**, le PDF est prêt, mais l’extraction des SVG a échoué. Enregistrez d’abord le PDF puis, si nécessaire, cliquez sur **Réessayer uniquement le SVG**.

Seul l’aperçu PNG de la première page est créé initialement. Les autres sont générés lorsque vous les ouvrez. Le PDF terminé peut être téléchargé pendant la préparation des aperçus. Consultez [Obtenir les PDF, PNG et SVG](/fr/docs/outputs/).

## Retrouver ses documents et résultats {#以前の文書や結果を開く}

- **[Historique](/app/history/)** affiche l’avancement et les fichiers générés. Vous pouvez revenir à la même page de résultats après avoir fermé le navigateur.
- **[Projets](/app/projects/)** affiche les documents et les révisions enregistrés. Pour reconvertir un jeu de sources antérieur, ouvrez la révision et cliquez sur **Convertir à nouveau**.
- L’**[environnement de rendu](/app/environment/)** permet de rechercher les paquets LaTeX et les polices disponibles sur le serveur.

## Informations publiques et privées {#公開される情報}

- **Pages nécessitant une connexion.** Connectez-vous à l’application web (`/app/`) pour consulter vos documents et conversions dans l’historique ou sur la page de résultats. Seuls les administrateurs et propriétaires peuvent utiliser l’espace d’administration (`/admin/`). Consultez [Sécurité des comptes et documents](/fr/docs/security/).
- **Pages publiques.** Si vous ne parvenez pas à vous connecter, consultez l’[état du service](/status/) ou le [guide de dépannage](/fr/docs/troubleshooting/). La CLI est disponible dans [Téléchargements](/downloads/) et les spécifications d’intégration dans l’[API publique](/fr/docs/api/).
