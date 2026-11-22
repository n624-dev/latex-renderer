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
2. `.tex` ファイルを選び、**PDFに変換**を押します。画像や参考文献がある場合は、文書と一緒に ZIP にまとめて選びます。
3. 変換結果に表示された PDF を開きます。後から確認するときは、Web アプリの**履歴**を開きます。

手元に文書がなければ、次を `main.tex` として UTF-8 で保存してください。

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

[日本語のサンプルと ZIP の作り方](/docs/projects/) · [Web アプリの詳しい使い方](/docs/web/)

## 利用方法を選ぶ

- **ブラウザで変換する** — ファイルを選び、PDF やプレビューを確認します。[Web アプリの使い方](/docs/web/)
- **ターミナルから変換する** — Windows・macOS・Linux で、結果を手元のフォルダに保存します。[CLI のインストール](/docs/client/)
- **ChatGPT や Claude から変換する** — サーバーにログインして接続します。[AI クライアントを接続する](/docs/mcp/)
- **Codex や Claude Code でローカルの文書を扱う** — CLI とローカル連携をセットアップします。[ローカルの AI 連携](/docs/integrations/)
- **独自アプリから変換する** — ZIP の送信、変換、結果取得を自動化します。[HTTP API](/docs/api/)
- **自分のサーバーで運用する** — Linux に HTTPS とログインを設定します。[セルフホスト](/docs/self-hosting/)

## 必要なもの

Web アプリと Remote MCP では、サーバー管理者から案内されたアカウントでログインします。CLI・Local MCP・HTTP API では、管理者が発行する `lrk_` から始まるレンダリング用 API キーを使います。CLI のインストールには Node.js 24 以降が必要です。変換はサーバーが行うため、手元に TeX Live を入れる必要はありません。

> [!WARNING]
> API キーは会話、ソースコード、Git、ログに貼り付けないでください。漏えいした場合は、管理者に失効と再発行を依頼してください。

変換やログインで困ったときは[問題解決ガイド](/docs/troubleshooting/)を参照してください。
