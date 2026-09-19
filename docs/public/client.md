---
slug: client
category: インストール
title: クライアント
description: Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。
navOrder: 15
updated: "2026-09-19"
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

Windowsでインストール先を変更すると、既定のコマンド配置先もその配下の `bin` になります。
`LATEX_RENDER_BIN_DIRECTORY` を別途指定した場合は、その場所へ管理対象のランチャーを設置し、
同じ場所をユーザーのPATHとLocal MCPで使います。既存の別ランチャーは上書きしません。
以前の版が別のPATHを記録していた場合は `setup repair` で修正できます。
旧PATH項目は他の用途との競合を避けるため保持します。インストール先とbinには絶対パスを使い、
PATH区切りのセミコロンや引用符・制御文字を含めないでください。

PDFやセットアップ画面を開く処理が失敗しても、保存済みPDFは削除しません。
表示されたパスまたはセットアップURLから手動で開けます。

## 成果物の保存と復旧

CLIとLocal MCPは `.render/result.pdf`・`job.json`・プレビューなどの既存パスを維持します。
広告されたサイズとSHA-256を全ファイルで確認し、一式が揃ってからフォルダーを切り替えます。
切替の瞬間だけフォルダーが見えないことがありますが、新旧のファイルを一つのフォルダーへ
順次上書きすることはありません。複数のファイルを個別に開く外部プログラムが切替をまたいで
読む場合は、同じ世代を読む保証はありません。コマンドの完了後に読み込んでください。

出力先の兄弟に `<出力名>.latex-renderer-state` という小さい管理フォルダーを置きます。
通常の終了時に一時データを削除し、強制終了時の残りは次回のダウンロード開始時に復旧します。
確定前なら旧一式に戻し、確定後なら新一式を保持して古い一式を整理します。
この領域はSourceへのファイル収集から除外されます。処理中・復旧前に手動削除しないでください。

同じ出力先へ同時に保存すると `OUTPUT_BUSY` で停止します。先の処理が完了してから再試行してください。
時間経過だけでは実行中の処理を排除しません。PIDが再利用された場合も安全側に停止します。
管理情報の破損や未知のファイル、外部リンクを見つけた場合は、自動削除せず原因の確認を求めます。

利用者が置いた通常ファイルは次の一式へコピーして引き継ぎます。ダウンロード中の手動編集を
検出した場合は公開を中止して編集内容を残します。出力先は専用フォルダーを使ってください。
既存/新規の一式は各1 GiB・10,000項目までで、切替中は旧/新一式とダウンロード用一時領域が必要です。
symlink・hardlink・別ファイルシステムのmountを含む出力は処理しません。
ローカルファイルシステムを対象とし、ネットワーク共有上のプロセス間排他や電源断時の完全な
原子性は保証しません。Windowsでファイルが開かれていて切替できない場合も旧一式を保持し、再試行します。

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
