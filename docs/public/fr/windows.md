---
slug: windows
category: Installation
title: Installer la CLI sous Windows
description: Installez la CLI depuis PowerShell, enregistrez votre clé d’API et créez un PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installation {#インストール}

1. Prévoyez **Node.js 24 ou ultérieur** et une clé d’API (`lrk_...`) fournie par l’administrateur.
2. Ouvrez PowerShell avec votre compte habituel et exécutez ces commandes.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Collez la clé dans le champ de saisie masqué. Windows la chiffre et l’enregistre pour l’utilisateur actuel.
4. Après l’installation, ouvrez **une nouvelle fenêtre PowerShell**. Si vous [utilisez votre propre serveur](/fr/docs/cli/#接続先サーバー), indiquez son adresse avant la conversion.

Pour enregistrer une autre clé, ouvrez la configuration avec `n624-latex setup`.

## Première conversion {#最初の変換}

1. Dans l’Explorateur de fichiers, ouvrez le dossier contenant `main.tex`. Vous pouvez utiliser le [document d’exemple](/fr/docs/#最短でpdfを作る).
2. Saisissez `powershell` dans la barre d’adresse de l’Explorateur et appuyez sur Entrée. Exécutez la commande ci-dessous dans la fenêtre PowerShell qui s’ouvre.

```powershell
n624-latex main.tex
```

Le fichier `main.pdf` est créé dans le même dossier. Pour utiliser un ZIP ou télécharger plusieurs fichiers, consultez le [guide de conversion avec la CLI](/fr/docs/cli/#レンダリング).

## Mise à jour {#更新}

Exécutez `n624-latex setup` dans PowerShell et mettez à jour le client depuis l’écran de configuration.

> [!DETAILS] 履歴資料　Migrer depuis la version 1.6.9 ou une version antérieure
>
> Relancez le programme des [instructions d’installation](#インストール) avec `-SkipCredential`. Votre clé enregistrée est conservée et `n624-latex` est ajouté. Si vous aviez changé le dossier d’installation, [indiquez le même emplacement](/fr/docs/reference/#windowsの配置と保護). Les scripts existants peuvent continuer d’utiliser `latex-render`.

## Supprimer uniquement la clé d’API {#apiキーだけを削除}

Pour conserver le client et effacer uniquement la clé enregistrée, exécutez cette commande.

```powershell
n624-latex auth logout
```

## Désinstallation {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Par défaut, le client, la clé d’API enregistrée et les compétences gérées pour Codex et Claude sont supprimés. Pour conserver les identifiants ou les compétences, ajoutez respectivement `-KeepCredential` ou `-KeepSkills`.
