---
slug: windows
category: インストール
title: Windows に CLI をインストール
description: PowerShell で CLI をインストールし、API キーを登録して PDF を作ります。
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## インストール

1. **Node.js 24 以降**と、サーバー管理者から受け取った API キー（`lrk_...`）を用意します。
2. 普段使うユーザーで PowerShell を開き、次のコマンドを実行します。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. 非表示の入力欄に API キーを貼り付けます。キーは現在の Windows ユーザー専用に暗号化して保存されます。
4. インストールが終わったら **新しい PowerShell** を開きます。[セルフホスト環境を使う場合](/docs/cli/#接続先サーバー)は接続先を指定してから変換します。

あとから API キーを登録し直すには `n624-latex setup` で設定画面を開きます。

## 最初の変換

1. エクスプローラーで `main.tex` があるフォルダを開きます。[最初のサンプル文書](/docs/#最短でpdfを作る)も使えます。
2. エクスプローラーのアドレス欄に `powershell` と入力して Enter を押します。開いた PowerShell で次を実行します。

```powershell
n624-latex main.tex
```

同じフォルダに `main.pdf` ができます。ZIP や複数の成果物を扱うには[CLI の変換手順](/docs/cli/#レンダリング)を参照してください。

## 更新

PowerShell で `n624-latex setup` を実行し、開いた設定画面から更新します。

> [!DETAILS] 履歴資料　v1.6.9 以前から移行する
>
> [インストール手順](#インストール)と同じインストーラーを `-SkipCredential` 付きで実行します。保存済みの API キーを引き継ぎ、`n624-latex` を追加します。インストール先を変更していた場合は[同じ場所を指定](/docs/reference/#windowsの配置と保護)してください。既存のスクリプトでは引き続き `latex-render` を使えます。

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
