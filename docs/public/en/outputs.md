---
slug: outputs
category: Web and CLI
title: Get PDF, PNG, and SVG output
description: Save a PDF, download page images, and export or retry SVGs of equations and TikZ diagrams.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Open and save a PDF {#pdf-を開く-保存する}

- **Web app.** Select a document in [History](/app/history/) and open `result.pdf` in the results page’s artifact list. Even if you requested both PDF and SVG, you can download the PDF as soon as it is ready.
- **CLI.** Download using the displayed `<jobId>`. Add `--pdf-only` to get the PDF before SVG processing finishes. Use a separate `--output` folder when you need to preserve artifacts from another document.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Get page images {#ページ画像を取得する}

Use PNG previews when you need images of full pages. The server generates page 1 first, then generates additional pages on demand. If a preview is being generated, wait briefly or reopen it. You can download the finalized PDF while you wait.

- **Web app.** Select the page preview you want on the results page.
- **CLI.** For example, run the command below to download PNGs for pages 2 and 5. Files have names such as `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Save equations and TikZ diagrams as SVGs {#数式と-tikz-を-svg-で保存する}

You can extract outermost math expressions and top-level TikZ diagrams as individual vector images (SVGs).

- **Web app.** Open **Destination and output options**, select **Also export math and TikZ as SVG**, and convert the document. Download the files from **SVG artifacts** on the results page.
- **CLI.** Add `--svg` when converting. Each SVG is saved in `.render/svg/objects/`. The manifest at `.render/svg/manifest.json` maps the images to line numbers in the original `.tex` file and coordinates in the PDF.

```sh
n624-latex render . --svg
```

## Retry after SVG extraction fails {#pdf-はあるが-svg-が失敗した場合}

If the result shows **Partial success**, the PDF succeeded and only SVG extraction failed. Save the finished PDF first. You can then retry SVG extraction without recompiling the PDF.

- **Web app.** Choose **Retry SVG only** on the results page.
- **CLI.** Run the following command.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Retry conditions and limits**

- You can make **up to 8 attempts**, including the first, while the input data and finalized PDF are available and the server’s TeX runtime is unchanged. Retrying does not extend artifact retention.
- If failures persist, check the diagnostics on the results page or read `.render/svg/errors.json`.
- If you see `SVG_RUNTIME_CHANGED` or an older job lacks the retry button, [start a new conversion from the original document or a saved revision](/en/docs/web/#以前の文書や結果を開く).

See [Download artifacts and retry using the HTTP API](/en/docs/api/#pdfの先行公開とsvgの再試行) and the [output processing specification](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
