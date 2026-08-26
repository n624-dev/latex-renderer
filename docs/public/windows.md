---
slug: windows
category: インストール
title: Windows用PowerShell入口
description: 共通クライアントをWindowsへ導入するPowerShell手順です。
navOrder: 20
updated: "2026-08-11"
since: "v1.0.0"
---

## インストール

PowerShellで次を実行します。PowerShell用入口は[共通クライアント](/docs/client/)のNodeインストーラーを呼び出し、配布ZIPのサイズとSHA-256を検証します。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

APIキーは画面に表示されない入力欄へ貼り付け、Windows DPAPIで現在のWindowsユーザーに紐づけて保存します。完了後は新しいPowerShellを開きます。

## 最初の変換

```powershell
latex-render auth status
latex-render render C:\Users\you\Documents\latex-project --open
```

`--open` を付けると成功後にPDFを開きます。成果物は指定したプロジェクトの `.render` フォルダへ保存されます。

## 更新

インストールコマンドを再実行します。以前のクライアントは日時付きのバックアップフォルダへ移動します。

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
