---
slug: outputs
category: Web et CLI
title: Obtenir les PDF, PNG et SVG
description: Enregistrez le PDF, téléchargez des images des pages et exportez ou réextrayez les équations et schémas TikZ au format SVG.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Ouvrir et enregistrer un PDF {#pdf-を開く-保存する}

- **Application web.** Sélectionnez le document dans l’[historique](/app/history/) et ouvrez `result.pdf` dans la liste des fichiers sur la page de résultats. Si vous avez demandé un PDF et des SVG, le PDF peut être téléchargé dès qu’il est prêt.
- **CLI.** Téléchargez le résultat avec le `<jobId>` affiché. Ajoutez `--pdf-only` pour récupérer le PDF sans attendre les SVG. Pour préserver les fichiers d’un autre document, choisissez un autre dossier avec `--output`.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Obtenir des images des pages {#ページ画像を取得する}

Les aperçus PNG donnent une image de chaque page entière. Seule la page 1 est générée initialement. Les pages suivantes sont générées à la demande. Si une page est en préparation, patientez ou rouvrez-la. Vous pouvez télécharger le PDF terminé pendant ce temps.

- **Application web.** Dans les résultats, sélectionnez l’aperçu de la page souhaitée.
- **CLI.** La commande suivante télécharge les PNG des pages 2 et 5. Les noms de fichiers sont de la forme `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Enregistrer les équations et TikZ en SVG {#数式と-tikz-を-svg-で保存する}

Les expressions mathématiques les plus externes et les schémas TikZ de premier niveau peuvent être extraits sous forme d’images vectorielles indépendantes.

- **Application web.** Avant de convertir le document, ouvrez **Destination et options de sortie** et sélectionnez **Exporter aussi les formules et TikZ en SVG**. Une fois l’extraction terminée, téléchargez les fichiers SVG sur la page de résultats.
- **CLI.** Convertissez le document avec `--svg`. Les SVG sont enregistrés dans `.render/svg/objects/`. Les correspondances entre les lignes du fichier `.tex` d’origine et les coordonnées dans le PDF figurent dans `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Si le PDF est prêt mais que l’extraction des SVG a échoué {#pdf-はあるが-svg-が失敗した場合}

**Réussite partielle** indique que le PDF est prêt et que seule l’extraction des SVG a échoué. Enregistrez le PDF et relancez l’extraction sans le recompiler.

- **Application web.** Cliquez sur **Réessayer uniquement le SVG** dans les résultats.
- **CLI.** Exécutez cette commande.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Conditions et nombre maximal de tentatives**
- Vous disposez d’**au plus 8 tentatives**, première tentative comprise, tant que les sources et le PDF final sont disponibles et que l’environnement TeX du serveur reste inchangé. Les nouvelles tentatives ne prolongent pas la conservation des fichiers.
- Si le problème persiste, consultez les diagnostics sur la page de résultats ou dans `.render/svg/errors.json`.
- Si `SVG_RUNTIME_CHANGED` apparaît ou si le bouton est indisponible pour une ancienne tâche, [lancez une nouvelle conversion à partir du document original ou d’une révision enregistrée](/fr/docs/web/#以前の文書や結果を開く).

Consultez aussi [Téléchargements et nouvelles tentatives via l’API HTTP](/fr/docs/api/#pdfの先行公開とsvgの再試行) et la [spécification du traitement des sorties](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
