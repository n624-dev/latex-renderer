---
slug: projects
category: プロジェクト
title: 対応するプロジェクト
description: 送信対象、制限、LuaLaTeX向けの最小構成を説明します。
navOrder: 50
updated: "2026-08-14"
since: "v1.0.0"
---

## 構成

既定のentrypointはプロジェクトのルートにある `main.tex` です。CLIやMCPで明示すれば、Source内の任意の相対 `.tex` パスもentrypointにできます。画像、BibTeXデータ、ローカルのスタイルやクラスファイルは参照関係を保ったまま含めます。

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

## 日本語の最小例

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

レンダラーはLuaLaTeXを使用します。利用可能なパッケージとフォントは配布環境に依存するため、不足が出た場合は `compile.log` のメッセージを管理者へ伝えてください。

Webアプリでは[レンダリング環境](/app/environment/)から、現在のコンテナに入って
いるパッケージとフォントを検索できます。この一覧はデプロイ時に実際のRenderer
イメージから生成され、Remote MCPの環境確認機能と共通です。

## Webのプロジェクトと改訂

[`/app/`](/app/) からアップロードした文書はプロジェクトへ保存されます。同じ
プロジェクトを保存先に選ぶと不変の改訂が追加され、元のファイル名、entrypoint、
各改訂から作ったJobを確認できます。改訂の「もう一度変換」は保存済みSourceを
使うため、同じファイルを再アップロードしません。

プロジェクトを削除してもJobを即時削除せず、それぞれの既存の保存期限に従います。
アクティブなプロジェクトが参照しているSourceは、再レンダリングできるよう保持
されます。

## 送信から除外されるもの

`.git`、`.render`、LaTeXが生成した補助ファイルはクライアントが除外します。`node_modules` など、その他の不要なフォルダはプロジェクト外へ移してから実行してください。シンボリックリンクは受け付けません。

## 制限

- 最大500ファイル
- ZIP送信サイズは最大20 MiB
- entrypointはSource内の相対 `.tex` パス。省略時はプロジェクト直下の `main.tex`
- シェルエスケープと外部コマンド実行は利用不可
- 処理時間、保存容量、保持期間には管理者設定の上限あり
