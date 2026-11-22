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

- **誤りの報告**：ドキュメントの記載が実際の画面やコマンドと異なる場合は、[GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) から対象ページと修正案を知らせてください。
- **プルリクエストの作成**：文章を直接修正する場合は、[公開ガイドの Markdown 原稿（`docs/public/`）](https://github.com/n624-dev/latex-renderer/tree/main/docs/public)の対象ファイルを編集してプルリクエストを作成します。

## ローカル検証

変更後は次のコマンドを実行し、ビルドとリンク・ヘッダー検査が通ることを確認します。

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

`public-web` のビルドでは Wrangler の dry-run に続けてローカルの Workers ランタイムが起動し、代表ページ、検索インデックス、404、リダイレクト、レスポンスヘッダーが自動検証されます。

## 互換性

- 既存の公開 URL パスや見出しアンカー（見出し文字列から自動生成される `#...` フラグメント）を不用意に変更しないでください。見出し名を変える場合は、他ページからのリンク切れがないか必ず確認します。
- CLI オプションや HTTP API のリクエスト例を変更する場合は、実装コードおよび OpenAPI 定義との一致も確認してください。
