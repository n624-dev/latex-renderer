---
slug: index
category: はじめる
title: LaTeX Renderer の使い方
description: LaTeX 文書を PDF に変換します。ブラウザ、ターミナル、AI から使えます。
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## 最短でPDFを作る

1. [Web アプリ](/app/)を開き、管理者から案内された方法でログインします。
2. `.tex` ファイルを選択し、**PDFに変換**を押します（画像や参考文献がある場合は、文書と一緒に ZIP にまとめて選択します）。
3. 変換結果に表示された PDF を開きます。後から確認するときは、Web アプリの**履歴**を開いてください。

手元に試せる文書がない場合は、次の内容を `main.tex`（UTF-8）として保存して使ってください。

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [日本語のサンプルと ZIP の作り方](/docs/projects/)
- [Web アプリの詳しい使い方](/docs/web/)
- [PDF や PNG を保存する・SVG を再試行する](/docs/outputs/)

ターミナルから使う場合は、[お使いのOSにCLIをインストール](/docs/client/)します。`n624-latex setup` で接続を設定し、`main.tex` を保存したフォルダで `n624-latex main.tex` を実行すると、`main.pdf` ができます。

## 利用方法を選ぶ

| やりたいこと | 使う機能 | ガイド |
| --- | --- | --- |
| **ブラウザで手軽に変換する** | Web アプリ | [ブラウザで変換](/docs/web/) |
| **ターミナルから変換して手元に保存する** | CLI（Windows・macOS・Linux） | [CLI のインストール](/docs/client/) |
| **ChatGPT や Claude から変換する** | Remote MCP（OAuth ログイン） | [ChatGPT・Claude との接続](/docs/mcp/) |
| **Codex や Claude Code で手元の文書を扱う** | CLI ＋ Local MCP・Skill | [Codex・Claude Code で使う](/docs/integrations/) |
| **独自アプリから自動変換する** | HTTP API | [公開API](/docs/api/) |
| **自分の Linux サーバーで運用する** | セルフホスト | [自分のサーバーで運用する](/docs/self-hosting/) |

## 必要なもの

- **Web アプリ / Remote MCP**：サーバー管理者から案内されたログイン用アカウント
- **CLI / Local MCP / HTTP API**：管理者が発行するレンダリング用 API キー（`lrk_` から始まる文字列）
- **CLI の動作環境**：
  - Debian / Ubuntu（APT パッケージ版）：専用の Node.js が同梱されるため事前準備は不要です。
  - macOS（Homebrew 版）：必要な Node.js は Homebrew がインストールします。
  - Windows / macOS / Linux（配布インストーラー版）：Node.js 24 以降が必要です。

変換処理はすべてサーバー側で行うため、どの利用方法でも手元の端末に TeX Live をインストールする必要はありません。

> [!WARNING]
> API キーは AI との会話、ソースコード、Git リポジトリ、ログに貼り付けないでください。漏えいの疑いがある場合は、速やかに管理者へ失効と再発行を依頼してください。

変換やログインで困ったときは、[問題解決ガイド](/docs/troubleshooting/)を参照してください。
