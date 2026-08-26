---
slug: index
category: はじめる
title: はじめに
description: APIキーを登録し、最初のPDFを作成するまでの最短手順です。
navOrder: 10
updated: "2026-08-12"
since: "v1.0.0"
---

## 利用方法を選ぶ

| 方法                                           | 用途                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [クライアント](/docs/client/)                  | Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。 |
| [CLI](/docs/cli/)                              | ターミナルから変換、状態確認、キャンセル、成果物取得を行います。   |
| [Codex・Claude Code・MCP](/docs/integrations/) | APIキーを会話へ渡さず、ローカルCLI経由で操作します。               |
| [公開API](/docs/api/)                          | 独自アプリケーションからHTTP APIを利用します。                     |

## 必要なもの

- 管理者から発行された `lrk_` で始まるレンダリング用APIキー
- 既定ではルートに `main.tex` があるLaTeXプロジェクト。別の相対 `.tex` entrypointも指定可能
- クライアントの場合はNode.js 24以降

> [!WARNING]
> APIキーを会話、ソースコード、Git、ログへ貼り付けないでください。漏えいした可能性がある場合は管理者へ失効と再発行を依頼します。

## 最短でPDFを作る

1. [クライアントをインストール](/downloads/)します。
2. APIキーを標準入力から登録します。Windows用入口では非表示入力を利用できます。
3. 新しいターミナルを開き、プロジェクトを指定します。

```text
latex-render auth status
latex-render render /path/to/project --open
```

結果はプロジェクト内の `.render` に保存されます。失敗時は最初に `.render/errors.json` を確認してください。
