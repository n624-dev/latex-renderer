# 管理操作の対応表

関連Issueは [#381](https://github.com/n624-dev/latex-renderer/issues/381) と [#399](https://github.com/n624-dev/latex-renderer/issues/399) です。**○** はその経路で操作できる項目、**×** は専用の経路がない項目です。○の操作にもロール、認可、構成による条件があります。

## 管理画面と管理コマンド

**管理Web** はサイトの認証付き `/admin/` です。**対話** は `n624-latex admin` から端末で対象や操作を選べるかを示します。端末で実行すると、カテゴリと操作を選ぶメニューが開きます。入力を確認し、操作を1件実行します。**サブコマンド**欄の例には `n624-latex admin` を前置します。利用者が公開Webで自分のデータを扱う操作は、末尾の表に記載します。

| 操作 | 対話 | サブコマンド | 管理Web | 補足 |
| --- | :---: | :---: | :---: | --- |
| 管理者のログイン・資格情報登録 | ○ | ○ | ○ | `auth login --api-key-stdin`。Webは設定済みのログイン方式。 |
| 管理者のセッション終了 | × | × | ○ | 管理Webのログアウト。 |
| 管理Webの表示言語を変更 | × | × | ○ | アカウントの表示言語を保存する。 |
| ダッシュボード・稼働状態 | ○ | ○ | ○ | `system status`。CLIは基礎データを表示。 |
| ユーザー一覧・検索・ページ送り | ○ | ○ | ○ | `users list`。 |
| ユーザーの詳細・登録情報 | ○ | ○ | ○ | `users get`。Webは一覧に登録情報と操作を表示。 |
| ユーザーを作成 | ○ | ○ | ○ | `users create`。パスワードまたは外部認証。 |
| ユーザーの表示名・メールアドレスを編集 | ○ | ○ | ○ | `users update`。メールを削除する場合は `--clear-email`。 |
| ユーザーのロールを変更 | ○ | ○ | ○ | `users update --role`。Owner権限が必要。 |
| ユーザーのログイン名・パスワードを更新 | ○ | ○ | ○ | `users set-password`。パスワードは標準入力で渡す。 |
| ユーザーの外部認証の紐付けを解除 | ○ | ○ | ○ | `users unlink-identity`。 |
| ユーザーを無効化・再有効化 | ○ | ○ | ○ | `users disable`、`users enable`。 |
| サービスアカウント一覧・ページ送り | ○ | ○ | ○ | `service-accounts list`。 |
| サービスアカウントの登録情報 | ○ | ○ | ○ | `service-accounts get`。Webは一覧に表示。 |
| サービスアカウントを作成 | ○ | ○ | ○ | `service-accounts create`。 |
| サービスアカウント名・種類を編集 | ○ | ○ | ○ | `service-accounts update`。 |
| サービスアカウントを無効化・再有効化 | ○ | ○ | ○ | `service-accounts disable`、`service-accounts enable`。 |
| サービスアカウントの無効化と全キーの失効を一括実行 | ○ | ○ | ○ | `service-accounts delete`。 |
| APIキー一覧・ページ送り | ○ | ○ | ○ | `api-keys list`。 |
| APIキーの登録情報・スコープを確認 | ○ | ○ | ○ | `api-keys get`。 |
| APIキーの発行・スコープ選択 | ○ | ○ | ○ | `api-keys create`。 |
| APIキーをローテーション | ○ | ○ | ○ | `api-keys rotate`。 |
| APIキーを失効 | ○ | ○ | ○ | `api-keys revoke`。 |
| Job一覧・検索・状態フィルター | ○ | ○ | ○ | `jobs list`。 |
| Job詳細と成果物メタデータ | ○ | ○ | ○ | `jobs get`。ファイル本体の取得は別の行。 |
| 実行中Jobの取消 | ○ | ○ | ○ | `jobs cancel`。 |
| Job全体の再試行 | ○ | ○ | ○ | `jobs retry`。 |
| SVGだけ再試行 | ○ | ○ | ○ | `jobs retry-svg`。 |
| Jobの個別削除 | ○ | ○ | ○ | `jobs delete`。 |
| Jobの一括削除 | ○ | ○ | ○ | `jobs bulk-delete` に対象IDを列挙。 |
| 管理者として使える描画先と入力上限を確認 | ○ | ○ | ○ | `jobs render-targets`。 |
| 管理画面から入力を登録して描画・描画先を選ぶ | × | × | ○ | 通常の利用者CLIでの描画とは別の管理経路。 |
| 管理者としてPDF・SVG等の個別ファイルを取得 | ○ | ○ | ○ | `jobs download <id> --artifact result.pdf --output result.pdf`。 |
| 管理者として成果物の一括ZIPを取得 | ○ | ○ | ○ | `jobs download <id> --output artifacts.zip`。 |
| 管理者としてエラー詳細・描画ログ・PNGを確認 | ○ | ○ | ○ | CLIは `jobs download` でファイルに保存。 |
| Source一覧・検索・ページ送り | ○ | ○ | ○ | `sources list`。 |
| Source詳細・ファイル一覧・関連Job | ○ | ○ | ○ | `sources get`。 |
| 既存Sourceから管理者として描画 | ○ | ○ | ○ | `sources render`。操作を再送する場合は同じ `--idempotency-key` を指定する。 |
| 既存Sourceの引き渡し用参照の発行 | ○ | ○ | ○ | `sources reference`。 |
| Sourceを削除 | ○ | ○ | ○ | `sources delete`。削除可能なSourceが対象。 |
| 実効値・設定元・ホスト既定値を表示 | ○ | ○ | ○ | `system config`。設定キーは下表。 |
| 実効設定を上書き | ○ | ○ | ○ | `system config set`、または管理Webの「編集」。 |
| 上書きを解除してホスト既定値に戻す | ○ | ○ | ○ | `system config reset <key> --reason <reason> --yes`、または管理Webの「ホスト既定値に戻す」。 |
| 保守モードの確認・開始・終了 | ○ | ○ | ○ | `maintenance status`、`enable`、`disable`。 |
| Workerの状態・pause・resume・drain | ○ | ○ | ○ | `worker status`、`pause`、`resume`、`drain`。 |
| チケット署名鍵の一覧・失効 | ○ | ○ | ○ | `ticket-keys list`、`revoke`。 |
| 監査ログの表示・検索 | ○ | ○ | ○ | `audit list`。両方で絞り込み・ページ送りが可能。 |
| 定期バックアップの状態・最終検証の表示 | ○ | ○ | ○ | `backup status`。 |
| バックアップ作成・検証を要求 | ○ | ○ | ○ | `backup create`、`backup verify`。 |
| バックアップの保持日数・世代数・容量上限の確定 | ○ | ○ | × | `backup retention set` または Admin API `POST /backups/retention`。確定時にローカルのバックアップを整理。 |
| バックアップの削除候補・容量予算・保持超過の確認 | ○ | ○ | × | `backup retention` または Admin API `GET /backups/retention`。設定案のプレビュー、日次スケジュール、前回の整理結果も表示。 |
| バックアップから本番DBを復元 | × | × | × | 権限を持つ運用者向けの[復旧手順](public/backups.md)を使用。 |
| TeX環境の状態・イメージ・言語一覧 | ○ | ○ | ○ | `tex status`、`images`、`languages`。 |
| TeX環境の国設定・解除 | ○ | ○ | ○ | `tex country set`、`tex country clear`。 |
| TeX環境のパッケージ・フォント検索 | ○ | ○ | ○ | `tex packages`、`tex fonts`。 |
| TeX環境の適用・ロールバック | ○ | ○ | ○ | `tex apply`、`tex rollback`。 |
| TeX環境の再検証・整理・一覧更新 | ○ | ○ | ○ | `tex revalidate`、`tex cleanup`、`tex refresh`。 |
| TeX環境の操作結果を確認 | ○ | ○ | ○ | `tex operation`。 |
| アプリとUpdaterの稼働版・更新候補を確認 | ○ | ○ | ○ | `update status`、`update check`。 |
| 更新候補の一覧を更新 | ○ | ○ | × | `update refresh`。Webに個別の候補確認はある。 |
| アプリの更新ポリシーを設定 | ○ | ○ | ○ | `update policy`。 |
| アプリを更新・ロールバック | ○ | ○ | ○ | `update apply`、`update rollback`。 |
| アプリ更新の操作結果・ログを確認 | ○ | ○ | ○ | `update operation`。 |
| 管理対象Node.jsとCorepackの版・候補・切替結果 | ○ | ○ | ○ | `update status` のツールチェーン情報。適用は対応するAPT更新で自動実行。 |

### 管理Webと管理CLIで変更できる実効設定

各キーの実効値、設定元（管理者による上書き、ホスト設定、組み込みの既定値）、ホスト既定値は `n624-latex admin system config` と管理Webのシステム設定に表示されます。ホストに対応する設定がないキーは、組み込みの既定値をホスト既定値として表示します。上書きと解除には管理APIの書き込み権限と理由が必要です。上限が現在より高くなる操作にはOwner権限が必要です。

| 設定キー | 対話 | サブコマンド | 管理Web |
| --- | :---: | :---: | :---: |
| `max_queue_length` | ○ | ○ | ○ |
| `max_user_storage_bytes` | ○ | ○ | ○ |
| `max_user_active_jobs` | ○ | ○ | ○ |
| `source_orphan_retention_minutes` | ○ | ○ | ○ |

## サーバー設定ウィザード

CUIは `sudo n624-latex server setup --cui`、Webウィザードは `sudo n624-latex server setup --web` で起動します。Webウィザードの列は一時セットアップ画面を指します。利用者向けの公開サイトや `/admin/` とは別です。**専用の選択肢や入力欄がある操作**を○とし、高度なJSON経路だけの操作は×にして補足します。**非対話**欄は独立したサブコマンド・フラグから対象を設定できる場合を○とします。

| 操作・設定 | CUIの選択・入力 | 非対話 | Webウィザード | 補足 |
| --- | :---: | :---: | :---: | --- |
| 初回の前提条件と空き容量を確認 | × | ○ | × | `server setup --plan`。ウィザード起動前の事前検査。 |
| 初期Ownerの表示名・任意メール・ログイン情報を入力 | ○ | × | ○ | パスワードは非表示入力。外部認証では正確なsubjectを入力。 |
| 初回のデプロイ用OSユーザーを指定 | ○ | × | ○ | 準備済みの非rootユーザーを選ぶ。 |
| 初回のNative Password／OIDC／併用を選ぶ | ○ | × | ○ | CUIの専用選択はAkebiのLAN手順。 |
| 初回のOIDC issuer・client IDを指定 | ○ | × | ○ | CUIの専用選択はAkebiのLAN手順。 |
| 初回のOIDCクライアントシークレットを入力 | ○ | × | ○ | 認証がOIDCを使う場合。 |
| 初回の公開方式と認証をCloudflare Accessに切り替える | × | × | × | 高度なJSON経路。Cloudflare側の準備は別途必要。 |
| 初回の既存Access設定のissuer・audienceを入力 | × | × | ○ | Webは候補にAccess構成がある場合にフィールドを編集できる。 |
| 初回・Ingressの公開範囲を選ぶ | × | × | ○ | CUIの案内は `LAN` で開始。その他はJSON。 |
| 公開URL・待受・許可ネットワークを指定 | × | × | ○ | CUIのAkebi手順ではインターフェースからIP・ネットワークが決まる。 |
| AkebiのLANインターフェース・ポートを選ぶ | ○ | × | ○ | |
| Akebiの共通／カスタム認証局を選ぶ | ○ | × | ○ | カスタムの場合はURL・DNSドメイン・発行元IDも入力。 |
| AkebiのローカルACME／Keyless・一時フォールバックを選ぶ | ○ | × | ○ | 必要に応じてCA規約に同意。 |
| Akebi招待コードを入力 | ○ | × | ○ | 条件に応じて非表示入力。 |
| 独自HTTPSの証明書・秘密鍵を渡す | ○ | × | ○ | CUIの公開方式・TLS設定本体はJSON。証明書と鍵は別入力。 |
| 初回の準備済みRuntimeイメージを指定 | ○ | × | ○ | CUIの専用入力はAkebiのLAN手順。 |
| 既存Native認証のPassword／OIDC／併用を選ぶ | ○ | × | × | Webの既存設定では高度なJSONを使用。 |
| 既存Native OIDCのissuer・client ID・表示名を変更 | ○ | × | × | Webの表示欄は読み取り専用。変更は高度なJSON経路。 |
| 既存認証をAccessとNativeの間で切り替える | × | × | × | 専用入力なし。事前準備と既存の認証切替手順が必要。 |
| 初回のOIDC署名アルゴリズムを指定 | × | × | ○ | CUIの案内は既定の組合せ。WebはOIDCを選択後、許可リストを入力できる。 |
| 既存OIDCの署名アルゴリズムを変更 | × | × | × | 高度なJSON経路。 |
| 既存サーバーのRuntime制限20項目を変更 | ○ | × | ○ | ホスト設定を変更。CUIは順に入力し、空欄で現状維持。 |
| Runtime制限の実効値・設定元を確認し、管理者の上書きを解除 | × | ○ | × | CUIを使用している場合も、別途 `n624-latex admin system config` と `system config reset`、または管理Webで操作。 |
| 初回・IngressでRuntime制限を個別入力 | × | × | ○ | CUIの初回用フローは候補JSONで指定できる。 |
| 設定カテゴリを選んで該当項目だけ入力 | × | × | × | #381で要求されているCUIの改善。 |
| HTTP・Worker・Managerのアイドル設定、稼働モードを変更 | × | × | × | 専用の設定項目は未実装。 |
| バックアップの保持期間・世代・容量を確認して有効化 | × | × | × | 初回・既存とも専用入力が未実装。 |
| 初回構築後のChatGPT連携をスキップ | × | × | ○ | CUIでは連携案内を表示せずにセットアップを終了。 |
| ChatGPT連携を登録・エージェント鍵を交換 | × | ○ | × | `server chatgpt --connect`。鍵を交換する場合は `--rotate-agent-key`。 |
| ChatGPT連携の状態を確認・停止・鍵を廃止 | × | ○ | × | `server chatgpt --status`、`--stop`、`--retire-key`。 |
| 適用前に確認・明示的に適用・取消 | ○ | × | ○ | CUIの確認は `APPLY`。 |
| 初回・Ingressの中断を復旧 | ○ | × | ○ | CUIの復旧は `RECOVER`。 |
| アプリ更新による復旧状態を確認 | × | ○ | × | 別コマンドの `server recovery status`。 |

### 既存サーバーのRuntime制限

下表のキュー数とユーザー保存容量は、サーバー設定のCUIとWebウィザードで変更するホスト既定値です。管理者が上書きすると、その値が実効値になります。端末では `n624-latex admin system config`、ブラウザでは管理Webのシステム設定で、実効値・設定元・ホスト既定値を確認できます。上書きを解除するには、端末で `n624-latex admin system config reset <key> --reason <reason> --yes` を実行するか、管理Webで「ホスト既定値に戻す」を選び、理由を入力して確定します。

| 設定 | CUI | 非対話 | Webウィザード |
| --- | :---: | :---: | :---: |
| `maxUploadBytes` アップロード容量 | ○ | × | ○ |
| `maxExtractedBytes` 展開後の容量 | ○ | × | ○ |
| `maxFileCount` 入力ファイル数 | ○ | × | ○ |
| `maxZipEntries` ZIPエントリー数 | ○ | × | ○ |
| `maxOutputBytes` 出力容量 | ○ | × | ○ |
| `maxOutputFileCount` 出力ファイル数 | ○ | × | ○ |
| `maxOutputDirectoryCount` 出力ディレクトリー数 | ○ | × | ○ |
| `maxLogBytes` ログ容量 | ○ | × | ○ |
| `maxSvgObjects` SVG個数 | ○ | × | ○ |
| `maxSvgBytes` SVG単体容量 | ○ | × | ○ |
| `maxSvgTotalBytes` SVG合計容量 | ○ | × | ○ |
| `svgConversionTimeoutSeconds` SVG変換時間 | ○ | × | ○ |
| `maxQueueLength` 全体キュー数 | ○ | × | ○ |
| `maxUserStorageBytes` ユーザー保存容量 | ○ | × | ○ |
| `minFreeStorageBytes` 最低空きディスク | ○ | × | ○ |
| `jobTimeoutSeconds` Jobの制限時間 | ○ | × | ○ |
| `minimumAvailableMemoryBytes` 描画開始時に必要な空きRAM | ○ | × | ○ |
| `maximumMemoryBytes` 描画中のRAM上限 | ○ | × | ○ |
| `maximumSwapBytes` 追加Swap上限 | ○ | × | ○ |
| `admissionWaitSeconds` 描画開始条件の待機時間 | ○ | × | ○ |

### 障害時のローカル管理

次のサブコマンドはサーバー上の専用ローカル管理経路で実行します。通常の `n624-latex admin` の権限とは異なります。[復旧手順](public/backups.md)と[ローカル管理の実装](../apps/admin-local/src/index.ts)を参照してください。

| 操作 | 端末の対話 | ローカル管理サブコマンド | 管理Web |
| --- | :---: | :---: | :---: |
| ローカルの初期登録・Ownerの認証情報を準備 | × | ○ | × |
| 認証が使えない場合にユーザーを確認・有効化 | × | ○ | × |
| 緊急用の管理キーを発行・一括失効 | × | ○ | × |
| Web・MCPの内部アカウントを診断・復旧し、旧キーを廃止 | × | ○ | × |
| チケット鍵をローカルで失効 | × | ○ | × |

## クライアントの設定と公開Web

**公開Web** は利用者がログインして文書を変換し、Projectや成果物を管理する画面です。CLI列のコマンドには `n624-latex` を前置します。クライアントのセットアップ画面は `setup`／`setup --gui` で開けます。

| 操作 | 端末の対話 | サブコマンド・引数 | 公開Web | 補足 |
| --- | :---: | :---: | :---: | --- |
| 接続先を一覧表示・既定を確認 | ○ | ○ | × | `connection` のメニュー、または `connection list`。 |
| URLとキーを登録・旧キーを引き継ぐ | ○ | ○ | × | `connection add`、`connection migrate`。 |
| 登録済みの接続先のキーを交換 | ○ | ○ | × | 同じ接続名とURLで `connection add`。 |
| 既定の接続を変更 | ○ | ○ | × | `connection use`。 |
| 一度だけ別の接続を指定 | × | ○ | × | `--profile`。 |
| 保存した接続をこの端末から削除 | ○ | ○ | × | `connection remove`。 |
| CLIの認証確認・キー登録・解除 | ○ | ○ | × | 対話は接続メニューの一覧・登録・削除。 `auth status`、`login`、`logout`。 |
| インストールの状態確認・診断 | × | ○ | × | `setup status`、`doctor`。 |
| クライアント修復・削除とMCP／Skillの統合 | × | ○ | × | `setup repair`、`setup remove`、`setup integrations`。一部は端末内のセットアップ画面またはパッケージマネージャーから実行できる。 |
| ファイルを指定して描画・エンジン・出力を選ぶ | × | ○ | ○ | `main.tex`、エンジン名、`render`。 |
| フォルダーまたはZIPを独立したSourceとしてアップロード | × | ○ | × | `source upload`。Webの通常描画は入力アップロードを内包する。 |
| Projectの一覧・詳細・作成・改名・削除 | × | ○ | ○ | `projects list`、`get`、`create`、`rename`、`delete`。 |
| 保存版を作成・再描画・関連Jobを確認 | × | ○ | ○ | `projects save`、`render`、`jobs`。 |
| 保存版のSource ZIPを取得 | × | × | ○ | |
| 共有下書きの編集・自動保存・試し描画 | × | × | ○ | |
| 文書条件の確認・編集 | × | × | ○ | |
| Job詳細・取消・個別削除 | × | ○ | ○ | `jobs get`、`cancel`、`delete`。 |
| PDF・プレビュー・成果物の取得 | × | ○ | ○ | `jobs download`。 |
| Job履歴の一覧と状態フィルター | × | × | ○ | CLIではProject保存版単位の `projects jobs` が利用可。 |
| SVGだけ再試行 | × | ○ | ○ | `jobs retry-svg`。 |
| Job全体を再試行 | × | × | ○ | 管理CLIの再試行は管理操作の表を参照。 |
| 実行環境の能力・パッケージ・フォントを確認 | × | × | ○ | |

## 更新手順

操作、選択肢、利用条件、設定キー、権限が変わる変更では、同じPRで該当行と確認基準を更新します。新設・削除されたコマンドや画面、設定は行も追加・削除します。**×** を **○** に変える場合は、対象経路で操作を確認します。

- [管理CLI](../apps/admin-cli/src/index.ts) · [管理Webの操作](../apps/admin-web/src/browser/admin/) · [Admin API](../apps/admin-api/src/routes/)
- [既存設定CUI](../deploy/scripts/server-setup-cui.mjs) · [初回・Ingress CUI](../deploy/scripts/server-setup-initial-cui.mjs) · [Webウィザード](../deploy/scripts/server-setup-browser.js)
- [管理APIの設定キー](../packages/database/src/runtime-settings.ts) · [サーバー構成の制限](../packages/server-setup-core/src/runtime-review.mjs)
- [利用者CLI](../apps/cli/src/index.ts) · [接続メニュー](../apps/cli/src/connection-menu.ts) · [公開Web](../apps/admin-web/src/assets/app-script.ts)
