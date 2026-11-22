---
slug: client
category: インストール
title: CLI のインストール
description: Windows、macOS、LinuxにCLIを導入し、ターミナルから最初のPDFを作ります。
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## 対応環境

OSに合う方法でインストールし、サーバー管理者から受け取った API キー（`lrk_...`）を登録します。LaTeX の変換処理はサーバーで行います。

| 環境 | インストール手順 | Node.js の準備 |
| --- | --- | --- |
| Debian 12 / 13、Ubuntu 24.04 / 26.04（amd64・arm64） | **[APT パッケージ](#debian-ubuntu-の-apt-パッケージ)** | パッケージに同梱 |
| Windows | **[Windows の手順](/docs/windows/)** | 24 以降 |
| macOS / その他の Linux | **[配布インストーラー](#linux-macos)** | 24 以降 |

## Debian / Ubuntu の APT パッケージ

1. [`n624-latex.sources` をダウンロード](https://apt.n624.jp/latex-renderer/n624-latex.sources)します。ファイルには LaTeX Renderer の APT 署名公開鍵が含まれています。
2. ファイルを保存したフォルダで次を実行し、パッケージをインストールします。

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. [最初の PDF を作る](#最初の-pdf-を作る)へ進みます。サーバーを構築する場合は[セルフホストの導入手順](/docs/self-hosting/)へ進みます。

## 配布インストーラーの準備

配布インストーラーを使う場合は、普段使うユーザーで **Node.js 24 以降**を用意します。`node --version` で確認できます。Windows では[Windows の手順](/docs/windows/)を使います。

## Linux / macOS

ターミナルでインストーラーを一時フォルダにダウンロードし、Node.js で実行します。

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

`n624-latex` が見つからない場合は、新しいターミナルを開きます。引き続き見つからなければ、`export PATH="$HOME/.local/bin:$PATH"` を実行し、使用中のシェルの設定ファイル（`~/.bashrc` や `~/.zshrc` など）にも同じ行を追加します。

## 最初の PDF を作る

1. 普段使うユーザーで設定画面を開き、API キーを保存します。セルフホスト環境に接続するときは、先に[接続先サーバーを指定](/docs/cli/#接続先サーバー)します。ブラウザのない環境では[標準入力からキーを登録](/docs/cli/#認証)できます。

```sh
n624-latex setup
```

2. `main.tex` があるフォルダで次を実行します。[最初のサンプル文書](/docs/#最短でpdfを作る)も使えます。

```sh
n624-latex main.tex
```

同じフォルダに `main.pdf` ができます。出力先の指定や、ZIP・PDF・SVG を扱うコマンドは[CLI で変換と結果取得](/docs/cli/#レンダリング)を参照してください。

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

> [!DETAILS] 履歴資料　v1.6.9 以前のクライアントを更新する
>
> `latex-render` だけが入っている環境では、インストール手順を再実行します。[Windows では保存済みの API キーを再入力せずに更新できます](/docs/windows/#更新)。macOS と Linux では、`latex-render setup` で更新してから `latex-render setup repair` で新しいコマンドを追加する方法も使えます。既存のスクリプトでは引き続き `latex-render` が使えます。

> [!DETAILS] セットアップ・更新時の内部動作を表示
>
> - 配布 ZIP の SHA-256 が導入済みの版と同じ場合はファイルを再配置せず、管理対象の設定だけを確認します。
> - クライアントを更新する際は、以前の版を日時付きバックアップへ移動します。既存の別ランチャー、別 MCP 登録、ユーザーが変更した Skill は上書きしません。

## 状態確認と修復

導入方式を問わず、次のコマンドで状態を確認できます。

```sh
n624-latex setup status
n624-latex doctor --json
```

- APT 版は `sudo apt install --reinstall n624-latex` でパッケージを再インストールします。
- 配布インストーラー版は `n624-latex setup repair` で管理対象のランチャーや連携設定を修復します。

## 成果物の保存と復旧

`n624-latex main.tex` で作った PDF は現在のフォルダに保存されます。`render` や `jobs download` で保存するPDF、ログ、画像については[CLI の成果物](/docs/cli/#成果物)を参照してください。保存先が使用中の場合は[問題解決ガイド](/docs/troubleshooting/#成果物の取得)を確認してください。

## アンインストール

APT 版は `sudo apt remove n624-latex` で削除します。ユーザーの API キーも消したいときは、削除前に `n624-latex auth logout` を実行します。

配布インストーラー版は次のコマンドで削除します。

```sh
n624-latex setup remove --yes
```

配布インストーラー版で資格情報や Skill を残す場合は、`--keep-credential` または `--keep-skills` を指定します。Windows 用スクリプトで削除する場合は[Windows の手順](/docs/windows/#アンインストール)を参照してください。
