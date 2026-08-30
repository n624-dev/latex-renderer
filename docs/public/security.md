---
slug: security
category: 問題解決・安全性
title: セキュリティ境界
description: 資格情報、アップロード、レンダラー、管理領域の安全な扱いです。
navOrder: 65
updated: "2026-08-29"
since: "v1.0.0"
---

## 資格情報

- APIキーをコマンドライン引数、URL、Git、ログ、プロンプトへ含めない
- WindowsではDPAPIで現在のユーザーに紐づけて保存する
- 漏えいの疑いがあれば管理者へ失効と再発行を依頼する
- ブラウザ用password、OIDC secret、session cookieと、CLI用`lrk_`／`lra_` keyを相互に流用しない

## プロジェクト

LaTeXとアップロードファイルは信頼できない入力です。シンボリックリンク、shell escape、外部コマンド実行は利用できません。Rendererのsandbox、制限時間、ファイル上限を回避しないでください。

## 公開領域と管理領域

公開Docsとダウンロード、認証済みWeb、Renderer APIは同じcanonical HTTPS originでpath分離します。Cloudflare profileではTunnel／Workers、standalone profileではTLS reverse proxyが入口です。すべてのapplication serviceはloopbackにbindし、Internal API、SQLite、manager socketを公開しません。公開検索索引には認証領域を含めません。

ブラウザ認証は設定されたCloudflare Access、OIDC、ローカルpasswordのいずれかです。外部identityは`provider + issuer + subject`だけで本人を識別し、emailや表示名の一致では連携しません。sessionはserver側で失効でき、mutationは完全一致するOriginとsession固有CSRF tokenを要求します。passwordはscryptとroot所有pepperで保護しますが、公開運用ではreverse proxyのrate／connection limitとhosting providerのDDoS対策も必要です。

Remote MCPの `/mcp`、OAuth token endpoint、discovery metadataは公開到達可能ですが、MCP toolはaudienceとscopeを固定した短命Bearer tokenを要求します。OAuth authorize endpointは`/app/`と同じブラウザsessionを使い、既存の有効なuserへ明示的に対応付けます。token、Source ZIP、PDF、raw logはRemote MCPの診断ログへ記録しません。

Remote MCPの標準tool `content` は、workflow継続に必要なowner-scoped ID、status、cursor、offset、availability、bounded diagnosticsだけを返します。ユーザー由来のpath、filename、検索結果、診断文は制御文字を除去し、項目数・項目長・全体長を制限した未信頼データとして明示します。OAuth token、API key、ticket、raw base64、Source全文、完全ログ、stack trace、Access subject、server内部pathは標準 `content` へ含めません。完全なPDF・ログ・raw artifactはowner authorizationを再確認するResource経由に限定します。

## Local Setup Web UI

`latex-render setup --gui` は `127.0.0.1` のOS割り当てランダムポートだけで待ち受け、外部インターフェースへ公開しません。CLIが開くURLのfragmentに一回限りbootstrap tokenを含め、ブラウザ内で履歴から直ちに除去して短命sessionへ交換します。

すべての操作APIは完全一致する `Origin`、Bearer session、別のCSRF tokenを要求します。CORSは有効化せず、Host検証、loopback接続元検証、厳格なCSP、`frame-ancestors 'none'`、`no-store`を適用します。APIキーは保存処理にだけ渡され、状態・診断・サンプルrenderのレスポンスへ含めません。30分操作がなければ停止し、最大2時間で必ず終了します。
