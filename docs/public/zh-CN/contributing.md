---
slug: contributing
category: 开发与贡献
title: 参与完善文档
description: 修改 Markdown 指南并在本地验证更改。
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## 编辑指南 {#本文を編集する}

- **报告错误。** 如果文档与实际界面或命令不符，请在 [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) 提供对应页面及修改建议。
- **提交拉取请求。** 编辑[公开指南的 Markdown 源文件（`docs/public/`）](https://github.com/n624-dev/latex-renderer/tree/main/docs/public)，然后提交拉取请求。

## 本地验证 {#ローカル検証}

修改后运行以下命令，确认构建、链接和响应头检查全部通过。

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

构建 `public-web` 时，会先运行 Wrangler dry-run，再启动本地 Workers 运行时，自动检查典型页面、搜索索引、404、重定向和响应头。

## 兼容性 {#互換性}

- 请保留现有公开 URL 和标题锚点（根据标题生成的 `#...` 片段）。如需修改标题，请检查其他页面的链接。
- 修改 CLI 选项或 HTTP API 请求示例时，还需与实现代码及 OpenAPI 定义核对。
