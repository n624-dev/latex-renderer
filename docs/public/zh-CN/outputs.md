---
slug: outputs
category: Web 和 CLI
title: 获取 PDF、PNG 和 SVG
description: 保存 PDF、获取整页图片，以及导出公式和 TikZ 图形的 SVG 或重试提取。
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## 打开和保存 PDF {#pdf-を開く-保存する}

- **Web 应用。** 从[历史记录](/app/history/)选择文档，在结果页面的输出文件列表中打开 `result.pdf`。即使同时请求 PDF 和 SVG，PDF 也可在生成后立即下载。
- **CLI。** 指定页面显示的 `<jobId>` 下载。添加 `--pdf-only` 可在 SVG 完成前获取 PDF。为避免覆盖其他文档，请按需指定单独的 `--output` 目录。

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## 获取页面图片 {#ページ画像を取得する}

要获取整页图片，请使用 PNG 预览。起初只生成第 1 页；后续页面按需生成。若显示正在生成，请稍候或重新打开该页。等待期间可以下载已完成的 PDF。

- **Web 应用。** 在结果页面选择所需 PDF 页面的预览。
- **CLI。** 以下示例获取第 2 和第 5 页的 PNG，文件名形如 `.render/previews/page-2.png`。

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## 将公式和 TikZ 图形保存为 SVG {#数式と-tikz-を-svg-で保存する}

可以将文档中的最外层数学公式和顶层 TikZ 图形分别提取为独立的矢量图（SVG）。

- **Web 应用。** 转换前打开**保存位置与输出选项**，勾选**同时将公式和 TikZ 导出为 SVG**。转换完成后，即可在结果页面的 **SVG 输出文件**中下载。
- **CLI。** 添加 `--svg` 进行转换。各 SVG 保存在 `.render/svg/objects/` 中。原 `.tex` 文件中的行号与 PDF 坐标的对应关系见 `.render/svg/manifest.json`。

```sh
n624-latex render . --svg
```

## PDF 已生成但 SVG 失败 {#pdf-はあるが-svg-が失敗した場合}

结果显示**部分成功**时，说明 PDF 已生成，只有 SVG 提取失败。先保存 PDF，然后可以单独重试提取 SVG，无需重新编译 PDF。

- **Web 应用。** 在结果页面点击**仅重试 SVG**。
- **CLI。** 运行以下命令。

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**重试条件与次数限制**
- 原始输入数据和已完成的 PDF 仍在，且服务器 TeX 运行环境未改变时，连同首次尝试在内**最多执行 8 次**。重试不会延长输出文件的保留期限。
- 如果持续失败，请查看结果页面的诊断信息或 `.render/svg/errors.json`。
- 如果出现 `SVG_RUNTIME_CHANGED`，或旧作业没有重试按钮，请[使用原文档或已保存的版本重新转换](/zh-CN/docs/web/#以前の文書や結果を開く)。

参见[通过 HTTP API 获取输出文件和重试](/zh-CN/docs/api/#pdfの先行公開とsvgの再試行)及[输出处理实现规范](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md)。
