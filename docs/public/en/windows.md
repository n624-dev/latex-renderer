---
slug: windows
category: Installation
title: Install the CLI on Windows
description: Install the CLI in PowerShell, register an API key, and create a PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Install {#インストール}

1. Install **Node.js 24 or later** and get an API key (`lrk_...`) from your server administrator.
2. Open PowerShell as your usual user and run these commands.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Paste your API key into the hidden input field. Windows encrypts the saved key for the current user.
4. After installation, open a **new PowerShell window**. If you [use a self-hosted server](/en/docs/cli/#接続先サーバー), set the server URL before converting.

To enter a different API key later, open setup with `n624-latex setup`.

## Compile your first document {#最初の変換}

1. In File Explorer, open the folder containing `main.tex`. You can use the [sample document](/en/docs/#最短でpdfを作る).
2. Type `powershell` in the File Explorer address bar and press Enter. In the new PowerShell window, run this command.

```powershell
n624-latex main.tex
```

The CLI creates `main.pdf` in the same folder. To compile ZIP files or download multiple artifacts, see [Rendering with the CLI](/en/docs/cli/#レンダリング).

## Update {#更新}

Run `n624-latex setup` in PowerShell and update the client from the setup screen.

> [!DETAILS] 履歴資料　Migrate from v1.6.9 or earlier
>
> Run the same installer as in the [installation steps](#インストール) with `-SkipCredential`. It adds `n624-latex` and retains the saved API key. If you chose a custom installation directory, [specify the same location](/en/docs/reference/#windowsの配置と保護). Existing scripts can continue to use `latex-render`.

## Remove only the API key {#apiキーだけを削除}

To keep the client installed and remove its saved API key, run this command.

```powershell
n624-latex auth logout
```

## Uninstall {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

By default, the script removes the client, its stored API key, and the managed Codex and Claude skills. To keep the key or skills, append `-KeepCredential` or `-KeepSkills` respectively.
