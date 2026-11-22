---
slug: windows
category: インストール
title: Windows に CLI をインストール
description: PowerShell で CLI をインストールし、API キーを登録して PDF を作ります。
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

> [!NOTE]
> 次版以降の共通コマンドは `n624-latex` です。互換性のため `latex-render` も利用できます（現行 Stable を利用中の場合は `latex-render` を使ってください）。

## インストール

1. **Node.js 24 以降**と、サーバー管理者が発行した `lrk_` から始まる API キーを用意します。
2. PowerShell を開き（管理者権限ではなく通常のユーザー権限で構いません）、`node --version` でバージョンを確認してから次を実行します。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. 画面に表示されない非表示入力欄が開いたら API キーを貼り付けます。キーは Windows DPAPI で現在の Windows ユーザーに紐づけて暗号化保存されます。
4. 完了したら、PATH を反映するため**新しい PowerShell ウィンドウを開き直します**。

## 最初の変換

1. エクスプローラーで `main.tex` があるフォルダを開きます（試せるサンプル文書は[最短でPDFを作る](/docs/#最短でpdfを作る)にあります）。
2. エクスプローラーのアドレス欄に `powershell` と入力して Enter を押し、次を実行します。

```powershell
n624-latex main.tex
```

同じフォルダに `main.pdf` が生成されます。

`.render` フォルダに成果物一式を出力し、成功後に自動で PDF を開く場合は次を実行します。

```powershell
n624-latex auth status
n624-latex render . --open
```

現行 Stable では `latex-render render . --open` を使います。

## 更新

新しい PowerShell で `n624-latex setup`（旧版は `latex-render setup`）を実行するか、[インストール](#インストール)の手順を再実行します。クライアント本体が更新される際は、以前の版が日時付きのバックアップへ移動されます。

## APIキーだけを削除

クライアントを残したまま保存済みの API キーだけを削除したい場合は、次を実行します。

```powershell
n624-latex auth logout
```

## アンインストール

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

既定ではクライアント本体、保存済み API キー、管理対象の Codex・Claude 用 Skill を削除します。API キーや Skill を残したい場合は、末尾に `-KeepCredential` または `-KeepSkills` を付けて実行してください。
