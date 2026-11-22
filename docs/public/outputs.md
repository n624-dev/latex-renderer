---
slug: outputs
category: Web・CLI
title: PDF・PNG・SVG を取得する
description: PDF の保存、ページ画像の取得、数式や TikZ の SVG 出力と再試行の手順です。
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## PDF を開く・保存する

- **Web アプリ**：[履歴](/app/history/)から対象の文書を選び、結果画面の成果物一覧から `result.pdf` を開きます（PDF＋SVG を指定した場合も、PDF は完成した時点で先に取得できます）。
- **CLI**：表示された `<jobId>` を指定してダウンロードします（`--pdf-only` を付けると SVG の完了を待たずに PDF を取得します）。別の文書の成果物を上書きしないよう、必要に応じて専用の `--output` フォルダを指定してください。

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## ページ画像を取得する

ページ全体の画像が必要なときは PNG プレビューを使います。最初に 1 ページ目だけが生成され、2 ページ目以降は要求されたページだけがオンデマンドで生成されます（生成中と表示された場合は少し待つか開き直してください。待機中も確定済み PDF は取得できます）。

- **Web アプリ**：結果画面で PDF の見たいページプレビューを選択します。
- **CLI**：たとえば 2 ページ目と 5 ページ目の PNG を取得するには次を実行します。`.render/previews/page-2.png` のような名前で保存されます。

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## 数式と TikZ を SVG で保存する

文書内の外側の数式や最上位の TikZ 図を、個別のベクター画像（SVG）として抽出できます。

- **Web アプリ**：変換前に**保存先・出力オプション**を開き、**数式とTikZをSVGでも出力**を選んで変換します。完了後、結果画面の **SVG成果物** から取得できます。
- **CLI**：`--svg` を付けて変換します。SVG 本体はおのおの `.render/svg/objects/` に保存され、元の `.tex` の行番号や PDF 上の座標との対応は `.render/svg/manifest.json` で確認できます。

```sh
n624-latex render . --svg
```

## PDF はあるが SVG が失敗した場合

結果が**部分成功**（PDF は成功・SVG のみ失敗）になった場合は、まず完成している PDF を保存してください。その後、PDF を再コンパイルせずに SVG 抽出だけを再試行できます。

- **Web アプリ**：結果画面の**SVGだけ再試行**を押します。
- **CLI**：次のコマンドを実行します。

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**再試行の条件と上限**：
- 元の入力データと確定 PDF が残っており、サーバーの TeX 実行環境（Runtime）が変わっていない場合に、初回を含めて**最大 8 回**まで実行できます（再試行しても成果物の保存期限は延長されません）。
- 失敗が続く場合は、結果画面の診断表示または `.render/svg/errors.json` を確認してください。
- `SVG_RUNTIME_CHANGED` が表示された場合や、古いジョブで再試行ボタンが出ない場合は、[元の文書や保存済みの改訂から新しく変換](/docs/web/#以前の文書や結果を開く)してください。

関連資料：[HTTP API からの成果物取得と再試行](/docs/api/#pdfの先行公開とsvgの再試行) · [出力処理の実装仕様](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md)
