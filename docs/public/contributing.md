---
slug: contributing
category: 開発・貢献
title: ドキュメントへ貢献
description: Markdown本文を安全に変更し、ローカルで検証する手順です。
navOrder: 80
updated: "2026-08-10"
since: "v1.0.0"
---

## 本文を編集する

`docs/public/*.md` のfrontmatterと本文を変更します。ページ本文の変更だけならTypeScriptを編集する必要はありません。

## ローカル検証

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/public-web build
pnpm check
```

公開Web buildはWrangler dry-runに続いてローカルWorkers runtimeを起動し、代表ページ、検索索引、404、redirect、response headerを検証します。

## 互換性

既存URLと見出しfragmentを不用意に変更しないでください。CLIやAPIの例を変更する場合は実装とOpenAPIも確認します。
