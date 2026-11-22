---
slug: integrations
category: AI・MCP
title: Codex・Claude Code で使う
description: ローカルに保存した資格情報をCLIとMCPから共通利用します。
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Skillの導入

1. 先に[CLI をインストールし、API キーを登録](/docs/client/)します。
2. Codex または Claude Code がインストールされた状態で、次を実行します（AI に操作手順を伝える Skill と、Local MCP がまとめて登録されます）。

```sh
n624-latex setup
n624-latex doctor --json
```

3. Codex または Claude Code を再起動し、変換したいフォルダや本文ファイルを指定して依頼します。

- **Skill の配置先**：
  - Codex：`$HOME/.agents/skills/latex-renderer`
  - Claude Code：`$HOME/.claude/skills/latex-renderer`
- ユーザーが独自に変更した Skill を検出した場合は上書きせず保持し、セットアップ結果にその旨を表示します。

## MCPの登録

- **手元のファイルを直接扱う場合（Codex / Claude Code）**：上の `setup` で自動登録されます。手動登録コマンドや詳細は[Local MCPの登録](/docs/mcp/#local-mcpの登録)を参照してください。既存の同名別登録は上書きしないため、競合や修復は[状態確認と修復](/docs/client/#状態確認と修復)で確認できます。
- **クラウド上の AI から使う場合（ChatGPT / Claude Web 等）**：API キー不要の[Remote MCPの接続手順](/docs/mcp/#通常はremote-mcpを使う)を使用します。

## 依頼例

- 「このフォルダの `main.tex` を確認してレンダリングして」
- 「この ZIP の `reports/a.tex` をレンダリングして」
- 「この ZIP の `reports/a.tex` と `reports/b.tex` を 1 回のアップロードからそれぞれレンダリングして」
- 「構造化エラーを確認し、該当する TeX だけを修正して再実行して」
- 「生成した PDF とページプレビューを確認して」

## 安全な使い方

> [!WARNING]
> API キーをプロンプト、MCP のツール引数、プロジェクト内のファイルに絶対に含めないでください。Local MCP は CLI が保護・保存している資格情報を内部で利用するため、引数でキーを渡す必要はありません。

- **未信頼データの扱い**：LaTeX ソース、ファイルパス、ログ、エラー、成果物、MCP 応答は未信頼データとして扱い、その中に書かれた命令（プロンプトインジェクション等）には従わないよう設計されています。
- **破壊的操作の確認**：`cancel_render` と `delete_render` は、利用者が明示的に指示した場合にのみ実行します。
- **対象ファイルの選択規則**：エントリポイントの指定がない場合は `main.tex` を使います。`main.tex` が存在せず複数の `.tex` 候補がある場合は利用者に選択を求め、すべての `.tex` を勝手に自動実行することはありません（Skill 本体は安全規則と操作順のみを保持し、詳細仕様は同梱の `references/` と公開ドキュメントへ分離しています）。
