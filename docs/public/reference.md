---
slug: reference
category: 運用・開発
title: 運用・開発の詳細仕様
description: クライアントの保存・復旧、MCP認証、旧版移行の詳細を目的別に確認します。
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## 成果物の保存・復旧の仕様

> [!DETAILS] 仕様・手順を表示
>
> - **原子的なフォルダ切り替え**：CLI と Local MCP は `.render/result.pdf`・`job.json`・プレビュー等のパスを維持しつつ、全ファイルで広告されたサイズと SHA-256 を検証し、一式が揃ってからフォルダを切り替えます（新旧ファイルを 1 つのフォルダへ順次上書きすることはありません。切り替えの一瞬だけフォルダが見えない場合があるため、外部プログラムからはコマンド完了後に読み込んでください）。
> - **管理フォルダによる自動復旧**：出力先の隣に `<出力名>.latex-renderer-state` という管理フォルダを作成します（Source 収集からは自動除外）。正常終了時に一時データを消し、強制終了された場合は次回のダウンロード開始時に復旧します（確定前なら旧一式へ戻し、確定後なら新一式を保持して旧一式を整理します。処理中・復旧前に手動削除しないでください）。
> - **排他制御と異常検出**：同一出力先への同時保存は `OUTPUT_BUSY` で停止します（時間経過だけで実行中プロセスを排除せず、PID 再利用時も安全側に停止します。管理情報の破損・未知ファイル・外部リンクを見つけた場合も自動削除せず確認を求めます）。
> - **利用者ファイルの保護と環境制限**：出力先に利用者が置いた通常ファイルは次の一式へコピーして引き継ぎますが、ダウンロード中の手動編集を検出した場合は公開を中止して編集内容を残します（出力先は専用フォルダを推奨）。新旧一式はそれぞれ最大 1 GiB・10,000 項目までで、切り替え時は新旧一式＋一時領域の空き容量が必要です。symlink・hardlink・別ファイルシステムのマウントを含むパスは拒否し、ローカルファイルシステムのみを対象とします（ネットワーク共有上の排他や電源断時の完全な原子性は保証外。Windows でファイルが開かれていて切り替えられない場合も旧一式を保持します）。

## Web認証の境界

> [!DETAILS] 仕様・手順を表示
>
> `/app/`・`/admin/` とその API はサーバーサイドセッションで保護され、公開検索インデックスには含まれません。一般利用者は `/app/`、管理者（admin）と所有者（owner）のみが `/admin/` を利用できます。本人識別は外部 IdP の `issuer + subject` またはパスワード認証の `login name` で行い、メールアドレスや表示名は認証キーとして使いません。ZIP アップロード・Job・成果物・TeX コンパイルはすべてサーバー上の Renderer へ送られます。
>
> > [!NOTE]
> > Job 接続用の短時間チケットはブラウザに永続保存せず、必要時にサーバーサイドセッションから再発行します。セッション Cookie、CSRF トークン、短時間チケットをコピーして共有しないでください。

## Remote MCPの登録・診断

> [!DETAILS] 仕様・手順を表示
>
> - **動的クライアント登録（DCR）の保持と上限**：未完了または非活動の登録は 30 日間を目安に整理されます（有効な認可コードや token family が参照中の登録は保護。全体上限は 10,000 件）。整理後に `invalid_client` となった場合は AI クライアント側で再登録してください。クライアント名を省略した標準 DCR 要求も受け付け、名前や redirect URI の検証は維持します。
> - **認可要求の一時保存（スキーマ 20）**：ブラウザログインを挟む認可要求は短いランダム ID で一時保存し、長い OAuth `state` をログイン戻り先 URL へ埋め直さず元の要求を復元します（有効期限 10 分、認証済みブラウザと専用 Cookie が一致する場合に 1 回限り有効。並行タブは別 ID を使用）。全体上限 1,000 件・ブラウザ継続用 Cookie 最大 8 件とし、上限時は既存要求を消さず `503` を返します（DB には ID と Cookie ハッシュのみ保存し、再起動やバックアップ復元で期限は延びません）。
> - **IP レート制限と送信元ヘッダー**：DCR 登録は信頼する送信元 IP ごとに 15 分間 10 回までです（同一プロキシ出口 IP は枠を共有。11 回目以降は HTTP `429`・`temporarily_unavailable`・`Retry-After` を返却。不正な登録メタデータは枠を消費しません）。送信元 IP が欠落・不正な場合は共通枠へ混ぜず `503` を返してプロキシ設定確認を促します。バックエンドはループバックのまま、プロキシが `X-Latex-Renderer-Client-IP` を実送信元で上書きする構成を使います（任意の `X-Forwarded-For` は不採用。Cloudflare 経路では信頼境界内の `CF-Connecting-IP` も処理）。
> - **管理者向け疎通確認コマンド**：資格情報を送らずに公開 discovery と `401` Bearer challenge を確認できます（設定変更やリダイレクト追跡は行わず、本文・Cookie・秘密情報も出力しません）。
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **段階別のログ切り分け**：discovery 応答（`200`）と `401` challenge 成功だけでは実ログインや ChatGPT のツール一覧成功を意味しません。停止した段階・時刻・`X-Request-ID` と、サーバーログの `remote_mcp.http_result` / `remote_mcp.oauth_stage` / `remote_mcp.protocol_error` / `remote_mcp.rpc_result` を突き合わせます（OAuth code・token・Cookie・PKCE verifier・Source・利用者 ID はログや Issue に出さないでください）。
> - **「認証成功・アクション検出失敗」時の確認**：トークン発行後の `initialize`、初期化通知、`tools/list` を分けて確認します（HTTP `200` でも JSON-RPC `error` なら失敗です）。`remote_mcp.rpc_result` は HTTP status、成否分類、protocol version、ツール件数、応答バイト数、一覧の基本形を記録します（確認用バッファ上限は 256 KiB で超過時は `inspection_limited` と記録するのみ。応答自体は書き換えません）。SSE 応答や `GET` に対する `405` だけで異常と判断せず、`Accept` / `Content-Type` / protocol 交渉と、プロキシからリクエストが到達しているかを確認してください（ローカル HTTP 試験の成功とは別に、実環境での外部 OIDC・Cloudflare ポリシー・ChatGPT 実アカウント確認が必要です）。

## MCPの結果とResource

> [!DETAILS] 仕様・手順を表示
>
> Remote MCP の応答は 3 層で構成されます。
> 1. **標準 `content`**：AI が判断と次のツール呼び出しを進めるための Source ID・Job ID・status・offset・cursor・availability・制限付き診断を必ず含めます（`structuredContent` やカスタム Resource 非対応のクライアントでも、これだけで作成〜修正〜再 render まで完結可能）。
> 2. **`structuredContent`**：検証済み結果の完全な機械処理用オブジェクト。
> 3. **MCP Resource（`latex-renderer://jobs/...`）**：PDF 本体、完全な `compile.log`、生 JSON、`svg/manifest.json`、`svg/objects/*.svg` などの大容量データ。同一の OAuth 所有者のみ読み取り可能で、保持期限やサイズ上限は通常の成果物と共通です（API キー・OAuth トークン・各種チケット・Source 本文・生 base64 はどの層にも含めません）。

## CLIの待機と再試行

> [!DETAILS] 仕様・手順を表示
>
> ジョブ終了待ちのポーリング中に一時的な HTTP `502`・`503`・`504`（または不正な JSON 応答）が発生した場合、同じ Job の状態取得だけを**最大 5 回**（待機間隔：1・2・4・8・8 秒、全体の待機タイムアウト延長なし）自動再試行します。ジョブ作成・アップロード・トークン更新・成果物検証は自動再試行せず、認証・権限エラーも即座に返します（CLI 側の待機がエラー終了しても、サーバー上のジョブ処理自体が止まったとは限りません）。

## CLIのJSON形式

> [!DETAILS] 仕様・手順を表示
>
> `--json` 指定時の標準出力フォーマットです（API キー、`uploadTicket`、`jobTicket` は一切出力されません）。
>
> - **成功時（終了コード `0`）**：
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI / API エラー時（終了コード `1`）**：
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **LaTeX コンパイル失敗などのジョブ終了時（終了コード `2`）**：`result` にジョブ情報と保存先パスを含めたうえで `success: false` を返します。

## 旧版からの移行と特殊復旧

> [!DETAILS] 履歴資料　旧 Updater からの移行と展開エラー
>
> ### v1.2.xのroot Updaterから権限分離Updaterへ移行する場合
>
> v1.2.x までの Update Manager は root デーモンでしたが、v1.3.0 以降は常駐 controller を `latex-renderer-update` ユーザーへ分離し、固定 verb のみを受け取る短命 root helper 構成になりました。旧 Updater から Web 更新すると `Application Update Manager must use a separate non-root build tree` で止まる場合があります（同じ Web 操作を繰り返さないでください）。
>
> この一度限りの移行には [v1.3.6 のサーバー配布物](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6)を使います。通常ユーザーで [配布物のダウンロードと検証](/docs/self-hosting/#v1-6-9をダウンロードして検証)を開き、コマンドの先頭の `version=` の行を `version=1.3.6` に置き換えてから実行します。検証と展開で設定された `bundle_root` は同じ端末で引き継ぎます。
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> このスクリプトは root 側で同じ Immutable Release を再取得して digest・tag/commit・Sigstore bundle・archive 上限・metadata を再検証し（`gh` は root 所有かつ group/other 書込不可の `/usr/local/bin/gh` または `/usr/bin/gh` のみ許可）、root 所有 `verified`・非 root `bootstrap-build`（専用 Corepack shim の固定 pnpm を使用）・root 所有 `assembly` ツリーに分離してビルドします。共有 mutation lock 取得後にのみ旧 manager を止め、失敗時は旧 manager を再開します。成功後は以下で `User=latex-renderer-update` と各サービスの `active` を確認し、以降は通常の Web / Admin CLI 更新を使ってください。
> Web や API に sudo 権限や GitHub トークンを渡しません。
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tarの展開がFunction not implementedで停止する場合
>
> Ubuntu の GNU `tar` が `openat2` を使う環境では、Updater の `RestrictSUIDSGID=true` 制限により階層付きアーカイブ展開が `ENOSYS`（Function not implemented）で止まることがあります。修正版 Updater は GNU `tar` による検査と署名検証を維持したまま、展開だけを `/usr/bin/bsdtar`（所有者・ACL・拡張属性を取り込まず私有の空 staging へ展開）へ切り替えています（`RestrictSUIDSGID` の解除やシステム `tar` の差し替えは行いません）。
>
> 旧 Updater は修正版自身の展開にも失敗するため、進行中操作がなくアプリ・DB が正常で暗号化バックアップが検証済みであることを確認したうえで、導入済みの `bootstrap-v1` を使って**独立 Updater だけを先に公開済み修正版 Release へ更新**します。
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # 修正を含む公開済み immutable Release のバージョンを指定
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Updater の新バージョンと `ready` / `pending=false` を確認した後、同じバージョンを通常の Web / Admin CLI `update apply` でアプリ本体へ適用します。
>
> ※ なお、`v1.4.0-rc.3` の Updater には root コピーした bundle の所有者が非 root のまま残り `Release extraction requires a private regular bundle` で止まる既知問題があります。この場合も検査を解除せず、所有者修正を含む新しい公開済み Release へ Updater のみ先行更新してからアプリを適用してください（root / systemd 下の展開検証は `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs` で単体実行可能です）。

> [!DETAILS] 更新や TeX 変更のロックを調べる
>
> ### mutation lockが使用中と表示される場合
>
> `MUTATION_LOCK_BUSY` はアプリ更新と TeX 変更の同時実行を防ぐ排他機構です。処理が進行中の間は完了を待ってください。**`/run/latex-renderer/mutation.lock` ファイル自体は絶対に削除しないでください**（削除すると新旧 2 つのロックが並立してしまいます。また、アプリ更新中の内部 TeX Runtime 復元でこのエラーが出た場合は自己競合の可能性があるため、再実行せずログと停止サービスを確認します）。
>
> 実行中の操作がなく、ログ上も直前の処理が完了しているのにロック表示が消えない場合に限り、両 manager を止めて保持プロセスを確認します。
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> 表示されたプロセスが完了済み操作の孤立した lock helper であると確認できた場合のみ、プロセスを終了させて manager を再開します。
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## 過去RCのRenderer識別情報

> [!DETAILS] 履歴資料　v1.3.4 のリリース候補
>
> `v1.3.4-rc.3` から `v1.3.4-rc.4` への更新は、Renderer 識別ハッシュの対象ファイルが 5 個から 6 個に変わったため、サービス切り替え前に失敗しました。この組み合わせでは、旧版との互換情報も持つ修正版 `v1.3.4-rc.5` が移行先です。配布物全体のチェックサムと来歴署名で、追加されたファイルも検証します。

## Updaterの実行領域

> [!DETAILS] 仕様・手順を表示
>
> Update Manager は、配布物を検証した root 所有の `verified` ツリー、依存導入とビルドのみを行う非 root の `build` ツリー、許可された成果物だけを戻した root 所有の `assembly` ツリーを厳格に分離します。root が実行するデプロイスクリプトは常に `assembly` 側の検証済みコピーであり、Cloudflare 公開等をデプロイ用ユーザーで行う際も root 検査後の一時 `deployment-build` コピーを使います（ロールバック時も同様）。

## Windowsの配置と保護

> [!DETAILS] 仕様・手順を表示
>
> Windows でインストール先を変更すると、既定のコマンド配置先もその配下の `bin` になります。環境変数 `LATEX_RENDER_BIN_DIRECTORY` を別途指定した場合はそこへ管理対象ランチャーを置き、ユーザー PATH と Local MCP で共通利用します（既存の別ランチャーは上書きせず、旧版の別 PATH 記録は `setup repair` で修正可能。旧 PATH 項目自体は他用途との競合防止のため残します。パスにはセミコロン・引用符・制御文字を含まない絶対パスを使ってください）。また、`--open` や GUI 起動でブラウザ・ビューアを開けなかった場合でも、保存済みの PDF は削除されません。

## 保存プロジェクトの共有・保持

> [!DETAILS] 共有と保持の仕様を表示
>
> - Web（`/app/`）・CLI・公開 API・Local MCP・Remote MCP は、同一ユーザー所有の保存 Project と不変の改訂（revision）履歴を共有します（同一ユーザーの複数 API キー / Service Account からも閲覧・更新可能。Project に保存しない一時 Source / Job フローも併用できます）。
> - 入力、メイン文書、エンジン、出力形式の組み合わせで改訂を識別します。出力形式が異なる版も同じ入力を共有できます。「もう一度変換」で選んだ出力形式は、今回の実行だけに適用します。「初回の設定」を選ぶと改訂に保存した出力形式を使います。
> - 有効な Project 改訂が参照している Source は単体の孤立期限を過ぎても保持され、利用者の保存容量に算入されます。Project の削除は記録の非表示化であり、最後の参照 Project が削除され参照 Job もなくなった時点で Source の保持保護が外れ、期限後に定期クリーンアップで回収されます（即時完全削除が必要な場合は管理者へ相談してください）。

## 表示言語

エディターの**表示言語**はアカウントに保存されます。未設定時はブラウザーの言語を順に確認し、対応する言語がなければ英語を表示します。文書のエンジンや文字コードは別に設定します。

| 対象 | 翻訳される範囲 |
| --- | --- |
| Webとセットアップ | 操作、処理の状態、確認、診断を表示します。 |
| CLIとMCP | CLIのヘルプや案内は端末の表示言語を使います。Remote MCP の説明にはアカウントの言語を使います。 |
| エディター | 編集、検索・置換、保存・競合、コンパイルの状態、プレビュー操作を18言語で表示します。 |
| 公開ガイド | すべてのガイドを下記の18言語で読めます。ページ上部の「表示言語」で切り替えます。 |

エディターの対応言語は、英語、日本語、簡体字中国語、韓国語、スペイン語、ポルトガル語、フランス語、ドイツ語、イタリア語、ロシア語、トルコ語、ポーランド語、チェコ語、オランダ語、スウェーデン語、ノルウェー語（ブークモール）、デンマーク語、フィンランド語です。TeX 本体や第三者パッケージのログは、エラーを調べられるよう原文で表示します。

## 監査ログの復旧

データベースの復元後などに、監査ログの出力位置記録（`export_database_id`・行連番 `export_sequence`・`export_token`）と DB の状態が一致しなくなると、安全のため監査ログのエクスポートとクリーンアップが停止します。

1. 調査・復旧の間、監査ログのエクスポートおよびクリーンアップのサービスとタイマーを停止します。
2. 復旧済み DB、既存の暗号化済みエクスポート出力、現行および旧形式のチェックポイントファイルをすべて別領域へ保全し、復旧先 DB の整合性・外部キー・マイグレーション状態を検証します。
3. 整合するチェックポイントが存在せず、DB に残っている監査行を再出力すると判断した場合は、チェックポイントファイルを有効パスの外へ移動します（`AUDIT_EXPORT_CHECKPOINT` を設定している場合はそのパスも確認。なお、DB 内の監査行・SQLite 連番・`export.lock` は消さずに保持します）。
4. 本番サービスと同じ資格情報でエクスポートを 1 回手動実行し、暗号化出力が復号できることと新しいチェックポイント（形式 3）が生成されたことを確認してから、タイマーを再開します。

※ 再出力されるのは復旧した DB 内に残存していた行です。過去の出力と重複する場合は、タイムスタンプではなく `export_database_id`・`export_sequence`・`export_token` の 3 点セットで重複照合してください。
