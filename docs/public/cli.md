---
slug: cli
category: CLI
title: CLI
description: 実装済みのコマンドと保存される成果物を説明します。
navOrder: 30
updated: "2026-10-19"
since: "v1.0.0"
---

## 認証

```powershell
$env:LATEX_RENDER_API_KEY | latex-render auth login --api-key-stdin
latex-render auth status
latex-render auth logout
```

`login` は標準入力だけを受け付けます。コマンドライン引数へAPIキーを含めないでください。環境変数 `LATEX_RENDER_API_KEY` が設定されている間は、保存済み資格情報より優先されます。

## セットアップと診断

```text
latex-render setup
latex-render setup --gui
latex-render setup status
latex-render setup repair
latex-render doctor
latex-render setup remove --yes
```

`setup` はOSを自動判定し、公開配布物のSHA-256を検証してCLI、Local MCP、Skill、ランチャーをインストールまたは更新します。同じ配布物に対する再実行は冪等です。CodexまたはClaude Codeが導入済みなら、ユーザースコープの `latex-renderer` MCP登録も作成します。

`setup --gui` はブラウザでLocal Setup Web UIを開きます。外部へlistenせず、`127.0.0.1` のランダムポートで、この起動専用の一回限りURLを使います。画面から資格情報、Codex/Claude連携、診断、サンプルrender、更新、repairを操作できます。CLIを終了すると画面も利用できなくなります。

既存の同名ランチャー、MCP登録、変更済みSkillなど、管理状態から所有を確認できない設定は上書きしません。`setup repair` も管理対象だけを修復し、`setup remove --yes` はこのセットアップが作成した項目だけを削除します。

APIキーも同時に保存する場合は、引数ではなく標準入力を使います。

```text
latex-render setup --api-key-stdin
latex-render setup repair --api-key-stdin
latex-render doctor --json
```

`doctor` はNode.js、OS、PATH、配布ファイル、資格情報の保護状態、Skill、MCP登録を読み取り専用で診断します。APIキー自体は出力しません。診断が未導入またはdegradedの場合は終了コード `2` です。

`setup --gui` は対話操作なので `--json` または `--api-key-stdin` と同時には使えません。

## レンダリング

```text
latex-render render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

パスを省略すると現在のフォルダを使います。`--entrypoint` を省略した場合は `main.tex` を選び、最大500ファイルを含むSourceを準備して終了状態まで待ちます。`--svg` を付けるとPDFに加えて外側の数式と最上位TikZ図をSVGへ抽出します。任意の相対 `.tex` パスを指定でき、最終的な存在確認と安全性検証はサーバー側でも行われます。

同じディレクトリまたはZIPから複数文書を作る場合は、Sourceを1回だけアップロードして使い回します。各Jobの出力先は重ならないよう指定してください。

同じ出力先を再利用するときは、前回の`job.json`に記録された生成物のうち、今回存在しないPDF・プレビュー・SVGを整理します。無関係な利用者ファイルは削除しません。保存先のリンクは拒否します。POSIX環境では所有者とgroup／otherの書込み権限も検査しますが、WindowsにはPOSIXのmodeビット判定を適用しません。

`--output` にProject内の別フォルダを指定した場合、そのフォルダだけを次回の入力ZIPから除外します。似た名前の他のフォルダは除外しません。Projectルートそのものは出力先に指定できません。

```text
latex-render source upload ./project.zip --json
latex-render render --source source_... --entrypoint reports/a.tex --output .render/a
latex-render render --source source_... --entrypoint reports/b.tex --output .render/b
```

Source作成結果が `uploadRequired: false` の場合、同じowner・同じSHA-256のZIPは再送信されません。Source IDは後続Jobで使えますが、別ownerからは利用できません。

## 保存Projectと改訂

```text
latex-render projects list
latex-render projects create <name>
latex-render projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
latex-render projects get <projectId>
latex-render projects jobs <projectId> <revisionId>
latex-render projects render <projectId> <revisionId>
latex-render projects rename <projectId> <name>
latex-render projects delete <projectId> --yes
```

`save` はローカルのディレクトリまたはZIPをSourceとして準備し、指定Projectへ不変の改訂を保存します。`--svg` は改訂の初回出力設定をPDF＋SVGにします。`render` は保存済みの指定改訂を使ってJobを作成し、`--svg` を付けた場合だけ出力設定を上書きします。`list`／`get`／`jobs` は `--cursor` で続きのページを取得できます。Projectは同じユーザーのWeb・API・MCP・別のAPIキーと共有されます。一時的な `render` や `source upload` は保存Projectを必須にしません。削除はProject記録の非表示であり、既存Jobを直ちに削除しません。

## ジョブ操作

```text
latex-render jobs get <jobId>
latex-render jobs cancel <jobId>
latex-render jobs download <jobId> --output .render
latex-render jobs download <jobId> --pdf-only --output .render
latex-render jobs download <jobId> --preview-page 2 5 --output .render
latex-render jobs retry-svg <jobId> --output .render
latex-render jobs delete <jobId> --yes
```

ジョブ操作時はAPIキーで操作用トークンを更新します。`jobs download` は指定Jobが終了するまで待ってから成果物を切り替えます。待機中にキャンセルした場合や待機が失敗した場合、保存済みの一式は変更しません。削除は終了済みジョブだけが対象です。

新しいRuntimeではPNGは初期1ページ＋要求したページだけを生成します。通常のダウンロードは生成済みPNGだけを取得し、`--preview-page 2 5` で追加ページを要求できます。PDFの再コンパイルや保持期限の延長は行わず、生成後の実際のサイズ・SHA-256を確認して保存します。

新しいPDF＋SVGジョブはPDFを先に公開します。`--pdf-only` はPDFの確定まで待って取得し、SVG完了は待ちません。SVGだけが失敗した場合は、PDFを保存した上で部分成功を表示します。`retry-svg` は同じJob・Source・確定PDFを使ってSVGだけを再試行し、PDFを再コンパイルしません。初回を含め最大8回で、保持期限は延長しません。Runtimeが変わった場合はJob全体を新規作成してください。詳細は[PDFとSVGの独立処理](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md)を参照してください。

状態確認の一時的な通信障害は自動で再試行します。認証・権限エラーは自動再試行しません。画面側の待機が止まってもサーバーの処理が続く場合があるため、新規作成せず同じジョブを確認してください。[再試行条件](/docs/reference/#cliの待機と再試行)を参照してください。

## 成果物

| パス                          | 内容                           |
| ----------------------------- | ------------------------------ |
| `.render/result.pdf`          | 成功時のPDF                    |
| `.render/compile.log`         | コンパイルログ                 |
| `.render/errors.json`         | 構造化されたエラー             |
| `.render/job.json`            | 最終ジョブ状態                 |
| `.render/previews/page-N.png` | 最大100ページのプレビュー      |
| `.render/svg/manifest.json`   | SVGとソース位置・PDF座標の対応 |
| `.render/svg/objects/*.svg`   | 数式・TikZごとの自己完結SVG    |

## JSON出力

すべてのCLI操作で `--json` を指定すると、進捗表示を混ぜず、標準出力へ1個のJSONオブジェクトだけを書き出します。human表示とJSON表示は同じ `client-core` の処理結果を利用します。

```text
latex-render auth status --json
latex-render render . --json
latex-render source upload ./project.zip --json
latex-render render --source source_... --entrypoint report.tex --output .render/report --json
latex-render jobs get <jobId> --json
latex-render jobs download <jobId> --output .render --json
latex-render doctor --json
```

JSONの成功・失敗形式と終了コードは[機械処理用の仕様](/docs/reference/#cliのjson形式)を参照してください。APIキーや短時間トークンは出力されません。
