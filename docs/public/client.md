---
slug: client
category: インストール
title: CLI のインストール
description: Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

> [!NOTE]
> 次版より、APT 版と配布インストーラー版（Windows・macOS・Linux）のすべてで共通コマンド `n624-latex` を使用します。既存の設定やスクリプトとの互換性のため `latex-render` コマンドも残されています（現行 Stable の配布インストーラーを利用中の場合は、`n624-latex` を `latex-render` に読み替えてください）。

## 対応環境

| 環境 | 推奨する導入方法 | 事前準備 |
| --- | --- | --- |
| Debian 12 / 13、Ubuntu 24.04 / 26.04（amd64・arm64） | **APT パッケージ** | API キーのみ（専用 Node.js 同梱） |
| Windows | **[PowerShell インストーラー](/docs/windows/)** | Node.js 24 以降、API キー |
| macOS / APT を使わない Linux | **[配布インストーラー](#linux-macos)** | Node.js 24 以降、API キー |

※ APT リポジトリが公開・案内されるまでは、Debian / Ubuntu でも下の[配布インストーラー](#linux-macos)を使ってください。

## Debian / Ubuntu の APT パッケージ

1. 配布サイトの `n624-latex.sources` を保存します（このリポジトリ専用の署名公開鍵が含まれています）。
2. ファイルを保存したフォルダで次を実行し、パッケージをインストールします。

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

※ パッケージをインストールしただけではサーバー構築は始まりません。サーバーとして運用する場合は、導入後に[サーバー設定ウィザード](/docs/server-setup/)を明示的に起動します。

3. 普段使う通常ユーザーでセットアップを開き、サーバー管理者が発行した API キー（`lrk_...`）を保存します。

```sh
n624-latex setup
```

4. `main.tex` のあるフォルダで変換を試します。

```sh
n624-latex main.tex
```

同じフォルダに `main.pdf` が保存されます。出力先の変更やエラーの確認方法は[TeX ファイルを直接変換する](/docs/cli/#tex-ファイルを直接変換する)を参照してください。

## 配布インストーラーの準備

APT を使わない環境では、**Node.js 24 以降**（`node --version` で確認）と、管理者が発行した `lrk_` から始まる API キーを用意します。インストールは root や管理者権限ではなく、普段使うユーザーで行います。

- **Windows**：[Windows に CLI をインストール](/docs/windows/)の手順へ進んでください。
- **Linux・macOS**：次の手順を実行します。

## Linux / macOS

1. ターミナルでインストーラーを一時フォルダにダウンロードし、Node.js で実行します。

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

`n624-latex --version`（旧版は `latex-render --version`）が `command not found` になる場合は、新しいターミナルを開き直してください。それでも見つからない場合は `export PATH="$HOME/.local/bin:$PATH"` を実行し、使用中のシェルの設定ファイル（`~/.bashrc` や `~/.zshrc` など）にも同じ行を追加します。

2. 設定画面をブラウザで開き、API キーを登録します。

```sh
n624-latex setup --gui
```

ブラウザを開けない環境では、[標準入力からキーを登録](/docs/cli/#認証)できます。セルフホスト環境へ接続する場合は、[接続先サーバーの指定](/docs/cli/#接続先サーバー)も確認してください。

### 最初の PDF を作る

`main.tex` があるフォルダで次を実行します（サンプル文書は[最短でPDFを作る](/docs/#最短でpdfを作る)にあります）。

```sh
n624-latex main.tex
```

プロジェクト全体を `.render/result.pdf` に出力して自動で開く場合は、次のサブコマンドも使えます。

```sh
n624-latex auth status
n624-latex render . --open
```

現行 Stable では `latex-render render . --open` を使います。

詳しいオプションは[CLI で変換と結果取得](/docs/cli/#レンダリング)を参照してください。

## Windows

[Windows の手順](/docs/windows/)では PowerShell を使用します。登録した API キーは Windows DPAPI によって現在の Windows ユーザーに紐づけて暗号化されます（[配置先の変更と PATH の修復](/docs/reference/#windowsの配置と保護)）。

## 更新

### APT 版の更新

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

保存済みの接続設定や API キーはそのまま引き継がれます（セルフホストのサーバー本体を更新する場合は[管理画面の更新操作](/docs/updates/)を使います）。

### 配布インストーラー版の更新

次のコマンドを実行するか、初回と同じインストールコマンドを再実行します。

```sh
n624-latex setup
```

ブラウザ画面で状態を確認しながら更新・設定したい場合は、OS を問わず次を使えます。

```sh
n624-latex setup --gui
```

> [!DETAILS] セットアップ・更新時の内部動作を表示
>
> - Local Setup Web UI（`setup --gui`）はループバック（`127.0.0.1`）のランダムポートのみを使用します。資格情報の保存、Codex / Claude Skill と MCP の選択、診断、固定サンプルの render、更新、repair をすべて共通の `setup-core` 経由で実行します。
> - 配布 ZIP の SHA-256 が導入済みの版と同じ場合はファイルを再配置せず、管理対象の設定だけを確認します。
> - クライアントを更新する際は、以前の版を日時付きバックアップへ移動します。既存の別ランチャー、別 MCP 登録、ユーザーが変更した Skill は上書きしません。

## 状態確認と修復

導入状態の確認には次のコマンドを使います（旧版は `latex-render` に読み替えてください）。

```sh
n624-latex setup status
n624-latex doctor --json
```

- `doctor` は読み取り専用で環境を診断します。
- 配布インストーラー版の `n624-latex setup repair` は、`.install-state.json` で所有権を確認できる項目を修復します。管理状態が不正な場合や、インストール先が管理対象外の場合は停止します。

## 成果物の保存と復旧

`render` や `jobs download` 実行時の保存先は `.render/result.pdf`・`job.json`・プレビュー画像などです。必ずコマンドが完了してからファイルを開いてください。

- **失敗・中断時の保護**：失敗時は以前の成果物一式を保持し、強制終了された場合も次回のダウンロード実行時に自動復旧します。出力先の隣に作られる `.latex-renderer-state` 管理フォルダは、処理中や復旧前に削除しないでください。
- **同時実行と使用中ファイル**：同じ保存先への同時書き込みは `OUTPUT_BUSY` エラーになります。前の処理を待ってから再試行してください。Windows で PDF を開いたままにしている場合は、閉じてから再試行します。
- **上限と制限**：各一式は最大 1 GiB・10,000 項目までです。切り替え中は新旧一式と一時領域分の空き容量が必要です。シンボリックリンクや別マウントを含む保存先は使用できません（詳細：[成果物の保存・復旧の仕様](/docs/reference/#成果物の保存-復旧の仕様)）。

## アンインストール

配布インストーラーで導入した CLI は、次のコマンドで削除できます。

```sh
n624-latex setup remove --yes
```

配布スクリプトからアンインストールする場合は OS ごとに次を実行します。

**Linux / macOS（配布インストーラー版）**：

```sh
curl -fsSLo /tmp/uninstall-latex-renderer.mjs https://latex-render.n624.jp/downloads/client/uninstall.mjs
node /tmp/uninstall-latex-renderer.mjs
```

**Windows**：

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

**APT 版（Debian / Ubuntu）**：`sudo apt remove n624-latex` でパッケージを削除できます（ユーザー設定を消す場合は先に `n624-latex auth logout` 等を実行します）。

※ ユーザーが変更した Skill、既存の別コマンド、変更された MCP 登録は削除されません。資格情報や Skill を残したい場合は、共通アンインストーラーでは `--keep-credential` / `--keep-skills`、Windows 用スクリプトでは `-KeepCredential` / `-KeepSkills` を指定します。
