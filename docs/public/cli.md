---
slug: cli
category: CLI
title: CLI で変換と結果取得
description: ターミナルでTeXを変換し、PDF、ログ、プレビューを取得する方法です。
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

`main.tex` のあるフォルダで `n624-latex main.tex` を実行すると、同じフォルダに PDF を保存できます。初めて使う場合は[CLI のインストール](/docs/client/)で接続を設定します。

## 認証

通常はブラウザの設定画面を開いて API キーを保存します。

```sh
n624-latex setup --gui
```

SSH 接続先などブラウザを開けない環境では、コマンドライン引数に残さないよう**標準入力**から登録します（Bash / Zsh の例。1 行実行後にキーを貼り付けて Enter を押します）。

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Windows では[インストーラーの非表示入力](/docs/windows/#インストール)からも登録できます。

保存状態の確認とキーの削除は次のコマンドで行います。

```sh
n624-latex auth status
n624-latex auth logout
```

- 環境変数 `LATEX_RENDER_API_KEY` が設定されている場合は、ローカルに保存されたキーよりも優先されます。
- `logout` はローカルの保存済みキーだけを削除します。環境変数の解除や、サーバー側での API キー失効はそれぞれ別の操作です。

### 接続先サーバー

既定ではホスト済みサービス（`https://latex-render.n624.jp`）に接続します。セルフホスト環境を使う場合は、コマンドを実行するシェルでサーバーの HTTPS URL を指定してください。

- URL の末尾に `/app/` や `/api/v1/` は付けません。
- 必ずその接続先サーバーが発行した API キーを使用してください。

**Linux・macOS**：

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**：

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## セットアップと診断

接続や連携の設定は `n624-latex setup` で開きます。サーバーに接続できない場合は、まず以下で状態を確認します。`n624-latex` が見つからない場合は、[インストールと PATH の確認](/docs/troubleshooting/#インストール-ログイン)を参照してください。

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` はインストール状態や資格情報を読み取り専用で確認し、API キーの値を出力しません。問題が見つかった場合は終了コード `2` を返します。

| インストール方法 | 更新・修復・削除 |
| --- | --- |
| APT 版 | [APT で更新](/docs/client/#apt-版の更新)し、破損したパッケージは[再インストール](/docs/client/#状態確認と修復)します。Local MCP は[手動で登録](/docs/mcp/#local-mcpの登録)します。 |
| Homebrew 版 | [Homebrew で更新](/docs/client/#homebrew-版の更新)し、破損したパッケージは[再インストール](/docs/client/#状態確認と修復)します。AI 連携は `n624-latex setup` で設定できます。 |
| 配布インストーラー版 | [設定画面で更新](/docs/client/#配布インストーラー版の更新)します。管理対象の連携設定やランチャーは `n624-latex setup repair` で修復できます。 |

削除するときは[インストール方法別の手順](/docs/client/#アンインストール)を参照してください。設定画面は端末上だけで開き、CLI を終了すると画面も閉じます。

## レンダリング

### TeX ファイルを直接変換する

プロジェクトフォルダ内で `.tex` ファイルを直接指定して PDF を作れます。画像、参考文献、ローカルの `.sty` などもフォルダ内の相対パスで参照できます。

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- `-o` を省略すると、実行したフォルダに入力ファイルと同名の PDF（例：`main.pdf`）が出力されます。
- LaTeX エラーが発生した場合は、特定できたファイル名・行番号・ジョブ ID が表示されます。変換や取得に失敗した場合でも、前回正常に保存された PDF は消えずに保持されます。

#### LaTeX のエンジンを選ぶ

XeLaTeX を使うときは、ファイル名の前にエンジン名を書きます。

```sh
n624-latex xelatex main.tex
```

エンジンを省略した場合は、文書冒頭の `% !TeX program = xelatex` または
`% !TEX TS-program = xelatex` を参照します。文書に指定がなければ、実行する
プロジェクトの直下にある `.n624-latex.json` を参照します。このファイルを
Git で共有すると、別の端末でも同じエンジンを選べます。

```json
{"engine":"xelatex"}
```

指定がなければ LuaLaTeX を使います。pLaTeX と upLaTeX は、接続先の
Runtime に日本語コレクションがある場合に使えます。

| エンジン | 文書を移すときの確認 |
| --- | --- |
| LuaLaTeX | `fontspec` や LuaTeX-ja を使う文書の設定を確認します。 |
| pdfLaTeX | `fontspec` は使えません。pdfLaTeX 用のフォント設定を使います。 |
| XeLaTeX | `fontspec` を使えます。LuaTeX 専用のパッケージがないか確認します。 |
| pLaTeX / upLaTeX | エンジンに対応した日本語クラスを使います。`jsarticle` を upLaTeX で使う場合はクラスに `uplatex` を指定します。 |

書誌処理は文書のパッケージと設定に従います。`.bib` や独自の `.bst` は文書と一緒に送ります。pLaTeX と upLaTeX の BibTeX 文書では、対応する pBibTeX と upBibTeX が使われます。PDF・SVG・SVG の配置は、接続先の[レンダリング環境](/app/environment/)でそれぞれ確認できます。

### ZIP・複数の出力を指定する

ログ・プレビュー・SVG を含む成果物一式を取得する場合や、ZIP ファイルを指定する場合は `render` サブコマンドを使います。

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**実行例**：

```sh
# 現在のフォルダの main.tex を変換し、完了後に PDF を開く
n624-latex render . --open

# ZIP 内の特定の本文を指定し、PDF と SVG の両方を出力する
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- パスを省略すると現在のフォルダ、`--entrypoint` を省略すると `main.tex` が選ばれ、最大 500 ファイルを含む Source を準備して完了まで待機します（任意の相対 `.tex` パスを指定でき、サーバー側でも存在と安全性を検証します）。
- `--svg` を付けると、PDF に加えて外側の数式と最上位の TikZ 図を自己完結 SVG として抽出します。

### 同じ入力から複数の文書を作る（Source の再利用）

1 つのフォルダや ZIP から複数の本文を変換する場合は、先に `source upload` で 1 回だけアップロードして Source ID を使い回すと高速です。出力先（`--output`）はジョブごとに重ならないよう分けてください。

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] 保存先の整理・除外・重複アップロード省略の仕様を表示
>
> - **前回の生成物の整理**：同じ出力先を再利用すると、前回の `job.json` に記録された生成物のうち今回存在しない PDF・プレビュー・SVG だけを整理します。無関係な利用者ファイルは削除しません。
> - **保存先の安全性検査**：シンボリックリンクを含む保存先は拒否します。POSIX 環境では所有者と group / other の書き込み権限も検査します（Windows には POSIX mode ビット判定を適用しません）。
> - **出力先の自動除外**：`--output` にプロジェクト内のサブフォルダを指定した場合、そのフォルダだけを次回の入力 ZIP から除外します（似た名前の別フォルダは除外しません。また、プロジェクトルートそのものは出力先に指定できません）。
> - **重複送信の省略**：同じ所有者・同じ SHA-256 の有効な ZIP がサーバーにある場合、`uploadRequired: false` となり再送信は行われません。返された Source ID は同じ所有者内でのみ後続ジョブに利用できます。

## 保存Projectと改訂

サーバー上の保存プロジェクトと改訂（リビジョン）を CLI から管理・再変換できます。同じユーザーの Web・API・MCP・別の API キーと共有されます（一時的な `render` や `source upload` では保存プロジェクトの作成は不要です）。

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`**：ローカルのフォルダまたは ZIP を Source として準備し、指定プロジェクトに不変の改訂として保存します。`--svg` を付けると、その改訂の初回出力設定が PDF＋SVG になります。
- **`render`**：保存済みの改訂からジョブを作成します（`--svg` を付けた場合のみ出力設定を上書きします）。
- **`list` / `get` / `jobs`**：`--cursor` で続きのページを取得できます。
- **`delete`**：プロジェクト一覧の記録を非表示にする操作であり、既存のジョブを直ちに完全削除するものではありません。

## ジョブ操作

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **ダウンロードと待機**：ジョブ操作時は API キーで短時間トークンを更新します。`jobs download` は完了まで待ってから成果物を切り替えます（待機中に中断・失敗した場合、既存の保存済み一式は変更されません）。`delete` は終了済みジョブのみ対象です。
- **操作期限**：変換はアップロードから成果物取得まで全体で30分です。時間を超えても受付済みジョブはサーバーに残ります。同じジョブIDを使って `jobs get` や `jobs download` で確認を続けてください。
- **PNG プレビューの追加取得**：PNG は初期状態で 1 ページ目のみ生成されます。通常のダウンロードは生成済み PNG のみを取得し、`--preview-page 2 5` のように指定すると追加ページを生成・検証（サイズと SHA-256 を確認）して保存します。PDF の再コンパイルや保持期限の延長は行いません。
- **PDF の先行取得と SVG 再試行**：PDF＋SVG ジョブでは PDF が先に公開されるため、`--pdf-only` で SVG 完了を待たずに PDF を取得できます。SVG のみ失敗した場合は PDF を保存した上で部分成功となり、`retry-svg` で確定済み PDF を保ったまま SVG だけを再試行できます（初回を含め最大 8 回、保持期限の延長なし。Runtime が更新された場合は新規ジョブを作成してください。詳細：[PDFの先行公開とSVGの再試行](/docs/api/#pdfの先行公開とsvgの再試行)）。
- **通信エラー時の自動再試行**：状態確認中の一時的な通信障害は自動で再試行しますが、認証・権限エラーは再試行しません。CLI 側の待機が止まってもサーバー側で処理が続いている場合があるため、作り直さず同じ `<jobId>` を確認してください（詳細：[CLIの待機と再試行](/docs/reference/#cliの待機と再試行)）。

## 成果物

PDF の先行取得、PNG ページの指定、SVG の再試行手順は[PDF・PNG・SVG を取得する](/docs/outputs/)も参照してください。

| パス | 内容 |
| --- | --- |
| `.render/result.pdf` | 成功時の PDF |
| `.render/compile.log` | LaTeX コンパイルログ |
| `.render/errors.json` | 構造化されたエラー情報 |
| `.render/job.json` | 最終ジョブ状態 |
| `.render/previews/page-N.png` | ページプレビュー画像（最大 100 ページ） |
| `.render/svg/manifest.json` | SVG とソース位置・PDF 座標の対応表 |
| `.render/svg/objects/*.svg` | 数式・TikZ ごとの自己完結 SVG |

## JSON出力

すべての CLI コマンドに `--json` を付けると、進捗表示を混ぜずに標準出力へ 1 個の JSON オブジェクトだけを出力します（通常表示と同じ `client-core` の処理結果を使用し、API キーや短時間トークンは一切含めません）。

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

成功・失敗時のスキーマと終了コードは[CLIのJSON形式](/docs/reference/#cliのjson形式)を参照してください。
