---
slug: projects
category: Projets
title: Préparer les fichiers TeX et ZIP
description: Préparez vos sources, vérifiez les limites et testez un projet minimal avec LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Structure du projet {#構成}

- **Document composé d’un seul fichier.** Envoyez directement le `.tex` dans l’application web ou exécutez `n624-latex main.tex` avec la CLI.
- **Document avec images, bibliographie ou plusieurs sources.** Regroupez tout dans **une archive ZIP** en conservant les chemins relatifs. La CLI accepte également un dossier.
- **Créer le ZIP.** Sélectionnez le contenu du dossier, par exemple `main.tex` et `images/`, pour le compresser. Si vous incluez le dossier parent, vous devrez spécifier un chemin d’entrée tel que `project/main.tex` lors de la conversion.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Point d’entrée et chemins relatifs**
Le document principal par défaut est `main.tex` à la racine du projet. Même si vous choisissez un fichier `.tex` dans un sous-dossier, par exemple `docs/main.tex`, **la compilation s’exécute toujours depuis la racine du projet**. Pour inclure depuis `docs/main.tex` le fichier `body.tex` situé dans le même dossier, écrivez `\input{docs/body.tex}`. Si vous écrivez `\input{body.tex}`, le compilateur cherchera `body.tex` à la racine.

## Exemple minimal en japonais {#日本語の最小例}

Le moteur par défaut est **LuaLaTeX**. Pour essayer un document en japonais, enregistrez le texte suivant dans `main.tex` en UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Recherchez les paquets et polices disponibles dans l’[environnement de rendu](/app/environment/). La liste est établie à partir du conteneur du serveur lors du déploiement et sert également aux recherches dans Remote MCP. S’il manque un paquet, transmettez à l’administrateur le message correspondant de `compile.log`.

## Projets et révisions enregistrés {#保存projectと改訂}

Les documents convertis dans l’application web (`/app/`) sont enregistrés dans des projets.

- **Enregistrement automatique des révisions.** Chaque nouvelle combinaison du contenu, du document principal, du moteur et des formats de sortie est enregistrée comme révision du projet. Les révisions antérieures restent dans l’historique.
- **Reconvertir une ancienne révision.** Cliquez sur **Convertir à nouveau** pour utiliser le document et le moteur enregistrés. Si vous changez ici le format de sortie, le résultat rejoint l’historique des conversions de la même révision.
- **Partage et suppression.** L’application web, la CLI, l’API HTTP et MCP partagent les projets et révisions de l’utilisateur. La suppression d’un projet masque son enregistrement. Les entrées et sorties existantes sont nettoyées selon leur durée de conservation. Pour les effacer intégralement et immédiatement, contactez l’administrateur. Les sources référencées par des révisions actives comptent dans le quota de l’utilisateur. Consultez [Partage et conservation](/fr/docs/reference/#保存プロジェクトの共有-保持).

### Modifier dans le navigateur {#ブラウザーで編集する}

Ouvrez un projet enregistré et choisissez **Modifier le TeX**. Les modifications sont enregistrées dans le brouillon. Lorsque vous cessez la saisie, la compilation démarre et actualise le PDF si elle réussit. En cas d’échec de l’aperçu, le dernier PDF disponible et la version du brouillon correspondante restent consultables.

Un nouveau projet s’ouvre avec un fichier `main.tex` vide. Tant que le document principal est vide, vous pouvez choisir un modèle. Sélectionnez **Modifier à partir de cette révision** pour reprendre une version enregistrée. Si un brouillon existe, confirmez son remplacement.

Pour compiler uniquement à la demande, désactivez **Compilation automatique** et cliquez sur **Compiler**. Choisissez **Sorties de la version enregistrée** puis cliquez sur **Enregistrer une version** pour conserver le brouillon et ses réglages. Si vous souhaitez des SVG, ouvrez la révision enregistrée et cliquez sur **Convertir à nouveau**.
L’éditeur affiche l’état de la compilation et l’aperçu pendant votre travail.

## Fichiers exclus de l’envoi {#送信から除外されるもの}

- **Exclusions automatiques.** La CLI ignore `.git`, `.render` et les fichiers auxiliaires de LaTeX tels que `.aux`. Elle refuse les liens symboliques.
- **Fichiers non pris en charge.** Déplacez les dossiers inutiles tels que `node_modules` hors du projet. Si un dossier contient des fichiers dont l’extension n’est pas admise, la CLI affiche le chemin et s’arrête. Pour garder dans le projet un fichier comme `README.md` sans l’envoyer, ajoutez dans `.latexrenderignore` à la racine une ligne contenant `README.md`. Le serveur vérifie les mêmes règles d’extension dans le ZIP.
- **Extensions prises en charge** (sans distinction de casse)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  Les fichiers `.bst` sont des styles bibliographiques BibTeX et peuvent se trouver dans des sous-dossiers. Si un style personnalisé utilise une extension absente de la liste, consultez l’administrateur avant de la changer.

## Limites {#制限}

- **Nombre de fichiers.** Jusqu’à 500.
- **Tailles par défaut.** 20 Mio pour le ZIP, 100 Mio après extraction au total et 20 Mio par fichier.
- **Point d’entrée.** Chemin relatif d’un fichier `.tex` dans les sources. La valeur par défaut est `main.tex` à la racine.
- **Sécurité.** L’accès au shell depuis TeX (y compris `\write18`), l’exécution de commandes externes et les connexions au réseau extérieur sont désactivés.
- **Ressources.** L’administrateur fixe les limites de temps, de stockage par utilisateur et de conservation des résultats.
