---
slug: reference
category: 運用・開発
title: 運用・開発の詳細仕様
description: クライアントの保存・復旧、MCP認証、旧版移行の詳細を目的別に確認します。
navOrder: 90
updated: "2026-10-19"
since: "v1.0.0"
---

通常の利用は[クライアント](/docs/client/)・[MCP](/docs/mcp/)、初回導入は[セルフホスト](/docs/self-hosting/)を参照してください。以下は運用・開発や特定の障害に必要な詳細です。秘密情報や利用者の文書を記録へ含めないでください。

## 成果物の保存・復旧の仕様

> [!DETAILS] 仕様・手順を表示
>
> CLIとLocal MCPは `.render/result.pdf`・`job.json`・プレビューなどの既存パスを維持します。
> 広告されたサイズとSHA-256を全ファイルで確認し、一式が揃ってからフォルダーを切り替えます。
> 切替の瞬間だけフォルダーが見えないことがありますが、新旧のファイルを一つのフォルダーへ
> 順次上書きすることはありません。複数のファイルを個別に開く外部プログラムが切替をまたいで
> 読む場合は、同じ世代を読む保証はありません。コマンドの完了後に読み込んでください。
>
> 出力先の兄弟に `<出力名>.latex-renderer-state` という小さい管理フォルダーを置きます。
> 通常の終了時に一時データを削除し、強制終了時の残りは次回のダウンロード開始時に復旧します。
> 確定前なら旧一式に戻し、確定後なら新一式を保持して古い一式を整理します。
> この領域はSourceへのファイル収集から除外されます。処理中・復旧前に手動削除しないでください。
>
> 同じ出力先へ同時に保存すると `OUTPUT_BUSY` で停止します。先の処理が完了してから再試行してください。
> 時間経過だけでは実行中の処理を排除しません。PIDが再利用された場合も安全側に停止します。
> 管理情報の破損や未知のファイル、外部リンクを見つけた場合は、自動削除せず原因の確認を求めます。
>
> 利用者が置いた通常ファイルは次の一式へコピーして引き継ぎます。ダウンロード中の手動編集を
> 検出した場合は公開を中止して編集内容を残します。出力先は専用フォルダーを使ってください。
> 既存/新規の一式は各1 GiB・10,000項目までで、切替中は旧/新一式とダウンロード用一時領域が必要です。
> symlink・hardlink・別ファイルシステムのmountを含む出力は処理しません。
> ローカルファイルシステムを対象とし、ネットワーク共有上のプロセス間排他や電源断時の完全な
> 原子性は保証しません。Windowsでファイルが開かれていて切替できない場合も旧一式を保持し、再試行します。

## Web認証の境界

> [!DETAILS] 仕様・手順を表示
>
> `/app/`、`/admin/` とそのAPIはserver-side sessionで保護され、公開Webの検索索引には
> 含まれません。一般利用者は `/app/`、admin／ownerだけが `/admin/` を利用できます。emailと表示名は認証情報ではなく、外部IdPではissuer＋subject、password modeではlogin nameを使用します。
> ZIP upload、Job、artifact、TeX compileはVPS上のRendererへ送られます。
>
> > [!NOTE]
> > Jobへの接続に使う短時間の認証情報はブラウザへ永続保存しません。必要なときに
> > server-side sessionから再発行します。session cookie、CSRF token、短時間ticketをコピーして共有しないでください。

## Remote MCPの登録・診断

> [!DETAILS] 仕様・手順を表示
>
> 未完了の接続登録は、作成または正しく検証された認可要求から30日間の非活動期間を目安に整理します。
> 有効な認可コードやtoken familyが参照する登録は先に消しません。全登録は最大10,000件です。
> 整理済みの登録が `invalid_client` となった場合は、クライアント側で接続登録を作り直してください。
> 名前を送らない標準的なDCR要求も受け付けますが、指定された名前・redirect URIの検証は維持します。
>
> ブラウザーログインを挟む認可要求は、短いランダムIDで一時保存します。長いOAuth `state` を
> ログインの戻り先URLへ埋め直さず、元の要求をそのまま復元します。記録は10分で失効し、
> 認証済みブラウザーと専用Cookieが一致する場合に一度だけ使用できます。並行するタブは別のIDを使います。
> 全体で1,000件、ブラウザーの継続用Cookieは8件までとし、上限では既存の要求を消さず503を返します。
> DBにはIDとCookie値のハッシュを保存し、期限切れ記録はアクセス時と定期cleanupで回収します。
> 再起動・バックアップ復旧で有効期限は延長しません。失効した場合は接続操作を最初からやり直してください。
> スキーマ20はこの一時記録だけを追加し、既存の利用者・資格情報・Project・Sourceは変更しません。
>
> 登録は信頼する送信元IPごとに15分間10回までです。同じプロキシ出口IPの利用者はこの枠を共有します。
> 11回目以降はHTTP 429、`temporarily_unavailable` と `Retry-After` を返すので、その秒数後に再試行します。
> 不正な登録metadataは枠を消費しません。送信元が欠落・不正な場合は共通の利用者枠へ混ぜず、
> HTTP 503として管理者へプロキシ設定の確認を促します。
> バックエンドはloopbackのままとし、プロキシが `X-Latex-Renderer-Client-IP` を実際の送信元から
> 上書きする構成を使います。任意の `X-Forwarded-For` は採用しません。
> Cloudflare経路では信頼境界内で設定された `CF-Connecting-IP` も扱います。
>
> 管理者はソース内の次のコマンドで、資格情報を送らず公開discoveryと401 challengeを確認できます。
> 接続の追加・設定変更・redirectの追跡は行わず、返却本文・Cookie・秘密情報は出力しません。
>
> ```sh
> node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
> ```
>
> 200のJSON metadataと401のBearer challengeは、実際のブラウザーログインやChatGPTのツール一覧成功を
> 証明しません。接続が失敗する場合は、画面で止まった段階と時刻、`X-Request-ID`、サーバーの
> `remote_mcp.http_result` / `remote_mcp.oauth_stage` / `remote_mcp.protocol_error` / `remote_mcp.rpc_result` を対応させます。
> 診断はdiscovery・register・authorize GET/POST・token・initialize・tools/listの段階、HTTP status、
> 許可されたエラー分類だけを記録します。401の資格情報拒否と、検証処理自体の5xxを区別します。
> OAuth code、token、Cookie、PKCE verifier、Source、利用者IDをIssueやログへ貼らないでください。
>
> 「認証成功、アクション検出失敗」やツール更新失敗では、token発行後の `initialize`、初期化通知、
> `tools/list` を分けて確認します。HTTP 200でもJSON-RPCの `error` は成功ではありません。
> `remote_mcp.rpc_result` は、HTTP status、固定の成功／失敗分類、対応するprotocol version、
> ツール件数、応答バイト数と一覧の基本形を記録します。全スキーマのコンパイル検査はHTTP試験で行い、
> 実行時には大きなスキーマキャッシュを追加しません。本文の確認用領域は最大256KiBで、超過時は
> `inspection_limited` と記録するだけです。応答は省略・書換えせず、そのまま送信します。
> 通常のツール実行結果や文書本文はこの確認の対象外です。
>
> 記録がない場合も、ログ範囲の不足と、クライアント・プロキシから要求が到達しない場合を区別してください。
> SSE応答やGETの405だけで障害と判断せず、HTTPのAccept・Content-Type・protocolの交渉を確認します。
> 一覧の基本形やCIのスキーマ検査が成功しても、実際のChatGPTでの登録・同意・ツール一覧取得と更新の確認は別途必要です。
>
> リポジトリのHTTP試験は、ローカルsocket経由で登録・同意・PKCE交換・SDK初期化・ツール一覧を
> 確認します。外部OIDC、Cloudflareの実ポリシー、ChatGPT Webの実アカウントでの接続成功とは区別します。

## MCPの結果とResource

> [!DETAILS] 仕様・手順を表示
>
> Remote MCPの結果は3層で返します。標準 `content` には、AIが判断や次のtool呼び出しに必要なSource ID、Job ID、status、offset、cursor、availability、bounded diagnosticsを必ず含めます。`structuredContent` は同じvalidated resultの完全な機械処理表現として維持します。PDF、完全なcompile log、raw JSON等の大容量データは、同じOAuth利用者だけが読める `latex-renderer://jobs/...` Resourceとして返します。
>
> SVG出力を指定したJobでは、結果に含まれる `svg/manifest.json` と `svg/objects/*.svg` の `resourceUri` も同じMCP Resource読取で取得できます。所有者・保持期限・Resourceのサイズ上限はPDF等と共通です。
>
> `structuredContent` やcustom Resourceをモデルへ公開しないMCPクライアントでも、標準 `content` だけでSource作成、chunk upload、render、状態確認、修正、再renderまで継続できます。Resource対応クライアントは完全PDFや完全ログも取得できます。APIキー、OAuth token、upload/render ticket、Source本文、raw base64は結果へ追加しません。

## CLIの待機と再試行

> [!DETAILS] 仕様・手順を表示
>
> 終了待ちの状態取得で、一時的なHTTP 502・503・504（HTTPエラーまたは不正なJSON応答）が発生した場合は、同じJobの状態取得だけを最大5回再試行します。待ち時間は1・2・4・8・8秒で、待機全体のタイムアウトは延長しません。ジョブ作成・アップロード・操作用トークン更新・成果物の検証は再試行せず、認証や権限のエラーもそのまま返します。状態取得が失敗しても、サーバー上のジョブが停止したとは限りません。

## CLIのJSON形式

> [!DETAILS] 仕様・手順を表示
>
> 成功時の形式:
>
> ```json
> {
>   "success": true,
>   "command": "auth.status",
>   "result": { "configured": true }
> }
> ```
>
> エラー時の形式:
>
> ```json
> {
>   "success": false,
>   "command": "auth.login",
>   "error": {
>     "code": "INVALID_API_KEY",
>     "message": "Input is not a render API key",
>     "status": 400
>   }
> }
> ```
>
> レンダリングがコンパイル失敗などの終了状態になった場合は、`result` にジョブと保存先を含めたうえで `success: false` を返し、終了コードを `2` にします。通常のCLI/APIエラーは終了コード `1` です。APIキー、upload ticket、job ticketはJSONへ含めません。

## 旧版からの移行と特殊復旧

> [!DETAILS] 仕様・手順を表示
>
> ### v1.2.xのroot Updaterから権限分離Updaterへ移行する場合
>
> v1.2.xまでのUpdate Managerはroot daemonです。v1.3.0以降は、長寿命controllerを`latex-renderer-update`ユーザーへ分離し、固定verbだけを受け取る短命root helperを使用します。旧Updaterから初回更新すると`Application Update Manager must use a separate non-root build tree`で停止する場合があります。同じWeb operationを繰り返しません。
>
> この移行だけは、先にこのページの「ダウンロードして検証」を通常ユーザーで実行し、展開した対象Releaseから次の専用コマンドを一度実行します。`VERSION`は`bundle_root`のReleaseと完全一致させます。通常のデプロイスクリプトをuser所有build treeからsudo実行する旧手順は使用しません。
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> 専用コマンドはroot側で同じImmutable Releaseを再ダウンロードし、GitHub APIのdigest、固定tag／commit、匿名取得したSigstore bundle、archive上限、埋め込みmetadataを再検証します。GitHub CLIはroot所有かつgroup／other書込み不可の`/usr/local/bin/gh`または`/usr/bin/gh`だけを許可します。その後、root所有の`verified` tree、非rootの`bootstrap-build` tree、許可した成果物だけを含むroot所有の`assembly` treeを作ります。pnpmはoperation専用tree内のCorepack shimから固定versionだけを使用し、user／global環境を変更しません。旧managerを止めるのはbuildと検証が終わり、共有mutation lockを取得した後だけです。失敗時は旧managerを再開し、成功時は`User=latex-renderer-update`になったことまで確認します。Web／APIへsudo権限やGitHub tokenを渡しません。
>
> 成功後は次だけを確認します。以後の更新はWebまたはAdmin CLIを使用し、このtransitionコマンドは再実行しません。
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
> 途中で失敗したら同じコマンドをそのまま再実行せず、最初のエラー、`/opt/latex-renderer/current`の指すRelease、停止中serviceを確認します。host固有の設定・credential・データベースはRelease外に保持し、bundle、Git、Issue、未編集のlogへコピーしません。
>
> ### GNU tarの展開がFunction not implementedで停止する場合
>
> UbuntuのGNU tarが`openat2`を使う環境では、Updaterの`RestrictSUIDSGID=true`によって展開が`ENOSYS`（Function not implemented）で失敗することがあります。平坦なファイルだけのテストでは再現しないため、階層付きarchiveで検証します。新しいUpdaterは署名・checksum・GNU tarによるarchive検査を維持し、展開だけ固定の`/usr/bin/bsdtar`に切り替えます。所有者・ACL・拡張属性等をarchiveから取り込まず、私有の空stagingだけに展開します。`RestrictSUIDSGID`を解除したり、システム全体の`tar`を置き換えたりしません。
>
> 旧Updaterは修正版自身の展開にも失敗するため、この場合の初回移行だけは既にインストール済みの管理者向けbootstrapを使用します。先にoperationが終了済み、アプリとDBが正常、復旧処理がpendingでないことと暗号化backupの復元可能性を確認します。`VERSION`には、この修正を含む**公開済みimmutable Release**を指定してください。例のversionが未公開の場合は実行しません。
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # この修正を含む公開済みimmutable Releaseのversionに置換
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> bootstrapは通常の管理者shellから実行します。固定Releaseをroot側で再取得してdigest・tag/commit attestation・archive制限とUpdater envelopeを検証し、共有mutation lockの下で独立Updaterだけを更新します。アプリの`current`やDBはこの操作で切り替えません。凍結されたbootstrap-v1自体も差し替えません。途中で失敗した場合は状態とログを確認し、無条件に再実行しません。Updaterの新version/commit、ready/pending=false、active operationなしを確認後、同じ固定versionを通常のWeb／Admin CLI `update apply`で適用します。署名検証を迂回する手動コピーは使用しません。
>
> `v1.4.0-rc.3`のUpdaterには、rootがコピーしたbundleの所有者が非rootのまま残る環境で、アプリ適用が`Release extraction requires a private regular bundle`で停止する既知の問題があります。このエラーに対して所有者検査を解除したり、公開済みslotを直接編集したりしません。所有者修正を含む新しい公開済みReleaseへUpdaterのみ先行更新し、その後アプリを適用してください。Updater更新の成功だけではアプリ更新の成功を意味しません。アプリのcurrent、DB、service、recovery pendingを別々に確認します。
>
> root/systemd環境が必要な展開検証は、修正済みソースの`sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`で実施できます。専用の小fixtureで実際のhelperのコピー処理を呼び、非root所有の入力を変更せず、新しいroot専用コピーだけがroot:root/0600/単一inodeとなることと、そのコピーの展開を検証します。さらに短命非root unitで、実際の`RestrictSUIDSGID=true`等の制限下で現行の展開moduleを実行します。既存serviceの設定は変えず、一時ファイルは終了時に削除します。リリース前の署名付き更新・復旧E2Eも両方の検証を実行します。
>
> ### mutation lockが使用中と表示される場合
>
> `MUTATION_LOCK_BUSY`はアプリ更新とTeX変更の同時実行を防ぐ安全機構です。Webに実行中operationが表示されている間は、完了を待ちます。ロックファイル自体を削除してはいけません。使用中のファイルを削除すると、新旧2つのロックが同時に存在できてしまいます。
>
> アプリ更新中の内部TeX Runtime復元でこのエラーが出た場合は、同じWeb operationを再実行しません。Update Manager自身が保持するlockとの自己競合である可能性があるため、operation log、現在のRelease、停止中serviceを確認します。rollbackでは保護済みのimmutable Releaseを直接非rootユーザーへ公開せず、専用stagingへ一時複製して固定デプロイ処理を実行し、完了後に複製を削除します。
>
> 実行中operationがなく、managerのログでも直前の処理が完了しているのに同じ表示が続く場合だけ、managerを停止して保持者を確認します。
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> 表示されたprocessが完了済みoperationの孤立したlock helperであることを確認できた場合だけ、ロックを保持しているprocessを終了してmanagerを再開します。設定ファイルやcredentialは操作しません。
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```
>
> 再開後にWebから状態を読み直し、アプリ更新とTeX変更を同時には開始しないでください。原因をIssueへ報告する場合も、`/etc/latex-renderer`、credential、入力文書、生成物、未編集の実ログは添付しません。

## 過去RCのRenderer識別情報

> [!DETAILS] 仕様・手順を表示
>
> RC.3からRC.4への更新は、旧Updaterが5ファイル、新しい配布metadataが6ファイルでRenderer識別hashを計算する互換性問題により、サービス切替前に失敗します。RC.4を再適用したり、検証を無効化したりせず、修正版RC.5を明示してください。
>
> RC.5は旧Updater用の5ファイルのmetadata項目を固定し、6ファイルのRuntime識別値を別のバージョン付き項目へ分離します。新Updaterは両方を照合します。旧Updaterも追加ファイルを含む配布物全体のchecksumとprovenanceを検証するため、追加ファイルが署名の対象外になることはありません。Runtimeの再利用判定には引き続き6ファイルを使います。稼働中のUpdaterへの直接パッチは不要です。

## Updaterの実行領域

> [!DETAILS] 仕様・手順を表示
>
> Update Managerは配布物を検証したroot所有の`verified` tree、依存導入とbuildだけを行う非rootの`build` tree、許可した成果物だけを戻したroot所有の`assembly` treeを分離します。rootが実行するデプロイスクリプトは`assembly`側の検証済みコピーで、非root build tree内のスクリプトは実行しません。Cloudflare公開処理などを設定済みdeployment userで行う場合も、controller所有treeを直接渡さず、rootが検査後に固定した一時`deployment-build`コピーを使用します。rollbackも同じ分離を使います。

## Windowsの配置と保護

> [!DETAILS] 仕様・手順を表示
>
> Windowsでインストール先を変更すると、既定のコマンド配置先もその配下の `bin` になります。
> `LATEX_RENDER_BIN_DIRECTORY` を別途指定した場合は、その場所へ管理対象のランチャーを設置し、
> 同じ場所をユーザーのPATHとLocal MCPで使います。既存の別ランチャーは上書きしません。
> 以前の版が別のPATHを記録していた場合は `setup repair` で修正できます。
> 旧PATH項目は他の用途との競合を避けるため保持します。インストール先とbinには絶対パスを使い、
> PATH区切りのセミコロンや引用符・制御文字を含めないでください。
>
> PDFやセットアップ画面を開く処理が失敗しても、保存済みPDFは削除しません。
> 表示されたパスまたはセットアップURLから手動で開けます。

## 保存プロジェクトの共有・保持

> [!DETAILS] 共有と保持の仕様を表示
>
> [`/app/`](/app/) からアップロードした文書はプロジェクトへ保存されます。同じ
> プロジェクトを保存先に選び、Sourceまたはentrypointを変えると不変の改訂が追加され、元のファイル名、entrypoint、
> 各改訂から作ったJobを確認できます。改訂の「もう一度変換」は保存済みSourceを
> 使うため、同じファイルを再アップロードしません。同じSource・entrypointなら、
> PDF／PDF＋SVGの出力形式だけを変えても改訂は増えません。出力形式と結果は各Jobへ
> 記録されます。「もう一度変換」の出力形式で指定でき、「初回の設定」を選ぶと
> その改訂を初めて作ったときの設定を使います。既存の変換履歴は書き換えません。
>
> 保存Projectと改訂履歴は同じユーザーのWeb・CLI・公開API・Local MCP・Remote MCPで共通です。同じユーザーの複数のAPIキー／Service Accountから閲覧・更新できます。Projectに保存しない一時的なSource／Jobのフローも残ります。AIやCLIが保存した改訂もWebに表示され、どの経路からでも固定の改訂IDで再レンダリングできます。
>
> プロジェクトを削除してもJobを即時削除せず、それぞれの既存の保存期限に従います。
> アクティブなプロジェクトが参照しているSourceは、再レンダリングできるよう保持
> され、Source単体の保存期限を過ぎても再変換できます。保持中のSourceも利用者の
> 保存容量に算入されます。最後の参照プロジェクトを削除すると保持の保護が外れ、
> 参照Jobもなく保存期限を過ぎたSourceは定期クリーンアップで回収されます。
> プロジェクト削除は記録の非表示であり、入力や成果物の完全削除では
> ありません。完全削除が必要な場合は管理者へ相談してください。
