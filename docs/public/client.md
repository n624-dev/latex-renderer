---
slug: client
category: インストール
title: CLI のインストール
description: Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## 対応環境

Debian 12／13 と Ubuntu 24.04／26.04（amd64・arm64）では、APT でクライアントを導入できます。Windows・macOS や APT リポジトリを登録できない環境では、このページの[配布インストーラー](#linux-macos)を使います。

## Debian / Ubuntu の APT パッケージ

最初に配布サイトの `n624-latex.sources` を保存します。ファイルには、このリポジトリだけに使う署名公開鍵が含まれます。ダウンロードしたフォルダで次を実行します。

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

公開されたリポジトリが案内されるまでは、下の配布インストーラーを使ってください。APT 版には専用の Node.js が含まれます。サーバーを運用する場合は、インストール後に[サーバー設定ウィザード](/docs/server-setup/)を明示的に起動します。

通常のユーザーで設定を開き、サーバーが発行した API キーを保存します。

```text
n624-latex setup
```

`main.tex` のあるフォルダで変換します。

```text
n624-latex main.tex
```

`main.pdf` がそのフォルダに保存されます。別の出力先やエラーの読み方は[TeX ファイルを直接変換する](/docs/cli/#tex-ファイルを直接変換する)を参照してください。

## 配布インストーラーの準備

Node.js 24 以降と、サーバー管理者が発行した `lrk_` から始まる API キーを用意します。Node.js のバージョンは `node --version` で確認できます。インストールは普段使うユーザーで行います。

- **Windows** — [PowerShell の手順](/docs/windows/)でインストールから最初の PDF まで進めます。
- **Linux・macOS** — この下の手順を実行します。

## Linux / macOS

ターミナルでインストーラーをダウンロードし、Node.js で実行します。

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

`latex-render --version` が「command not found」となる場合は、新しいターミナルを開いてください。まだ見つからない場合は `export PATH="$HOME/.local/bin:$PATH"` を実行します。以後も使うには、使用しているシェルの起動設定に同じ行を追加します。

次に設定画面を開き、サーバーから発行された API キーを登録します。

```text
latex-render setup --gui
```

ブラウザを開けない環境では、[標準入力からキーを登録](/docs/cli/#認証)できます。セルフホストを使う場合は、[接続先サーバーの指定](/docs/cli/#接続先サーバー)も確認してください。

### 最初の PDF を作る

`main.tex` があるフォルダで次を実行します。試せる文書は[はじめに](/docs/#最短でpdfを作る)にあります。

```text
latex-render auth status
latex-render render . --open
```

PDF は `.render/result.pdf` に保存されます。`--open` を付けると完了後に開きます。[変換対象や出力先を指定する](/docs/cli/#レンダリング)

## Windows

[Windows の手順](/docs/windows/)では PowerShell を使用します。API キーは現在の Windows ユーザーに紐づけて暗号化されます。[配置先の変更と PATH の修復](/docs/reference/#windowsの配置と保護)

## 成果物の保存と復旧

保存先は `.render/result.pdf`・`job.json`・プレビューなどのです。コマンドが完了してから開いてください。失敗時は以前の一式を保持し、強制終了後は次のダウンロードで復旧します。

同じ保存先への同時書込みは `OUTPUT_BUSY` になります。処理を待って再試行してください。出力先の隣にある `.latex-renderer-state` 管理フォルダーは、処理中や復旧前に削除しないでください。

各一式は1 GiB・10,000項目までで、切替中は旧・新一式と一時領域の空きが必要です。リンクや別のマウントを含む保存先は使用できません。Windowsでファイルが使用中の場合は閉じて再試行します。[保存・復旧の詳しい仕様](/docs/reference/#成果物の保存-復旧の仕様)も参照してください。

## 更新

APT 版は `sudo apt update` の後に `sudo apt install --only-upgrade n624-latex` で更新します。接続設定や API キーは今のユーザーのまま使えます。サーバーアプリケーションは[管理画面の更新操作](/docs/updates/)で更新します。

配布インストーラーで導入した場合は以下の手順を使います。

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
