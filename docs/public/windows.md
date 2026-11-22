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

Node.js 24 以降と、サーバー管理者が発行した `lrk_` から始まる API キーを用意します。PowerShell を開き、`node --version` でバージョンを確認してから次を実行します。通常のユーザー権限で利用できます。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

APIキーは画面に表示されない入力欄へ貼り付け、Windows DPAPIで現在のWindowsユーザーに紐づけて保存します。完了後は新しいPowerShellを開きます。

## 最初の変換

エクスプローラーで `main.tex` があるフォルダを開き、アドレス欄に `powershell` と入力して Enter を押します。試せる文書は[はじめに](/docs/#最短でpdfを作る)にあります。

```powershell
latex-render auth status
latex-render render . --open
```

`--open` を付けると成功後にPDFを開きます。成果物は指定したプロジェクトの `.render` フォルダへ保存されます。

## 更新

新しい PowerShell で `latex-render setup` を実行するか、上のインストール手順を繰り返します。クライアントを入れ替える場合は、以前の版を日時付きのバックアップに移動します。

## APIキーだけを削除

```powershell
latex-render auth logout
```

## アンインストール

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

既定ではクライアント、保存済みAPIキー、Codex・ClaudeのSkillを削除します。`-KeepCredential` または `-KeepSkills` でそれぞれ保持できます。
