---
slug: contributing
category: 開発・貢献
title: ドキュメントへ貢献
description: Markdown本文を安全に変更し、ローカルで検証する手順です。
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## 本文を編集する

記載が実際の画面やコマンドと違う場合は、[不具合を報告する](https://github.com/n624-dev/latex-renderer/issues/new/choose)から対象ページと修正案を知らせてください。

文章を修正する場合は、[公開ガイドの Markdown 原稿](https://github.com/n624-dev/latex-renderer/tree/main/docs/public)から対象ページを選び、プルリクエストを作成します。見出しへのリンクは見出し名から生成されるため、既に公開した見出しを変更するときは既存リンクも確認してください。

## ローカル検証

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

公開Web buildはWrangler dry-runに続いてローカルWorkers runtimeを起動し、代表ページ、検索索引、404、redirect、response headerを検証します。

## 互換性

既存URLと見出しfragmentを不用意に変更しないでください。CLIやAPIの例を変更する場合は実装とOpenAPIも確認します。
