---
slug: cli
category: CLI
title: CLI
description: 実装済みのコマンドと保存される成果物を説明します。
navOrder: 30
updated: "2026-08-18"
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

```text
latex-render source upload ./project.zip --json
latex-render render --source source_... --entrypoint reports/a.tex --output .render/a
latex-render render --source source_... --entrypoint reports/b.tex --output .render/b
```

Source作成結果が `uploadRequired: false` の場合、同じowner・同じSHA-256のZIPは再送信されません。Source IDは後続Jobで使えますが、別ownerからは利用できません。

## ジョブ操作

```text
latex-render jobs get <jobId>
latex-render jobs cancel <jobId>
latex-render jobs download <jobId> --output .render
latex-render jobs delete <jobId> --yes
```

ジョブ操作時はAPIキーで操作用トークンを更新します。削除は終了済みジョブだけが対象です。

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

成功時の形式:

```json
{ "success": true, "command": "auth.status", "result": { "configured": true } }
```

エラー時の形式:

```json
{
  "success": false,
  "command": "auth.login",
  "error": {
    "code": "INVALID_API_KEY",
    "message": "Input is not a render API key",
    "status": 400
  }
}
```

レンダリングがコンパイル失敗などの終了状態になった場合は、`result` にジョブと保存先を含めたうえで `success: false` を返し、終了コードを `2` にします。通常のCLI/APIエラーは終了コード `1` です。APIキー、upload ticket、job ticketはJSONへ含めません。
