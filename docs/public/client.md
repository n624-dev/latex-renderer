---
slug: client
category: インストール
title: クライアント
description: Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。
navOrder: 15
updated: "2026-08-11"
since: "v1.0.0"
---

## 対応環境

共通インストーラーと `latex-render setup` はOSを自動判定します。Node.js 24以降が必要です。

| OS      | 既定のインストール先                                                   | コマンド配置         |
| ------- | ---------------------------------------------------------------------- | -------------------- |
| Windows | `%LOCALAPPDATA%\LaTeXRenderer`                                         | 同フォルダ内の `bin` |
| Linux   | `$XDG_DATA_HOME/latex-renderer` または `~/.local/share/latex-renderer` | `~/.local/bin`       |
| macOS   | `~/Library/Application Support/LaTeXRenderer`                          | `~/.local/bin`       |

## Linux / macOS

```sh
curl -fsSLo /tmp/install-latex-renderer.mjs https://latex-render.n624.jp/downloads/client/install.mjs
node /tmp/install-latex-renderer.mjs
```

`~/.local/bin` が `PATH` にない場合は追加してください。インストーラーはCodex/Claude Codeが利用可能ならLocal MCPもユーザースコープへ登録します。APIキーは標準入力から登録します。

```sh
read -s LATEX_RENDER_API_KEY
printf '%s' "$LATEX_RENDER_API_KEY" | latex-render auth login --api-key-stdin
unset LATEX_RENDER_API_KEY
```

LinuxとmacOSでは資格情報を現在のユーザーだけが読めるmode `0600` の設定ファイルへ保存します。

## Windows

PowerShell用の入口も、内部では同じ共通インストーラーを呼び出します。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

WindowsではAPIキーを非表示入力で受け取り、現在のWindowsユーザーに紐づくDPAPIで暗号化して保存します。

## 更新

次のコマンド、または同じインストールコマンドを再実行します。

```text
latex-render setup
```

ブラウザで状態を確認しながら設定する場合は、OSにかかわらず次を使えます。

```text
latex-render setup --gui
```

Local Setup Web UIはloopbackのランダムポートだけを使用します。資格情報の保存、Codex/Claude SkillとMCPの選択、診断、固定サンプルのrender、更新、repairを同じ `setup-core` 経由で実行します。

配布ZIPのSHA-256が同じ場合は再配置せず、管理対象の設定だけを確認します。更新時は以前のクライアントを日時付きバックアップへ移動します。既存の別ランチャー、別MCP登録、変更済みSkillは上書きしません。

## 状態確認と修復

```text
latex-render setup status
latex-render doctor --json
latex-render setup repair
```

`doctor` は読み取り専用です。`repair` は `.install-state.json` で所有を確認できる項目だけを修復します。管理状態ファイル自体が不正な場合や、インストール先が管理対象でない場合は処理を停止します。

## アンインストール

Linux / macOS:

```sh
curl -fsSLo /tmp/uninstall-latex-renderer.mjs https://latex-render.n624.jp/downloads/client/uninstall.mjs
node /tmp/uninstall-latex-renderer.mjs
```

Windows:

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

インストール済みCLIからは `latex-render setup remove --yes` も利用できます。変更されたSkill、既存の別コマンド、変更されたMCP登録は削除しません。共通アンインストーラーでは `--keep-credential`、`--keep-skills` を指定して保持できます。Windows用入口では `-KeepCredential`、`-KeepSkills` を使います。
