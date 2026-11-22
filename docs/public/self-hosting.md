---
slug: self-hosting
category: セルフホスト
title: 自分のサーバーで運用する
description: 対応するサーバー構成、導入前の準備、初期設定、更新とバックアップを説明します。
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## 現在の提供状況

新しいサーバーは、[APT パッケージ](/docs/client/#debian-ubuntu-の-apt-パッケージ)を入れてセットアップウィザードで構築できます。ウィザードで HTTPS、ログイン方法、最初の管理者（Owner）を設定します。

### 初回導入の順序

1. **サーバーを準備する。** [対応 OS と公開方法](#対応する構成)を確認し、[Docker Engine と Nginx を準備](#準備するもの)します。
2. **APT パッケージを入れる。** [Debian / Ubuntu の手順](/docs/client/#debian-ubuntu-の-apt-パッケージ)で `n624-latex` をインストールします。
3. **構築する。** 非 root のデプロイ用アカウントで `sudo n624-latex server setup --plan` を実行します。表示された不足項目を解消したら、[ブラウザでセットアップ](/docs/server-setup/#ブラウザで開く)を進めます。
4. **最初の PDF を作る。** 設定した HTTPS URL を開き、[ログインしてテスト文書を変換](#導入完了の確認)します。最初の TeX 実行環境はセットアップで用意されます。

既存サーバーのバージョンを上げる場合は [管理画面で更新する](/docs/updates/)に進みます。tarball から構築する場合は [手動配置の手順](#v1-6-9をダウンロードして検証)を参照してください。

## LAN 内の自動 HTTPS

LAN 内で利用するときは、**Akebi** でプライベート IP アドレスから決まる HTTPS URL を設定できます。共通の証明書サービスを使う設定から始められます。[LAN で HTTPS を使う（Akebi）](/docs/lan-https/)

## 対応する構成

APT で新規構築できるのは、`systemd` が動作する単一の Debian 12・13 または Ubuntu 24.04・26.04 ホスト（amd64・arm64）です。LaTeX の変換には専用ユーザーの rootless Docker が使われます。

| 公開方法（`DEPLOYMENT_MODE`） | 入口（Ingress） | 選べるログイン方法 |
| --- | --- | --- |
| `standalone` | Nginx・Caddy・Apache のいずれか、または LAN HTTPS（Akebi） | ローカルパスワード、OIDC、または両方併用 |
| `cloudflare` | Cloudflare Tunnel ＋ Worker | Cloudflare Access、またはネイティブ認証（パスワード、OIDC、または両方併用） |

- **OIDC**：組織で運用中の ID プロバイダー（IdP）を使う場合に適しています。
- **Cloudflare Access**：Cloudflare 側で利用者用の Access Application を用意します。
- **ローカルパスワード**：外部 IdP を使わず、サーバー管理画面で利用者を登録します。
- **パスワードと OIDC の併用**：ネイティブ認証（`AUTH_BACKEND=native`、`AUTH_PASSWORD_ENABLED=true`、`AUTH_OIDC_ENABLED=true`）で両方を有効化できます（従来の単一方式は `AUTH_MODE` で指定）。

## 準備するもの

- **作業アカウント。** 非 root のアカウントで接続し、サーバー設定コマンドを `sudo` で実行します。
- **ディスク。** 初回の事前確認では `/opt` と `/var/lib` の各ファイルシステムに **5 GiB 以上の空き**が必要です。これに加えて TeX イメージ、リリース、成果物、暗号化バックアップの分を確保してください。
- **Docker Engine。** 公式リポジトリから Docker Engine と `docker-ce-rootless-extras` を導入します。ウィザードが変換用の rootless Docker を構成します。[Docker の公式手順（Debian）](https://docs.docker.com/engine/install/debian/) · [Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- **Nginx。** `sudo apt install nginx` で導入します。Caddy、Apache、Cloudflare で公開する場合も、APT 版の新規セットアップは Nginx の存在を確認します。
- **公開経路と TLS。** 独自の HTTPS を使う場合はホスト名・証明書・秘密鍵を用意し、組み込み HTTPS で使うアドレスとポートを空けます。Cloudflare を使う場合は Tunnel・DNS・Worker を準備します。[LAN HTTPS を選ぶ場合の前提](#lan-内の自動-https)
- **認証情報**：
  - OIDC：issuer URL、Client ID、Client Secret、最初の所有者の固定 `subject`
  - Cloudflare Access：Access Application の情報と所有者の `subject`
  - パスワード：所有者のログイン名と初期パスワード
- **外部通信要件**：サーバーから GitHub（Releases / Attestations）、GHCR（`ghcr.io`）、TeX Live アーカイブ、Debian / Ubuntu パッケージリポジトリへ HTTPS 接続できること。
- **APT パッケージ。** Node.js はパッケージに同梱されます。[APT パッケージの導入手順](/docs/client/#debian-ubuntu-の-apt-パッケージ)

## 導入完了の確認

1. 設定した HTTPS URL の `/admin/` を開き、セットアップで登録した所有者としてログインします。
2. 同じ HTTPS URL の `/app/` を開き、[サンプルの `main.tex`](/docs/#最短でpdfを作る)を選んで **PDFに変換** を押します。
3. 結果画面から PDF を開き、サンプルの本文が表示されることを確認します。

> [!DETAILS] サービスと出力を追加で検証する
>
> 管理者は公開 URL 経由で変換するスモークテストを実行できます。テストで発行した API キーは直後に失効します。
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> 一般利用者としてのログイン、公開ガイドの閲覧、TeX 環境に表示される言語とイメージ、日本語や SVG など運用で使う出力も確認できます。

### 利用者と API キーの発行

所有者として `/admin/` にログインできたら、利用者を登録します。

- **Web・Remote MCP の利用者**：管理画面の**ユーザー**から利用者を作成し、ログイン方式に対応する識別情報を登録して Web アプリの URL を案内します。
- **CLI・Local MCP・HTTP API の利用者**：管理画面で利用者に紐づく**サービスアカウント**を作成し、**APIキー → APIキーを発行**から `render:create` と `render:read:own` を付けたレンダリングキー（`lrk_...`）を発行して安全な経路で渡します。

## 更新とロールバック

### アプリケーションを更新する

- アプリ本体を更新するには、所有者として **管理 → 更新** を開きます。[正式版への更新とロールバック](/docs/updates/)
- TeX Live の版や言語を変更するには **管理 → TeX環境** を開きます。[TeX 環境の設定](#tex環境の初期設定)

> [!DETAILS] 履歴資料と特殊な復旧手順へのリンク
>
> ### v1.2.xのroot Updaterから権限分離Updaterへ移行する場合
>
> [権限分離 Updater への移行手順](/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合)を参照してください。
>
> ### GNU tarの展開がFunction not implementedで停止する場合
>
> [展開エラーの確認手順](/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合)を参照してください。
>
> ### mutation lockが使用中と表示される場合
>
> [ロックを使用している処理の確認手順](/docs/reference/#mutation-lockが使用中と表示される場合)を参照してください。

## バックアップ

定期バックアップと更新直前の復旧点の作成・復元テスト・データ復旧の手順は、[バックアップを作成・検証・復旧する](/docs/backups/)を参照してください（復元後に監査ログの出力位置不一致が出た場合は[監査ログの復旧](/docs/reference/#監査ログの復旧)を参照）。

## 問題が起きた場合

| 状況 | 最初に確認すること |
| --- | --- |
| `/app/` へ到達できない | DNS、TLS 証明書、Tunnel / リバースプロキシ設定、ループバックサービスの起動順序 |
| 管理者だけログインできない | Owner の明示的な identity / credential、`AUTH_MODE`、issuer / audience、ロール設定 |
| TeX Image を取得できない | `ghcr.io` への HTTPS 疎通、Package の公開設定、指定タグのアーキテクチャ対応 |
| TeX 変更が長時間終わらない | 操作 ID（operation ID）と Image Manager の redacted ログ |
| アプリ更新が拒否される | 対象リリースが immutable か、asset digest、アップグレード経路、ディスク空き容量 |
| host bootstrap が unsafe path で止まる | `/var/lib/latex-renderer` が所有者 `root:latex-renderer`・mode `2770` になっているか |
| 更新画面だけ起動しない | リリース内の `client-dist/manifest.json` の有無と Admin Web のサービス状態 |
| レンダリングが開始されない | キュー状態、ディスク空き容量（5 GiB 以上か）、worker サービス、rootless Docker ソケット |
| 更新直後に問題が起きた | 新規ジョブ受付を止め、新旧の Release / Runtime を確認してからロールバックを判断 |

調査時は操作 ID、失敗した段階、安全なエラーコードを控えてください。あわせて[問題解決ガイド](/docs/troubleshooting/)、[アカウント・文書の安全な扱い](/docs/security/)、[デプロイ構成の詳細と設定ファイル一覧（DEPLOYMENT.md）](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)も参照できます。

## TeX 環境を変更する {#tex環境の初期設定}

初回セットアップで変換に使う TeX 環境が準備されます。言語を追加したいときや TeX Live の版を変更したいときは、**管理 → TeX環境**（`/admin/tex-environment/`）を開きます。英語・日本語を使う場合の設定例です。

| 項目 | 推奨値 |
| --- | --- |
| Image | `latest`（日付固定タグを使う場合はホストのアーキテクチャ対応版を指定） |
| Languages | `collection-langenglish`、`collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off（既定で無効） |

- 公開 GHCR パッケージから取得するのは言語を含まない **Base イメージ**（取得後はダイジェスト固定）だけです。サーバー上で選択した言語と現在の Renderer コードを重ねて **Runtime イメージ**をビルドします（同一構成のローカル Runtime が残っていれば再利用し、Runtime を外部へ公開することはありません）。
- ビルドはブラウザを閉じても継続します。完了後に管理画面で稼働中の Runtime と選択言語を確認してください（取得失敗時は `ghcr.io` への HTTPS 疎通と対応アーキテクチャを確認します）。

### 自動容量整理

> [!DETAILS] 未使用イメージ・ビルドキャッシュの自動容量整理を表示
>
> Image Manager は既定で 24 時間ごとに未使用の管理対象イメージを整理します（現行・直前のロールバック用 Base / Runtime と設定参照中のイメージは保護し、それ以外の管理イメージは作成 24 時間後に削除対象、未使用ビルドキャッシュは 2 GiB を目安に整理します。Docker 全体の容量上限ではありません）。
>
> `/etc/latex-renderer/renderer.env` で調整でき、TeX 更新中でないときに `sudo systemctl restart latex-renderer-image-manager.service` で反映します。
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS`：`0` で自動整理無効、`1`〜`720` 時間で指定（起動 5 分後から 5 分おきに期限確認し、更新・デプロイ中は共通ロックで延期。Web / CLI の手動 Cleanup は保持期間を待たず保護対象外を整理します）。
> - `RETENTION_HOURS`：`0`〜`8760` 時間、`BUILD_CACHE_MAX_GIB`：`0`〜`1024` GiB。
> - `1.3.4-rc.2` 以降は非 root Docker の Buildx メタデータをワーカーホーム配下の `.docker/buildx-worker` へ分離し、root ビルドとの権限競合を防止しています。旧構成イメージや手動復旧ディレクトリは自動削除対象外のため、不要と確認したものだけを個別に消し、Docker データディレクトリ自体は直接削除しないでください。

## sudoと通常運用の境界

初回セットアップでは、専用システムユーザー、ディレクトリ、`systemd` ユニット、rootless Docker、秘密鍵ファイルを準備するために `sudo` を使います。一方、**導入後の通常運用では Web や Admin API に `sudo` 権限を渡しません。**

- **TeX 環境の変更**：権限制限された Unix ソケット経由で root 所有の Image Manager へ依頼します。
- **アプリの更新**：Unix ソケット経由で非 root の Update Manager controller へ依頼し、固定された操作のみを短命な root helper へ委譲します。
- **排他制御**：TeX 変更とアプリ更新は共通の host lock で直列化され、Web / API から任意のコマンド・パス・URL を root へ渡すことはできません。

## 設定と秘密情報

ホスト固有の設定と秘密情報は、アプリ本体や Git 作業ツリーの外側（`/etc/latex-renderer/` 等）に分離して保存されます。

| パス | 内容 | 推奨 mode |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | 公開モード、URL、制限値、非秘密の IdP 設定 | `0640` |
| `/etc/latex-renderer/deployment.env` | Cloudflare プロファイル専用の識別子・トークン | `0600` |
| `/etc/latex-renderer/update-manager.env` | 非 root のデプロイ用ユーザー設定 | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | 本番 Worker の binding と route | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel の ingress 設定 | `0640` |
| `/etc/latex-renderer/secrets/` | pepper、ticket key、manager 資格情報 | 個別指定 |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC プロファイル専用の Client Secret | `0440` |

> [!WARNING]
> `.env`、Cloudflare トークン、Tunnel 資格情報、API キー、SQLite データベース、利用者の文書、PDF、未編集の実ログを Git にコミットしたり、Issue・サポート依頼に貼り付けたりしないでください（リポジトリ内の `*.example` は項目確認用の雛形です）。

## 手動配置・旧版向けの構築手順（tarball 導入）

APT パッケージと `sudo n624-latex server setup` を使う標準手順では、以下の手動展開・ホスト準備・所有者スクリプト実行はウィザードが案内・処理します。手動で `v1.7.0` 配布物から構築する場合や、内部の公開境界・認証変更手順を確認したい場合は以下を開いてください。

> [!DETAILS] v1.7.0 の手動ダウンロード・検証・配置・Owner 登録の詳細手順を表示
>
> 新規の手動導入には、正式版リリース [v1.7.0](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.0)（`latex-renderer-server-1.7.0.tar.gz`）を使用します。このリリースは公開後にタグや配布ファイルを差し替えできない設定です。開発中の `main` ブランチからの直接配置やローカルでの TeX 用 `docker build` は一般運用ではサポート対象外です。
>
> ### v1.7.0をダウンロードして検証 {#v1-6-9をダウンロードして検証}
>
> ダウンロード用に `curl`、`jq`、`tar`、`sha256sum`、`gh attestation verify` が使える GitHub CLI を準備します。サーバー用の Node.js と Corepack は、後述のホスト準備で導入します。
>
> 通常のユーザーで、同じ Bash セッション内で次を実行します。GitHub Releases の SHA-256 と GitHub Actions のビルド来歴署名（Attestation）の両方を検証します（公開 API の来歴データを `gh` に渡すため、GitHub ログインやトークンは不要です）。途中で失敗した場合は `bundle_root` が設定されないため、原因を解決してからやり直してください。
>
> ```bash
> version=1.7.0
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### ホストを準備
>
> ストレージ権限設定用の `setfacl`、制限付き Updater 内で展開に使う `bsdtar`、配布 ZIP 検査用の `unzip` を導入します。また、公式手順で Node.js 26 または 24（`/usr/local/bin/node`、`/usr/local/bin/corepack`）、Docker rootless ツール（`cloudflare` の場合は `cloudflared` も）を事前に用意します（Update Manager は Corepack で指定版の pnpm をデプロイ用ユーザーへ導入・照合します）。
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # DEPLOYMENT_MODE=cloudflare の場合だけ
> cloudflared --version
> ```
>
> 続いて、通常のデプロイ用ユーザーからホスト初期化と `latex-render-worker` 用の rootless Docker 設定を実行します。
>
> ```bash
> sudo sh "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### ホスト固有設定を作成
>
> 全プロファイル共通で `renderer.env` を作成し、`PUBLIC_ORIGIN`・`DEPLOYMENT_MODE`・`AUTH_MODE` を設定します（`ADMIN_ALLOWED_ORIGINS` のような別名設定はなく、ブラウザ操作の許可 Origin は `PUBLIC_ORIGIN` の完全一致のみです）。
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **`cloudflare` プロファイルの場合**：`example.com`・`REPLACE_*`・UUID・Access audience をすべて自分の環境の値へ置き換えます（remote 管理 Tunnel を使う場合はローカルの `config.yml` を置かず、事前に connector が active であることを確認します）。
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # host-local Tunnel 設定を使用する場合だけ
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **`standalone` プロファイルの場合**：Nginx・Caddy・Apache のいずれかを導入し、`deploy/reverse-proxy/` の設定例をコピーして FQDN と証明書パスを設定します（プロキシは受信した `CF-Access-*` を削除し、クライアント IP ヘッダーを上書きし、ポート 3100〜3105 のループバックサービスを外部へ直接 bind しません）。
>
> ```bash
> # Nginx の例
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **`AUTH_MODE=oidc` の場合**：IdP に `https://<PUBLIC_ORIGINのホスト>/auth/oidc/callback` を登録し、`renderer.env` に `OIDC_ISSUER` と `OIDC_CLIENT_ID` を記入したうえで、改行なしの Client Secret を別ファイルに保存します。
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### サービスを配置
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?配布物の検証を完了してください}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - 初回専用 bootstrap は公開済み immutable artifact を再取得・署名検証し、root 所有の制御ツリーと非 root のビルドツリーを分離して `client-dist` をビルドし、`/opt/latex-renderer/releases/$release_id` へ配置します（既存 DB や `current` がある環境では拒否されるため、導入後は通常の更新機能を使います）。
> - 配置前に `renderer.env`（root 所有・`0640`・重複キーなし）、`PUBLIC_ORIGIN`、認証設定と pepper / secret の所有者・権限・長さを検査します（秘密値自体は出力しません）。
> - Updater 本体は `/opt/latex-renderer/updater` に分離保持され（詳細はリポジトリの `docs/independent-updater.md`）、更新用一時領域 `/opt/latex-renderer/update-staging` はデプロイ用ユーザーの primary group のみ通過可能＋各ステージ `0700` で隔離され、終了時（中断時も 24 時間後起動時）に削除されます。
>
> ### 公開境界
>
> - **`cloudflare-access`**：同一の human-user Access Application で `/auth/*`・`/app/`・`/admin/`・`/oauth/authorize` を保護し、origin 側でも audience を検証します（Cloudflare＋OIDC / password の場合は `/auth/*` を Access で遮断しません）。公開 Docs とダウンロードは認証不要で、Renderer API の公開面のみ Worker Routes で処理します。Tunnel ingress は固有 API / 管理パス → Web fallback → `http_status:404` の順にします。
> - **`standalone`**：TLS リバースプロキシがパスをループバックへ振り分け、小さな JSON チケット操作のみポート 3105 の Standalone Gateway へ渡します。Nginx 設定例には接続数と password login / ticket API のレート制限が含まれます。標準 Caddy / Apache には同等の per-client リクエスト制限がないため、上位のロードバランサーやホスティング側でのレート制限が必須です。`/internal/*`・DB・manager ソケットは一切公開しません。
>
> ### 最初のOwner
>
> 外部認証の一意キーは `provider + issuer + subject`、パスワード認証は `login name` です（email は表示属性であり、email 一致による自動リンクや JIT 作成はありません）。選んだ方式の片方だけを一度実行します。
>
> **Cloudflare Access / OIDC の場合**：
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **ローカルパスワードの場合（ログイン名 `owner` の例）**：
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### 後からAUTH_MODEを変更する場合
>
> 以下は[サーバー設定ウィザード](/docs/server-setup/)が使えない場合の手順です。
> 先に暗号化バックアップを取り、Admin API を停止してから、管理画面または `users list` で確認した不変の `user_...` ID に対して新しい認証方式を追加します（既存 credential の上書きは拒否され、既存ブラウザセッションは失効します）。追加後に `renderer.env` を書き換えて Admin API と Web を再起動し、プライベートウィンドウで新方式でのログインを確認するまで旧資格情報は消さないでください。
>
> 次の準備を実行してから、変更先の方式に対応するコマンドだけを実行します。
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **OIDC または Cloudflare Access へ変更する場合**は、`oidc` または `cloudflare-access` を入力します。
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **パスワード認証へ変更する場合**は、パスワードを非表示で入力します。
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
