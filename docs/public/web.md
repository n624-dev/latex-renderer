---
slug: web
category: Web
title: Webアプリ
description: ブラウザでのPDF変換、履歴、プロジェクト、公開サイトの使い分けです。
navOrder: 25
updated: "2026-08-29"
since: "v1.0.0"
---

## 公開される情報

- `/docs/`：利用者向けドキュメント
- `/downloads/`：署名情報付きクライアント配布
- `/status/`：API、レンダリング、ダウンロードの稼働状況
- `/openapi/`：公開API仕様

## ブラウザでPDFへ変換

運用者が選択したCloudflare Access、OIDC、またはlogin name＋passwordでログインして [`/app/`](/app/) を開き、`.tex` または
`.zip` を選びます。必要な場合は「数式とTikZをSVGでも出力」を選択できます。APIキーや実行先を選ぶ必要はありません。変換を始めると
JobごとのURLへ移動し、ブラウザを閉じたり一時的に通信が切れたりしても、履歴や
そのURLから状態と成果物を読み直せます。

- `/app/`：ファイル選択とPDF変換
- `/app/history/`：自分の変換履歴
- `/app/projects/`：文書名、改訂、再レンダリング
- `/app/environment/`：実環境のパッケージとフォントを検索

TeXファイルを複数選ぶと文書ごとに変換します。ZIPに複数の `.tex` があり
`main.tex` がない場合は、変換する文書を選択できます。

## 公開・利用・管理機能の境界

`/app/`、`/admin/` とそのAPIはserver-side sessionで保護され、公開Webの検索索引には
含まれません。一般利用者は `/app/`、admin／ownerだけが `/admin/` を利用できます。emailと表示名は認証情報ではなく、外部IdPではissuer＋subject、password modeではlogin nameを使用します。
ZIP upload、Job、artifact、TeX compileはVPS上のRendererへ送られます。

> [!NOTE]
> Jobへの接続に使う短時間の認証情報はブラウザへ永続保存しません。必要なときに
> server-side sessionから再発行します。session cookie、CSRF token、短時間ticketをコピーして共有しないでください。
