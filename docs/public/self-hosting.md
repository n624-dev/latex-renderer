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

このガイドは、1 台の Debian／Ubuntu 系 Linux サーバーに LaTeX Renderer を導入して運用する手順です。既存のサーバーを更新する場合は[更新とロールバック](#更新とロールバック)へ進んでください。ホスト済みサービスを利用する場合は[最初の PDF を作る](/docs/#最短でpdfを作る)から始められます。

### 初回導入の順序

1. 公開方法とログイン方式を選び、[必要なもの](#準備するもの)を揃えます。
2. [v1.6.9 のサーバー配布物をダウンロードして検証](#v1-6-9をダウンロードして検証)します。
3. [ホストを準備](#ホストを準備)し、[HTTPS と認証を設定](#ホスト固有設定を作成)します。
4. [サービスを配置](#サービスを配置)し、[最初の所有者を登録](#最初のowner)します。
5. [TeX 環境を設定](#tex環境の初期設定)し、[実際の変換で導入を確認](#導入完了の確認)します。

新規導入には [v1.6.9 の正式版配布ファイル](https://github.com/n624-dev/latex-renderer/releases/tag/v1.6.9)を使用します。公開後にタグや配布ファイルを差し替えできないリリースで、サーバー用の `latex-renderer-server-1.6.9.tar.gz`、クライアント、Claude Desktop 拡張、チェックサムが含まれます。開発中の `main` からの直接配置はサポート対象外です。

検証済みのビルドと Runtime を配置した準備済みホストでは、[サーバー設定ウィザード](/docs/server-setup/)から初回設定や既存の認証・実行制限の変更を行えます。

## LAN 内の自動 HTTPS

LAN 内で利用する場合は、Akebi でプライベート IP から決まる HTTPS URL を設定できます。[LAN 内の接続・証明書設定](/docs/lan-https/)または[独自の証明書サービスの構築](/docs/lan-https-authority/)へ進んでください。

## 対応する構成

公開経路を選び、その経路で使うログイン方法を決めます。

| 公開方法 | 入口 | ログイン方法 |
| --- | --- | --- |
| `standalone` | Nginx・Caddy・Apache のいずれか、または対応する LAN HTTPS | ローカルパスワード、OIDC、または両方 |
| `cloudflare` | Cloudflare Tunnel と Worker | Cloudflare Access、またはネイティブ認証（パスワード、OIDC、または両方） |

既に組織で使っている ID プロバイダーに利用者を揃えるなら OIDC を選べます。Cloudflare Access を使用する場合は、利用者用の Access Application を用意します。ローカルパスワードを選ぶ場合は、サーバー管理者が利用者を登録します。

ネイティブ認証でパスワードと OIDC を併用する場合は、`AUTH_BACKEND=native`、`AUTH_PASSWORD_ENABLED=true`、`AUTH_OIDC_ENABLED=true` を設定します。`AUTH_MODE` は従来の単一方式用です。以下のコマンド例は単一方式での新規導入を扱います。

対象は apt と systemd を使用できる単一の Linux ホストです。変換は専用ユーザーの rootless Docker で行います。内部サービスはループバックで待ち受け、入口から必要な経路だけを公開します。

## 準備するもの

- sudo を使用できる通常のデプロイ用ユーザーと、TeX イメージ・成果物・バックアップを保存できるディスク。
- Node.js 26 または 24、Corepack、rootless 用ツールを含む Docker Engine。`/usr/local/bin/node` と `/usr/local/bin/corepack` が必要です。
- インターネットへ公開する場合は、利用者が開く HTTPS ホスト名と TLS 証明書。Cloudflare を選ぶ場合は Tunnel、DNS、Worker を設定できる権限。
- 選んだログイン方法に必要な情報。OIDC では issuer・クライアント ID・シークレット・最初の所有者の subject、Cloudflare Access では Access Application と所有者の subject、パスワードでは所有者のログイン名と初期パスワード。
- GitHub の配布物と署名情報を取得する `curl`、`jq`、`tar`、`sha256sum`、`gh attestation verify` 対応版の GitHub CLI。サーバーは GHCR、TeX Live のアーカイブ、Debian 系パッケージリポジトリにも HTTPS 接続できる必要があります。

サーバーの空きが既定の 5 GiB を下回ると、新規レンダリングを拒否します。導入前に、空き 5 GiB に加え、TeX イメージ、リリース、成果物、暗号化バックアップに必要な容量を見込んでください。

## sudoと通常運用の境界

初回導入では、system user、専用ディレクトリ、systemd unit、rootless Docker、秘密ファイルを準備するためにsudoが必要です。初回スクリプトはrootとして直接ログインせず、通常のデプロイ用ユーザーからsudoで実行します。

導入後の通常操作では、WebやAdmin APIへsudo権限を渡しません。

- TeX変更はroot所有のImage Managerへ、権限制限されたUnix socket経由で依頼
- アプリ更新は非rootのUpdate Manager controllerへUnix socket経由で依頼し、固定操作だけを短命root helperへ委譲
- TeX変更とアプリ更新は同じhost lockで直列化
- Web／APIから任意のコマンド、パス、URLをrootへ渡さない

## 設定と秘密情報

ホスト固有設定はReleaseやGit worktreeの外に保存します。

| パス                                                | 内容                                   | 推奨mode |
| --------------------------------------------------- | -------------------------------------- | -------- |
| `/etc/latex-renderer/renderer.env`                  | mode、URL、制限、非秘密のIdP設定       | `0640`   |
| `/etc/latex-renderer/deployment.env`                | Cloudflare profileだけの識別子・token  | `0600`   |
| `/etc/latex-renderer/update-manager.env`            | 非rootのデプロイ用ユーザー             | `0600`   |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | 本番Worker bindingとroute              | `0600`   |
| `/etc/cloudflared/config.yml`                       | Tunnel ingress                         | `0640`   |
| `/etc/latex-renderer/secrets/`                      | pepper、ticket key、manager credential | 個別指定 |
| `/etc/latex-renderer/secrets/oidc-client-secret`    | OIDC profileだけのclient secret        | `0440`   |

> [!WARNING]
> `.env`、Cloudflare token、Tunnel credential、API key、データベース、ユーザー文書、PDF、実ログをGitへ追加しないでください。Issueやサポート依頼にも貼り付けません。

公開リポジトリの`*.example`ファイルは項目確認のための雛形です。設定済みファイルを雛形へ上書きしてcommitする運用はしません。

## v1.6.9をダウンロードして検証

初回導入では、次を同じ Bash セッションで実行します。公開リリースの SHA-256 と、GitHub Actions が署名したビルド来歴を両方検証します。

通常のユーザーで実行してください。

```bash
version=1.6.9
repository=n624-dev/latex-renderer
asset="latex-renderer-server-$version.tar.gz"
unset bundle_root
work_dir=$(mktemp -d) &&
bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
version=$1
repository=$2
asset=$3
work_dir=$4
release_json="$work_dir/release.json"

curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
  "https://api.github.com/repos/$repository/releases/tags/v$version" \
  --output "$release_json"
jq -e --arg version "$version" --arg asset "$asset" '
  .immutable == true and
  .tag_name == ("v" + $version) and
  any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
' "$release_json"

asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  "$asset_url" --output "$work_dir/$asset"
printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
attestation_response="$work_dir/attestations.json"
attestation_bundle="$work_dir/attestations.jsonl"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
  "https://api.github.com/repos/$repository/attestations/$asset_digest" \
  --output "$attestation_response"
jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
gh attestation verify "$work_dir/$asset" \
  --bundle "$attestation_bundle" \
  --repo "$repository" \
  --signer-workflow "$repository/.github/workflows/server-release.yml" \
  --source-ref "refs/tags/v$version" \
  --deny-self-hosted-runners

tar -xzf "$work_dir/$asset" -C "$work_dir"
BASH
```

検証や展開のいずれかで失敗すると、その時点で停止し、`bundle_root` は設定されません。エラーを解決してから続けてください。公開 API が返した来歴データを GitHub CLI に渡すため、GitHub へのログインや API トークンは不要です。

## ホストを準備

新規導入・旧版からの更新ともに、ストレージ権限設定用の`setfacl`、制限されたUpdater内でReleaseを展開する`bsdtar`、更新時の配布ZIP検査用の`unzip`が必要です。Ubuntu／Debianでは、サービスを停止する前に次を実行して確認します。

```bash
sudo apt-get install --no-install-recommends acl libarchive-tools unzip
command -v setfacl
/usr/bin/bsdtar --version
command -v unzip
```

導入スクリプトの前に、Node.js 26 または 24、`/usr/local/bin/node`、`/usr/local/bin/corepack`、Docker Engineのrootless用toolを準備します。`cloudflare` profileだけはcloudflaredも必要です。Update Managerはbundle metadataに記録されたpnpmをCorepackでデプロイ用ユーザーへ導入し、実行前に版を照合します。インストール元はそれぞれの公式ドキュメントを使用し、第三者の非公式スクリプトをrootで実行しません。

```bash
/usr/local/bin/node --version
/usr/local/bin/corepack --version
command -v dockerd-rootless-setuptool.sh
# DEPLOYMENT_MODE=cloudflareの場合だけ
cloudflared --version
```

その後、通常のデプロイ用ユーザーからhost bootstrapを一度実行します。

```bash
sudo sh "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/install-host.sh"
```

この処理は OS パッケージを追加し、専用ユーザー、ディレクトリ、管理用の資格情報を作成します。次に、専用の `latex-render-worker` ユーザーで rootless Docker を使用できるようにします。

```bash
sudo sh "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/configure-rootless-docker.sh"
```

## ホスト固有設定を作成

公開されている雛形をGit管理外のホスト用pathへコピーします。全profileで必要なのは`renderer.env`です。

```bash
sudo install -o root -g latex-renderer -m 0640 \
  "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
sudoedit /etc/latex-renderer/renderer.env
```

`PUBLIC_ORIGIN`、`DEPLOYMENT_MODE`、`AUTH_MODE`を最初に決めます。`ADMIN_ALLOWED_ORIGINS`のような別名設定は使わず、ブラウザmutationの許可originは`PUBLIC_ORIGIN`の完全一致だけです。

`cloudflare` profileでは次も配置します。

```bash
sudo install -o root -g root -m 0600 \
  "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
sudo install -o root -g root -m 0600 \
  "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
  /etc/latex-renderer/gateway-worker.wrangler.jsonc
# host-local Tunnel設定を使用する場合だけ
sudo install -o root -g cloudflared -m 0640 \
  "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
```

各ファイル内の`example.com`、`REPLACE_*`、UUID、Access audienceを自分の環境の値へ置き換えます。Cloudflare tokenを使用する場合だけ`deployment.env`へ追加し、modeを`0600`のまま維持します。

Cloudflare Tunnelをremote管理する場合は、host-localの`config.yml`を使わず、deploy前にconnectorがactiveであることを確認します。不要な雛形を有効な設定として残さないでください。

`standalone` profileでは、Nginx、Caddy、Apacheのいずれか1つを先にインストールし、`deploy/reverse-proxy/`の例をGit管理外の実設定へコピーします。FQDNと証明書pathを置き換え、設定検査を通してからreloadします。proxyは受信した`CF-Access-*`を削除し、client IP headerを上書きし、3100〜3105のloopback serviceを外部へ直接bindしません。

```bash
# Nginxの例
sudo install -o root -g root -m 0644 \
  "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
  /etc/nginx/sites-available/latex-renderer.conf
sudoedit /etc/nginx/sites-available/latex-renderer.conf
sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
sudo nginx -t && sudo systemctl reload nginx
```

`AUTH_MODE=oidc` では、ID プロバイダーに `https://latex.example.com/auth/oidc/callback` をリダイレクト URI として登録します。ホスト名は `PUBLIC_ORIGIN` に合わせます。`renderer.env` に `OIDC_ISSUER` と `OIDC_CLIENT_ID` を設定し、クライアントシークレットは改行なしの別ファイルに保存します。

```bash
sudo install -o root -g latex-renderer -m 0440 /dev/null \
  /etc/latex-renderer/secrets/oidc-client-secret
sudoedit /etc/latex-renderer/secrets/oidc-client-secret
```

## サービスを配置

選択した公開境界、認証、host固有設定が揃ったら、bundleのmetadataから一意なRelease IDを作って配置します。

```bash
release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?配布物の検証を完了してください}/.latex-renderer-release.json")
sudo /usr/local/bin/node "${bundle_root:?配布物の検証を完了してください}/deploy/scripts/bootstrap-published-host.mjs" "$version"
```

このコマンドはproduction serviceとWebが必要とする`client-dist`を先にbuildし、`/opt/latex-renderer/releases/$release_id`へ一緒に固定配置して、Update Managerのsocket、health check、公開境界のsmoke testを確認します。初回配置でOwnerがまだ存在しない場合だけ、認証済みレンダリングsmoke testはOwner登録後まで延期されます。既存環境の更新では配置処理内で自動実行されます。途中で失敗した場合は、エラーを修正せずに同じ処理を繰り返さず、最初に表示された失敗箇所とredacted logを確認します。

初回専用bootstrapは公開済みimmutable artifactを再取得・署名検証し、root所有の制御ツリーと非rootのbuildツリーを分離します。既存のDBまたは`current`がある場合は拒否します。導入後は既存の認証付き更新操作を使用してください。Updater自体はアプリとは別の`/opt/latex-renderer/updater`に保持し、切替失敗時には前のUpdaterへ復旧します。DBの巻き戻しとは別です。運用・復旧と公開時E2Eの詳細はリポジトリの`docs/independent-updater.md`を参照してください。

buildやservice停止の前に、`renderer.env`がroot所有・`0640`・重複keyなしであること、公開originの完全一致、認証mode固有値、OIDC client secretまたはpassword pepperの所有者・group・mode・長さを検査します。検査でcredentialの内容を表示することはありません。失敗した場合は表示された設定項目だけをGit管理外のhost fileで修正し、秘密値をIssueやログへ貼らないでください。

アプリ更新用bundleは専用の`/opt/latex-renderer/update-staging`へ一時配置します。Update Managerはこのroot所有directoryにデプロイ用ユーザーのprimary groupだけが通過できる権限を設定し、ランダム名の各stageはそのユーザーだけが読める`0700`にします。デプロイ用ユーザーを`latex-renderer` groupへ追加しないため、manager state、利用者データ、設定、credentialへアクセス範囲が広がることはありません。通常はoperation終了時に削除し、プロセス中断で残ったstageも24時間後のManager起動時に削除します。

導入作業を`git pull`、未固定の`main`、ローカルのTeX用`docker build`から始める手順は、一般向けセットアップには採用しません。これらは開発・保守用です。

## 公開境界

`cloudflare-access`では同じhuman-user Access Applicationで`/auth/*`、`/app/`、`/admin/`、`/oauth/authorize`を保護し、originでもpathに対応するaudienceを検証します。Cloudflare＋OIDC／passwordでは`/auth/*`をAccessで遮断しません。公開Docsとダウンロードは認証なしで利用でき、Renderer APIの狭い公開面だけをWorker Routesで処理します。

Tunnel ingressは、固有のAPI／管理pathを先に、Web fallbackを後に、最後を`http_status:404`にします。設定例をそのまま使わず、すべての`example.com`、`REPLACE_*`、UUID、audienceを自分の環境の値へ置き換えます。

`standalone`ではTLS reverse proxyが同じpath treeをloopback serviceへ振り分け、small JSON ticketだけをport 3105のStandalone Gatewayへ渡します。Nginx例は接続数とpassword login／ticket APIのrequest rateも制限します。標準Caddy／Apacheには同等のper-client request-count limiterが含まれないため、その2例ではhosting provider／load balancer側のrate limitが必須です。`/internal/*`、DB、manager socketは公開しません。設定例は取得した配布物の `deploy/reverse-proxy/` にあります。反映後は[導入完了の確認](#導入完了の確認)を行ってください。

## 最初のOwner

最初のOwnerはhost上で一度だけ登録します。emailは任意の表示属性です。外部認証の一意キーは`provider + issuer + subject`、password認証の一意キーはlogin nameです。email一致による自動linkやJIT owner作成はありません。

**Cloudflare Access または OIDC の場合**は、次の手順で登録します。subject にはログイン先に登録された利用者の識別子を入力します。

```bash
IFS= read -r -p 'Owner display name: ' owner_name
IFS= read -r -p 'Owner email (optional): ' owner_email

IFS= read -r -p 'Stable subject: ' owner_subject
sudo env \
  LATEX_RENDER_OWNER_EMAIL="$owner_email" \
  LATEX_RENDER_OWNER_NAME="$owner_name" \
  LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
  sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh

unset owner_email owner_name owner_subject
```

**ローカルパスワードの場合**は、次の手順で登録します。例ではログイン名を `owner` にします。

```bash
IFS= read -r -p 'Owner display name: ' owner_name
IFS= read -r -p 'Owner email (optional): ' owner_email
password_file=$(mktemp)
chmod 0600 "$password_file"
read -r -s -p 'Initial password: ' owner_password
printf '%s' "$owner_password" > "$password_file"
unset owner_password
sudo env \
  LATEX_RENDER_OWNER_EMAIL="$owner_email" \
  LATEX_RENDER_OWNER_NAME="$owner_name" \
  LATEX_RENDER_OWNER_LOGIN_NAME=owner \
  LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
  sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
shred -u "$password_file"
unset owner_email owner_name owner_subject password_file
```

選んだ認証方式に対応する方だけを実行します。所有者として `/admin/` にログインできたら、利用者を登録できます。

- **Web・Remote MCP を使う利用者** — 管理画面の**ユーザー**から利用者を作成し、利用するログイン方式と対応する情報を登録します。利用者に Web アプリの URL とログイン方法を案内します。
- **CLI・Local MCP・HTTP API を使う利用者** — 管理画面で利用者に紐づく**サービスアカウント**を作成します。**APIキー → APIキーを発行**からレンダリングキーを作り、変換と結果取得には `render:create` と `render:read:own` を付けます。発行時に表示される `lrk_` キーは利用者へ安全な方法で渡してください。

### 後からAUTH_MODEを変更する場合

既存Ownerをemailで別の認証方式へ自動linkすることはありません。また、`bootstrap-owner.sh`はOwner作成後のcredentialを変更しません。先に暗号化backupを取得し、Admin APIを停止したうえで、Ownerの不変な`user_...` IDへ新しい方式をローカル登録します。IDは管理画面のユーザー詳細またはローカルの`users list`で確認し、email検索で選ばないでください。

```bash
admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
IFS= read -r -p 'Owner user ID: ' owner_id

# oidc / cloudflare-access: target_mode、issuer、subを対話入力
IFS= read -r -p 'Target auth mode: ' target_mode
IFS= read -r -p 'Exact issuer: ' target_issuer
IFS= read -r -p 'Stable subject: ' target_subject
if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
  sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
else
  sudo systemctl stop latex-renderer-admin-api.service
fi
sudo env \
  DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
  API_KEY_PEPPER_ID=v1 \
  API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
  /usr/local/bin/node "$admin_local" auth provision-owner \
  --owner-id "$owner_id" --auth-mode "$target_mode" \
  --issuer "$target_issuer" --subject "$target_subject" --yes
```

passwordへ変更する場合は、passwordをargvや環境変数へ入れません。

```bash
password_file=$(mktemp)
chmod 0600 "$password_file"
read -r -s -p 'Initial password: ' owner_password
printf '%s' "$owner_password" > "$password_file"
unset owner_password
sudo env \
  DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
  API_KEY_PEPPER_ID=v1 \
  API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
  AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
  /usr/local/bin/node "$admin_local" auth provision-owner \
  --owner-id "$owner_id" --auth-mode password --login-name owner \
  --password-file "$password_file" --yes
shred -u "$password_file"
```

どちらか一方だけを実行します。このコマンドはactive Ownerだけを対象にし、既存credentialの上書きを拒否し、auditを記録して既存browser sessionを失効させます。その後に`renderer.env`を対象modeへ変更し、production profile validatorを通してAdmin APIとWebを再起動します。private windowで新方式のloginを確認するまで旧identity／credentialを削除しません。失敗時は旧`AUTH_MODE`へ戻してserviceを復旧し、emailによる回復linkは作りません。

## TeX環境の初期設定

初期設定は`/admin/tex-environment/`から行います。一般的な英語／日本語環境では次を推奨します。

| 項目                      | 推奨値                                              |
| ------------------------- | --------------------------------------------------- |
| Image                     | `latest`                                            |
| Languages                 | `collection-langenglish`、`collection-langjapanese` |
| Automatic image update    | On                                                  |
| Base local build fallback | Off                                                 |

公開GHCR Packageに保存するのは言語collectionを含まないBaseだけです。初回は、そのBaseに選択した言語と現在のRendererコードを重ねたRuntimeをこのサーバーで構築します。同じBase、Renderer、言語構成の完全一致Runtimeがローカルに残っていれば再利用します。RuntimeをGHCRから取得したり公開したりはしません。

`latest` は対応アーキテクチャの検証済み Base を選びます。日付を固定する場合は、ホストのアーキテクチャで使えるタグを指定してください。取得後はダイジェストで固定し、同じ名前の別イメージに切り替わらないようにします。

画面を閉じても TeX 環境の構築は続きます。管理画面に戻り、選んだ言語と稼働中の Runtime を確認してください。取得に失敗した場合は `ghcr.io` に HTTPS で到達できるか、タグがそのアーキテクチャを含むかを確認します。ローカルでの Base のビルドは既定で無効です。

### 自動容量整理

Image Managerは既定で24時間ごとに未使用の管理対象イメージを整理します。現行・直前のロールバック用Base／Runtimeと、Renderer設定が参照するイメージは保護します。それ以外の管理対象イメージは作成から24時間後に削除対象となり、未使用ビルドキャッシュは2GiBを目安に整理します。使用中イメージや共有レイヤーを含むDocker全体の容量上限ではありません。

`/etc/latex-renderer/renderer.env`に次を設定し、作業中のTeX更新がないときに`sudo systemctl restart latex-renderer-image-manager.service`で反映できます。

```dotenv
IMAGE_CLEANUP_INTERVAL_HOURS=24
IMAGE_CLEANUP_RETENTION_HOURS=24
IMAGE_BUILD_CACHE_MAX_GIB=2
```

実行間隔は0で自動整理を無効化、1〜720で時間指定できます。保持期間は0〜8760時間、キャッシュは0〜1024GiBです。起動5分後から5分ごとに期限を確認し、前回成功時刻を保存します。更新・ビルド・デプロイ中は共通ロックで延期します。Web／CLIの手動Cleanupは保護対象以外の管理イメージを保持期間を待たずに整理します。削除したイメージ・キャッシュは必要時に再取得・再構築します。設定済みの環境ファイルはGitに登録しません。

`1.3.4-rc.2`以降は、非rootで実行するDockerクライアントのBuildxメタデータをワーカーのホーム配下の`.docker/buildx-worker`へ分離します。rootで実行したビルドが作るメタデータの権限により清掃が失敗する問題を防ぎます。既存の認証情報や清掃の保護対象は変更しません。旧構成のイメージや手動復旧用ディレクトリは自動削除の対象外です。不要と確認した対象だけを個別に削除し、Dockerのデータディレクトリを直接削除しないでください。

## 導入完了の確認

Owner登録とTeX環境の初期設定が終わったら、初回配置で延期された認証済み本番smoke testを実行します。これは一時的な最小権限API keyを作成し、公開origin経由で実際にレンダリングした後、keyを失効させます。credential自体は標準出力やjournalへ記録しません。

```bash
sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
```

次をすべて満たした時点を初回セットアップ完了とします。

- 必要なsystemd serviceとtimerがactive
- loopbackのhealth endpointが正常
- 未ログイン状態では`/app/`と`/admin/`から選択したlogin flowへ移動
- `/docs/`は未ログインでも閲覧可能
- Ownerが`/admin/`へログイン可能
- 招待済み利用者が`/app/`へログイン可能
- TeX画面が公開GHCR由来のdigestと選択言語を表示
- 英語、日本語、数式、TikZを含むテストがPDF／SVGを生成
- credential、API key、入力文書、PDF、raw logがGitや公開ログに存在しない

## 更新とロールバック

アプリケーションと TeX 環境は別々に更新します。アプリケーションは[サーバーの更新手順](/docs/updates/)、イメージや言語は[TeX 環境の設定](#tex環境の初期設定)を参照してください。

### アプリケーションを更新する

[正式版の確認から適用まで](/docs/updates/#正式版を適用する)を参照してください。更新前にバックアップを検証し、実行中の変換が落ち着く時間を選びます。管理画面から適用するときは通常の保守モードを使います。

### v1.2.xのroot Updaterから権限分離Updaterへ移行する場合

通常更新とは異なる一度限りの管理者操作です。[移行手順と全警告](/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合)を確認してください。同じ失敗操作を繰り返しません。

### GNU tarの展開がFunction not implementedで停止する場合

署名・所有者検証やsystemdの制限を解除しないでください。[展開障害の復旧手順](/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合)を確認し、アプリ・DBとUpdaterの復旧を区別します。

### mutation lockが使用中と表示される場合

処理中は完了を待ち、ロックファイル自体を削除しないでください。[安全確認と復旧手順](/docs/reference/#mutation-lockが使用中と表示される場合)へ進んでください。

## バックアップ

[バックアップの作成・検証・復旧](/docs/backups/)では、定期バックアップと更新直前の復旧点にそれぞれ含まれるデータ、暗号化バックアップの作成と復元テスト、障害時の対応を説明します。監査ログの出力位置に不一致がある場合は[監査ログの復旧](/docs/reference/#監査ログの復旧)を参照してください。

## 問題が起きた場合

| 状況                                | 最初に確認すること                                                    |
| ----------------------------------- | --------------------------------------------------------------------- |
| `/app/`へ到達できない               | DNS、TLS、選択したTunnel／reverse proxy、loopback serviceの順序       |
| 管理者だけログインできない          | Ownerの明示identity／credential、AUTH_MODE、issuer／audience、role    |
| TeX Imageを取得できない             | `ghcr.io`へのHTTPS、PackageのPublic設定、指定tag                      |
| TeX変更が長時間終わらない           | operation IDとImage Managerのredacted log                             |
| アプリ更新が拒否される              | Releaseが差し替え禁止か、asset digest、upgrade path、空き容量         |
| host bootstrapがunsafe pathで止まる | `/var/lib/latex-renderer`が`root:latex-renderer`、mode `2770`か       |
| 更新画面だけ起動しない              | Release内の`client-dist/manifest.json`とAdmin Webのservice状態        |
| レンダリングが開始されない          | queue、空き容量、worker、rootless Docker socket                       |
| 更新直後に問題が起きた              | 新規jobを止め、現在と以前のRelease／Runtimeを確認してからrollback判断 |

診断時は、操作 ID、失敗段階、公開しても安全なエラーコードを記録してください。[問題解決ガイド](/docs/troubleshooting/)と[セキュリティガイド](/docs/security/)も参照できます。

[デプロイ構成の詳細と設定ファイル一覧](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)
