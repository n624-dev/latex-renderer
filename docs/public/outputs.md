---
slug: outputs
category: Web・CLI
title: PDF・PNG・SVG を取得する
description: PDF の保存、ページ画像の取得、数式や TikZ の SVG 出力と再試行の手順です。
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

変換結果は、Web の**履歴**または CLI に表示されたジョブ ID から開けます。必要な成果物は保存期限までに手元へ保存してください。

## PDF を開く・保存する

Web では[履歴](/app/history/)から文書を選び、結果画面の成果物一覧で `result.pdf` を開きます。PDF と SVG を要求した場合も、PDF は確定した時点で取得できます。

CLI で同じ変換結果を取り直すには、`<jobId>` を表示されたジョブ ID に置き換えて実行します。

```text
latex-render jobs download <jobId> --pdf-only --output .render
```

PDF は `.render/result.pdf` に保存されます。専用の出力フォルダを指定すると、別の文書の成果物を上書きせずに保管できます。

## ページ画像を取得する

Web では PDF のページプレビューを選びます。最初のページは初期生成され、それ以外は選んだページだけが作られます。準備中の場合は同じページを待つか開き直してください。

CLI で、たとえば 2 ページ目と 5 ページ目を取得するには次を実行します。

```text
latex-render jobs download <jobId> --preview-page 2 5 --output .render
```

生成された PNG は `.render/previews/page-2.png` のような名前で保存されます。プレビューの生成を待っている間も、確定済み PDF は取得できます。

## 数式と TikZ を SVG で保存する

Web では変換前に**保存先・出力オプション**を開き、**数式とTikZをSVGでも出力**を選びます。CLI では `--svg` を付けます。

```text
latex-render render . --svg
```

結果画面の **SVG成果物**から取得できます。CLI では `.render/svg/objects/` に保存され、`.render/svg/manifest.json` で元の数式や図との対応を確認できます。ページ全体の画像が必要なときは PNG プレビューを使います。

## PDF はあるが SVG が失敗した場合

**部分成功**と表示されたら、まず必要な PDF を保存してください。次に、結果画面の**SVGだけ再試行**を選ぶか、CLI で次を実行します。

```text
latex-render jobs retry-svg <jobId> --output .render
```

再試行は同じジョブの確定 PDF を保持します。元の入力と PDF が利用可能で、同じ TeX 実行環境を使える場合に、初回を含め最大 8 回まで実行できます。再試行で成果物の保存期限は延長されません。エラーが続く場合は結果画面の診断、または `.render/svg/errors.json` を確認してください。

`SVG_RUNTIME_CHANGED` が表示された場合や、古いジョブに再試行ボタンが出ない場合は、[元の文書や保存済みの改訂から再変換](/docs/web/#以前の文書や結果を開く)します。

[HTTP API からの成果物取得と再試行](/docs/api/#pdfの先行公開とsvgの再試行) · [出力処理の実装仕様](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md)
