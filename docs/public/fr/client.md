---
slug: client
category: Installation
title: Installer la CLI
description: Installez la CLI sous Windows, macOS ou Linux et créez votre premier PDF depuis le terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Plateformes prises en charge {#対応環境}

Installez la CLI avec la méthode adaptée à votre système et enregistrez la clé d’API (`lrk_...`) fournie par l’administrateur. Le serveur compile les documents LaTeX.

| Plateforme | Méthode | Node.js |
| --- | --- | --- |
| Debian 12 / 13 ou Ubuntu 24.04 / 26.04 (amd64 ou arm64) | **[Paquet APT](#debian-ubuntu-の-apt-パッケージ)** | Inclus |
| Windows | **[Instructions pour Windows](/fr/docs/windows/)** | 24 ou ultérieur |
| macOS (Apple Silicon ou Intel) | **[Homebrew](#homebrew-でインストール)** | Installé par Homebrew |
| macOS ou autre distribution Linux | **[Programme d’installation à télécharger](#linux-macos)** | 24 ou ultérieur |

## Installer avec APT sous Debian ou Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Téléchargez `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Ce fichier contient la clé publique de signature du dépôt APT de LaTeX Renderer.
2. Dans le dossier où vous l’avez enregistré, exécutez ces commandes pour installer le paquet.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Passez à [Créer son premier PDF](#最初の-pdf-を作る). Pour installer un serveur, suivez les [instructions d’auto-hébergement](/fr/docs/self-hosting/).

## Installer avec Homebrew {#homebrew-でインストール}

Exécutez ces commandes sur un Mac équipé de Homebrew.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Après avoir enregistré la clé d’API, passez à [Créer son premier PDF](#最初の-pdf-を作る).

### Passer du programme d’installation à Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Vous pouvez conserver la clé d’API et la configuration MCP. Exécutez `type -a n624-latex` pour vérifier quelle commande est trouvée en premier par le shell. Si l’ancienne installation a priorité, exécutez directement la version de Homebrew.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Pour que `n624-latex` utilise la version de Homebrew, placez dans le `PATH` du shell le répertoire `bin` de Homebrew avant celui de l’ancienne installation.

Pour changer également de Local MCP, modifiez la commande de l’entrée `latex-renderer` dans votre outil d’IA afin qu’elle utilise le chemin absolu de `bin/latex-renderer-mcp` fourni par Homebrew. Utilisez `brew --prefix` pour trouver l’installation.

Avant de supprimer l’ancienne version, redémarrez l’outil d’IA et vérifiez qu’il se connecte au Local MCP de Homebrew. Désinstallez l’ancien lanceur en indiquant son chemin absolu et conservez la clé et les compétences. Pour une installation à l’emplacement par défaut, exécutez cette commande.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Préparer le programme d’installation à télécharger {#配布インストーラーの準備}

Installez **Node.js 24 ou ultérieur** sous votre compte habituel et vérifiez la version avec `node --version`. Sous Windows, suivez les [instructions pour Windows](/fr/docs/windows/).

## Linux et macOS {#linux-macos}

Dans un terminal, téléchargez le programme d’installation dans un dossier temporaire et exécutez-le avec Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Si `n624-latex` est introuvable, ouvrez un nouveau terminal. Si le problème persiste, exécutez `export PATH="$HOME/.local/bin:$PATH"` et ajoutez la même ligne au fichier de configuration du shell, par exemple `~/.bashrc` ou `~/.zshrc`.

## Créer son premier PDF {#最初の-pdf-を作る}

1. Ouvrez la configuration sous votre compte habituel et enregistrez la clé d’API. Si vous hébergez le service, [indiquez d’abord le serveur](/fr/docs/cli/#接続先サーバー). Si vous ne pouvez pas ouvrir de navigateur, [enregistrez la clé via l’entrée standard](/fr/docs/cli/#認証).

```sh
n624-latex setup
```

2. Exécutez cette commande dans le dossier contenant `main.tex`. Vous pouvez utiliser le [document d’exemple](/fr/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

Le fichier `main.pdf` est créé dans le même dossier. Pour choisir un autre emplacement ou utiliser des ZIP, PDF et SVG, consultez [Convertir et télécharger avec la CLI](/fr/docs/cli/#レンダリング).

## Windows {#windows}

Les [instructions pour Windows](/fr/docs/windows/) utilisent PowerShell. Windows DPAPI chiffre la clé enregistrée pour l’utilisateur actuel. Consultez [Modifier l’emplacement et réparer le PATH](/fr/docs/reference/#windowsの配置と保護).

## Mises à jour {#更新}

### Mettre à jour le paquet APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

La connexion et la clé d’API enregistrées sont conservées. Pour mettre à jour le serveur que vous hébergez, utilisez la [page Mises à jour de l’administration](/fr/docs/updates/).

### Mettre à jour le paquet Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Mettre à jour le client installé avec le programme à télécharger {#配布インストーラー版の更新}

Exécutez cette commande ou reprenez la commande utilisée pour l’installation initiale.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Mettre à jour les clients en version 1.6.9 ou antérieure
>
> Si seul `latex-render` est installé, relancez l’installation. [Sous Windows, la mise à jour conserve votre clé enregistrée](/fr/docs/windows/#更新). Sous macOS et Linux, vous pouvez également mettre à jour avec `latex-render setup` et ajouter la nouvelle commande avec `latex-render setup repair`. Les scripts existants peuvent continuer d’utiliser `latex-render`.

> [!DETAILS] Fonctionnement de l’installation et des mises à jour
>
> - Si le SHA-256 du ZIP à télécharger correspond à la version installée, le programme vérifie la configuration qu’il gère sans réinstaller les fichiers.
> - Lors d’une mise à jour, il déplace l’ancienne version dans une sauvegarde horodatée. Les autres lanceurs, les inscriptions MCP et les compétences modifiées par l’utilisateur sont conservés.

## Vérifier et réparer l’installation {#状態確認と修復}

Ces commandes vérifient l’état de l’installation, quelle que soit la méthode utilisée.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Pour APT, réinstallez le paquet avec `sudo apt install --reinstall n624-latex`.
- Pour Homebrew, réinstallez le paquet avec `brew reinstall n624-dev/tap/n624-latex`.
- Pour le programme d’installation à télécharger, réparez les lanceurs et intégrations gérés avec `n624-latex setup repair`.

## Enregistrer et récupérer les fichiers de sortie {#成果物の保存と復旧}

`n624-latex main.tex` enregistre le PDF dans le dossier actuel. Pour les PDF, journaux et images enregistrés par `render` et `jobs download`, consultez [Fichiers de sortie de la CLI](/fr/docs/cli/#成果物). Si le dossier de destination est occupé, consultez le [guide de dépannage](/fr/docs/troubleshooting/#成果物の取得).

## Désinstallation {#アンインストール}

Désinstallez le paquet APT avec `sudo apt remove n624-latex`. Pour supprimer également la clé de l’utilisateur, exécutez `n624-latex auth logout` avant la désinstallation.

Désinstallez le paquet Homebrew avec `brew uninstall n624-dev/tap/n624-latex`. La clé enregistrée et la configuration MCP de votre outil d’IA sont conservées. Si elles sont devenues inutiles, déconnectez-vous avant de désinstaller et supprimez la configuration MCP dans l’outil d’IA.

Pour le programme d’installation à télécharger, exécutez cette commande.

```sh
n624-latex setup remove --yes
```

Pour conserver les identifiants ou les compétences, ajoutez respectivement `--keep-credential` ou `--keep-skills`. Pour désinstaller avec le script Windows, consultez les [instructions pour Windows](/fr/docs/windows/#アンインストール).
