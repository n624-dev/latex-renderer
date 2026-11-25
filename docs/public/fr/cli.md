---
slug: cli
category: CLI
title: Convertir des documents et télécharger les résultats avec la CLI
description: Compilez du TeX dans un terminal et téléchargez le PDF, les journaux et les aperçus.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Dans le dossier contenant `main.tex`, exécutez `n624-latex main.tex` pour y enregistrer le PDF. Pour une première utilisation, [installez la CLI](/fr/docs/client/) et configurez la connexion.

## Authentification {#認証}

Ouvrez l’interface de configuration dans un navigateur pour enregistrer la clé d’API.

```sh
n624-latex setup --gui
```

Si vous ne pouvez pas ouvrir de navigateur, par exemple en SSH, enregistrez la clé via l’**entrée standard** pour éviter qu’elle apparaisse dans les arguments de la commande. Sous Bash ou Zsh, exécutez la première ligne, collez la clé, appuyez sur Entrée et exécutez les lignes suivantes.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Sous Windows, vous pouvez aussi utiliser la [saisie masquée du programme d’installation](/fr/docs/windows/#インストール).

Les commandes suivantes vérifient si une clé est enregistrée puis permettent de la supprimer.

```sh
n624-latex auth status
n624-latex auth logout
```

- Lorsqu’elle est définie, la variable d’environnement `LATEX_RENDER_API_KEY` prime sur la clé locale.
- `logout` efface uniquement la clé enregistrée localement. Au besoin, désactivez séparément la variable d’environnement ou révoquez la clé sur le serveur.

### Choisir le serveur {#接続先サーバー}

Par défaut, la CLI se connecte au service hébergé (`https://latex-render.n624.jp`). Pour utiliser votre propre serveur, configurez son URL HTTPS dans la session du terminal où vous exécuterez les commandes.

- Omettez les suffixes `/app/` et `/api/v1/` dans l’URL.
- Utilisez une clé d’API émise par ce serveur.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Configuration et diagnostic {#セットアップと診断}

Ouvrez les paramètres de connexion et d’intégration avec `n624-latex setup`. En cas d’échec de connexion, commencez par vérifier l’état avec les commandes suivantes. Si `n624-latex` est introuvable, consultez [Installation et PATH](/fr/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` inspecte en lecture seule l’installation et les identifiants sans afficher la valeur de la clé d’API. Si un problème est détecté, le code de sortie est `2`.

| Installation | Mise à jour et réparation |
| --- | --- |
| APT | [Mettez à jour avec APT](/fr/docs/client/#apt-版の更新) ou [réinstallez](/fr/docs/client/#状態確認と修復) les paquets endommagés. [Inscrivez Local MCP manuellement](/fr/docs/mcp/#local-mcpの登録). |
| Homebrew | [Mettez à jour avec Homebrew](/fr/docs/client/#homebrew-版の更新) ou [réinstallez](/fr/docs/client/#状態確認と修復) les paquets endommagés. Configurez les intégrations IA avec `n624-latex setup`. |
| Programme d’installation à télécharger | [Mettez à jour depuis la configuration](/fr/docs/client/#配布インストーラー版の更新). Réparez les intégrations et lanceurs gérés avec `n624-latex setup repair`. |

Pour désinstaller, suivez les [instructions correspondant à votre méthode](/fr/docs/client/#アンインストール). L’interface de configuration est locale et se ferme à la fin de la CLI.

## Rendu {#レンダリング}

### Convertir directement un fichier TeX {#tex-ファイルを直接変換する}

Indiquez le fichier `.tex` du dossier de projet pour produire le PDF. Les images, la bibliographie et les fichiers `.sty` locaux peuvent être référencés par des chemins relatifs.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Si vous omettez `-o`, un PDF portant le même nom de base, par exemple `main.pdf`, est enregistré dans le dossier où vous avez exécuté la commande.
- En cas d’erreur LaTeX, le fichier, la ligne et l’identifiant de tâche sont affichés s’ils ont pu être identifiés. Le dernier PDF enregistré avec succès est conservé si la compilation ou le téléchargement échoue.

#### Choisir le moteur LaTeX {#latex-のエンジンを選ぶ}

Pour utiliser XeLaTeX, indiquez le nom du moteur avant le fichier.

```sh
n624-latex xelatex main.tex
```

Si vous omettez le moteur, la CLI recherche au début du document `% !TeX program = xelatex` ou
`% !TEX TS-program = xelatex`. En l’absence de directive, elle consulte
`.n624-latex.json` à la racine du projet. Vous pouvez partager ce fichier
dans Git pour utiliser le même moteur sur plusieurs machines.

```json
{"engine":"xelatex"}
```

En l’absence d’indication, LuaLaTeX est utilisé. Pour pLaTeX et upLaTeX,
l’environnement d’exécution du serveur doit inclure la collection japonaise.

| Moteur | Points à vérifier lors d’une migration |
| --- | --- |
| LuaLaTeX | Vérifiez la configuration des documents qui utilisent `fontspec` ou LuaTeX-ja. |
| pdfLaTeX | `fontspec` n’est pas pris en charge. Utilisez la configuration de polices pour pdfLaTeX. |
| XeLaTeX | `fontspec` est pris en charge. Vérifiez la présence de paquets réservés à LuaTeX. |
| pLaTeX / upLaTeX | Utilisez une classe de document japonaise adaptée au moteur. Pour `jsarticle` avec upLaTeX, indiquez l’option de classe `uplatex`. |

Le traitement bibliographique dépend des paquets et des réglages du document. Incluez les fichiers `.bib` et vos fichiers `.bst` personnalisés. Les documents BibTeX sous pLaTeX et upLaTeX utilisent respectivement pBibTeX et upBibTeX. Consultez l’[environnement de rendu](/app/environment/) pour les vérifications de PDF, de SVG et de position des SVG.

### Convertir un ZIP ou demander plusieurs sorties {#zip-複数の出力を指定する}

Utilisez la sous-commande `render` pour convertir un ZIP ou télécharger l’ensemble des sorties, y compris les journaux, aperçus et SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Exemples**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Le chemin par défaut est le dossier actuel et la valeur par défaut de `--entrypoint` est `main.tex`. La CLI prépare un jeu de sources de 500 fichiers au plus et attend la fin de la tâche. Le point d’entrée peut être le chemin relatif d’un fichier `.tex`. Le serveur vérifie la sûreté du chemin et l’existence du fichier.
- Avec `--svg`, les expressions mathématiques les plus externes et les schémas TikZ de premier niveau sont également extraits sous forme de SVG distincts.

### Réutiliser les sources de plusieurs documents {#同じ入力から複数の文書を作る-source-の再利用}

Si un dossier ou un ZIP comprend plusieurs documents principaux, envoyez les sources une seule fois avec `source upload` et réutilisez leur identifiant. Utilisez un dossier de sortie (`--output`) différent par tâche.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Nettoyage de la destination, exclusions et doublons
>
> - **Nettoyage des sorties précédentes.** Lorsqu’une destination est réutilisée, seuls les PDF, aperçus et SVG inscrits dans le `job.json` précédent et absents du nouveau résultat sont retirés. Les fichiers de l’utilisateur étrangers à la tâche sont conservés.
> - **Contrôle de la destination.** Les chemins contenant des liens symboliques sont refusés. Sous POSIX, le propriétaire et les permissions d’écriture du groupe et des autres utilisateurs sont également contrôlés. Sous Windows, les bits de mode POSIX ne sont pas vérifiés.
> - **Exclusion du dossier de sortie.** Si `--output` désigne un sous-dossier du projet, seul ce dossier est exclu du ZIP suivant. Les dossiers de nom similaire restent inclus. La racine du projet ne peut pas servir de destination.
> - **Envois en double.** Si le serveur conserve un ZIP valide du même propriétaire avec le même SHA-256, il renvoie `uploadRequired: false` et évite le transfert. Seul ce propriétaire peut utiliser l’identifiant des sources pour d’autres tâches.

## Projets et révisions enregistrés {#保存projectと改訂}

La CLI permet de gérer et de recompiler les projets et révisions du serveur. Le web, l’API, MCP et les autres clés du même utilisateur partagent ces projets. Les opérations temporaires `render` et `source upload` ne nécessitent pas d’enregistrer un projet.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** prépare un dossier ou un ZIP comme jeu de sources et enregistre une révision immuable dans le projet. Avec `--svg`, les formats de sortie initiaux de la révision sont PDF et SVG.
- **`render`** crée une tâche à partir d’une révision enregistrée. Seul `--svg` remplace les paramètres de sortie.
- **`list`, `get` et `jobs`** acceptent `--cursor` pour obtenir la page suivante.
- **`delete`** masque le projet dans la liste. Les tâches existantes ne sont pas supprimées immédiatement.

## Opérations sur les tâches {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Téléchargement et attente.** Ces commandes utilisent la clé d’API pour renouveler un jeton de courte durée. `jobs download` attend la fin de la tâche avant de remplacer les fichiers enregistrés. En cas d’échec ou d’interruption de l’attente, les fichiers précédents sont conservés. `delete` s’applique uniquement aux tâches terminées.
- **Obtenir davantage d’aperçus PNG.** Initialement, seule la première page est générée. Le téléchargement normal récupère les PNG déjà produits. Utilisez par exemple `--preview-page 2 5` pour générer ces pages, vérifier leur taille et leur SHA-256 et les enregistrer. Le PDF n’est pas recompilé et sa conservation n’est pas prolongée.
- **Télécharger le PDF en avance et relancer les SVG.** Pour une tâche PDF et SVG, utilisez `--pdf-only` pour obtenir le PDF sans attendre les SVG. Si seule l’extraction SVG échoue, le PDF est conservé et la réussite est partielle. `retry-svg` relance uniquement l’extraction. Huit tentatives sont admises, première comprise, sans prolongation de la conservation. Si l’environnement d’exécution a changé, créez une autre tâche. Consultez [Disponibilité anticipée du PDF et nouvelle tentative SVG](/fr/docs/api/#pdfの先行公開とsvgの再試行).
- **Nouvelles tentatives après un problème réseau.** Les erreurs transitoires de consultation de l’état donnent lieu à de nouvelles tentatives. Les erreurs d’authentification et de permission sont renvoyées immédiatement. Si la CLI cesse d’attendre, le serveur peut poursuivre la tâche. Consultez le même `<jobId>` avant d’en créer une autre. Voir [Attente et nouvelles tentatives de la CLI](/fr/docs/reference/#cliの待機と再試行).

## Fichiers de sortie {#成果物}

Pour télécharger le PDF en avance, choisir les pages PNG ou relancer les SVG, consultez [Obtenir les PDF, PNG et SVG](/fr/docs/outputs/).

| Chemin | Contenu |
| --- | --- |
| `.render/result.pdf` | PDF généré avec succès |
| `.render/compile.log` | Journal de la compilation LaTeX |
| `.render/errors.json` | Détails structurés des erreurs |
| `.render/job.json` | État final de la tâche |
| `.render/previews/page-N.png` | Aperçus, jusqu’à 100 pages |
| `.render/svg/manifest.json` | Correspondance entre SVG, positions dans les sources et coordonnées du PDF |
| `.render/svg/objects/*.svg` | SVG distinct pour chaque expression mathématique ou schéma TikZ |

## Sortie JSON {#json出力}

Ajoutez `--json` à une commande pour écrire un seul objet JSON sur la sortie standard sans messages d’avancement. Il utilise le même résultat de `client-core` que l’affichage ordinaire et exclut les clés d’API et les jetons de courte durée.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Consultez le [format JSON de la CLI](/fr/docs/reference/#cliのjson形式) pour les schémas de réussite et d’erreur et les codes de sortie.
