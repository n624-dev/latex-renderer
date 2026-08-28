---
slug: self-hosting
category: セルフホスト
title: 自分のサーバーに構築
description: 対応するサーバー構成、導入前の準備、初期設定、更新とバックアップを説明します。
navOrder: 18
updated: "2026-08-28"
since: "v1.1.0"
---

## 現在の提供状況

一般利用者向けの現在のサーバー用bundleは、[`v1.1.4`](https://github.com/n624-dev/latex-renderer/releases/tag/v1.1.4)です。最初のUpdater対応版v1.1.0に、初回bootstrap、`client-dist`配置順序、共通mutation lock解放、非rootデプロイ用staging、安全な作業directory、Corepackによるpnpm固定版導入の修正を加えています。このReleaseは公開後にタグや配布ファイルを差し替えできない設定で固定され、次を含みます。

- `latex-renderer-server-1.1.4.tar.gz`
- クライアントZIPとClaude Desktop用MCPB
- 3つの配布ファイルを検証する`SHA256SUMS`
- commit、バージョン、Renderer fingerprint、Node.js／pnpm要件を記録したbundle内metadata
- GitHub APIが返す各assetのSHA-256 digest

現在の`main`ブランチをcloneして本番へ直接デプロイしないでください。必ずバージョン付きReleaseを使用します。旧`v1.0.0`にはサーバー用bundleがなく、公開後の差し替え禁止も適用されていないため、Update Managerではインストールできません。

ホスト済みサービスを利用する場合は、[はじめに](/docs/)または[クライアントのインストール](/docs/client/)へ進んでください。

## 対応する構成

最初に対応するセルフホスト構成は、Cloudflareで公開境界を保護する単一Linuxホストです。

| 領域             | 対応構成                                                         |
| ---------------- | ---------------------------------------------------------------- |
| ホスト           | `apt`とsystemdを使用できる専用Debian／Ubuntu系Linuxサーバー      |
| 公開経路         | Cloudflare Tunnel、Access、DNS、限定されたWorker Routes          |
| Renderer         | 専用system userのrootless Docker、networkless／read-only sandbox |
| アプリケーション | Node.js 24、pnpm 11、バージョン固定されたRelease                 |
| TeX              | 公開GHCRの検証済みBase／Runtimeをdigestで固定                    |
| 管理             | `/admin/`、Admin CLI、root所有のImage／Update Manager            |

一般的なリバースプロキシ、Kubernetes、複数ホスト構成、Cloudflareを使用しない認証構成は、現時点の一般向けサポート対象ではありません。

## 準備するもの

- sudoを使用できる非rootのデプロイ用ユーザー
- 専用Linuxホストと、TeX Liveイメージ・成果物・バックアップを保存できるディスク
- Cloudflareで管理しているドメイン
- Cloudflare Tunnel、Access Application、Workerを作成できる権限
- GitHub Releases、`ghcr.io`、TeX Live archive、Debian repositoryへHTTPS接続できるネットワーク
- Ownerとして登録するCloudflare Access identity
- `curl`、`jq`、`tar`、`sha256sum`

既定設定では空き容量が5 GiBを下回ると新規レンダリングを拒否します。TeX Live、複数のRuntime、リリース、成果物、暗号化バックアップにも容量が必要なため、5 GiBをホスト全体の必要容量として扱わないでください。

## sudoと通常運用の境界

初回導入では、system user、専用ディレクトリ、systemd unit、rootless Docker、秘密ファイルを準備するためにsudoが必要です。初回スクリプトはrootとして直接ログインせず、通常のデプロイ用ユーザーからsudoで実行します。

導入後の通常操作では、WebやAdmin APIへsudo権限を渡しません。

- TeX変更はroot所有のImage Managerへ、権限制限されたUnix socket経由で依頼
- アプリ更新はroot所有のUpdate Managerへ、権限制限されたUnix socket経由で依頼
- TeX変更とアプリ更新は同じhost lockで直列化
- Web／APIから任意のコマンド、パス、URLをrootへ渡さない

## 設定と秘密情報

ホスト固有設定はReleaseやGit worktreeの外に保存します。

| パス                                                | 内容                                   | 推奨mode |
| --------------------------------------------------- | -------------------------------------- | -------- |
| `/etc/latex-renderer/renderer.env`                  | URL、制限値、Cloudflare audience       | `0640`   |
| `/etc/latex-renderer/deployment.env`                | Cloudflareのデプロイ識別子・token      | `0600`   |
| `/etc/latex-renderer/update-manager.env`            | 非rootのデプロイ用ユーザー             | `0600`   |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | 本番Worker bindingとroute              | `0600`   |
| `/etc/cloudflared/config.yml`                       | Tunnel ingress                         | `0640`   |
| `/etc/latex-renderer/secrets/`                      | pepper、ticket key、manager credential | 個別指定 |

> [!WARNING]
> `.env`、Cloudflare token、Tunnel credential、API key、データベース、ユーザー文書、PDF、実ログをGitへ追加しないでください。Issueやサポート依頼にも貼り付けません。

公開リポジトリの`*.example`ファイルは項目確認のための雛形です。設定済みファイルを雛形へ上書きしてcommitする運用はしません。

## v1.1.4をダウンロードして検証

次のコマンドは、固定されたReleaseであることをGitHub APIで確認し、APIが返すdigestとダウンロードしたbundleを照合します。通常の非rootユーザーで実行します。

```bash
version=1.1.4
repository=n624-dev/latex-renderer
asset="latex-renderer-server-$version.tar.gz"
work_dir=$(mktemp -d)
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

tar -xzf "$work_dir/$asset" -C "$work_dir"
bundle_root="$work_dir/latex-renderer-server-$version"
```

`OK`が表示されなければ、展開やsudo操作へ進みません。`work_dir`と`bundle_root`は同じシェルで続く手順に使用します。

## ホストを準備

導入スクリプトの前に、Node.js 24、`/usr/local/bin/node`、`/usr/local/bin/corepack`、Docker Engineのrootless用tool、cloudflaredを準備します。Update Managerはbundle metadataに記録されたpnpmをCorepackでデプロイ用ユーザーへ導入し、実行前に版を照合します。インストール元はそれぞれの公式ドキュメントを使用し、第三者の非公式スクリプトをrootで実行しません。

```bash
/usr/local/bin/node --version
/usr/local/bin/corepack --version
command -v dockerd-rootless-setuptool.sh
cloudflared --version
```

その後、通常のデプロイ用ユーザーからhost bootstrapを一度実行します。

```bash
sudo sh "$bundle_root/deploy/scripts/install-host.sh"
```

この処理は専用user、ディレクトリ、manager credentialを作成しますが、サービスはまだ起動しません。`/var/lib/latex-renderer`はroot所有、group `latex-renderer`、mode `2770`とし、その配下の通常データだけを各専用userへ所有させます。Image／Update Managerのroot所有領域を非root所有の親から辿らせないことで、`systemd-tmpfiles`のunsafe path判定を避けます。

## ホスト固有設定を作成

公開されている雛形をGit管理外のホスト用pathへコピーします。次の最初の3ファイルは必須です。

```bash
sudo install -o root -g latex-renderer -m 0640 \
  "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
sudo install -o root -g root -m 0600 \
  "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
sudo install -o root -g root -m 0600 \
  "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
  /etc/latex-renderer/gateway-worker.wrangler.jsonc
```

host-local Tunnel設定を使用する場合だけ、次も実行します。

```bash
sudo install -o root -g cloudflared -m 0640 \
  "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
```

各ファイル内の`example.com`、`REPLACE_*`、UUID、Access audienceを自分の環境の値へ置き換えます。Cloudflare tokenを使用する場合だけ`/etc/latex-renderer/deployment.env`へ追加し、modeを`0600`のまま維持します。設定済みファイルをbundleやGit worktreeへコピーしません。

Cloudflare Tunnelをremote管理する場合は、host-localの`config.yml`を使わず、deploy前にconnectorがactiveであることを確認します。不要な雛形を有効な設定として残さないでください。

## サービスを配置

Cloudflare Access、Tunnel、VPC Service、Worker Routesとホスト固有設定が揃ったら、bundleのmetadataから一意なRelease IDを作って配置します。

```bash
release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "$bundle_root/.latex-renderer-release.json")
sudo sh "$bundle_root/deploy/scripts/deploy-production-release.sh" "$release_id"
```

このコマンドはproduction serviceとWebが必要とする`client-dist`を先にbuildし、`/opt/latex-renderer/releases/$release_id`へ一緒に固定配置して、Update Managerのsocket、health check、公開境界のsmoke testを確認します。途中で失敗した場合は、エラーを修正せずに同じ処理を繰り返さず、最初に表示された失敗箇所とredacted logを確認します。

アプリ更新用bundleは専用の`/opt/latex-renderer/update-staging`へ一時配置します。Update Managerはこのroot所有directoryにデプロイ用ユーザーのprimary groupだけが通過できる権限を設定し、ランダム名の各stageはそのユーザーだけが読める`0700`にします。デプロイ用ユーザーを`latex-renderer` groupへ追加しないため、manager state、利用者データ、設定、credentialへアクセス範囲が広がることはありません。通常はoperation終了時に削除し、プロセス中断で残ったstageも24時間後のManager起動時に削除します。

導入作業を`git pull`、未固定の`main`、ローカルのTeX用`docker build`から始める手順は、一般向けセットアップには採用しません。これらは開発・保守用です。

## Cloudflareの境界

同じhuman-user Access Applicationで`/app/`、`/admin/`、`/oauth/authorize`を保護し、同じAccess audienceを使用します。公開Docsとダウンロードは認証なしで利用でき、Renderer APIの狭い公開面だけをWorker Routesで処理します。

Tunnel ingressは、固有のAPI／管理pathを先に、Web fallbackを後に、最後を`http_status:404`にします。設定例をそのまま使わず、すべての`example.com`、`REPLACE_*`、UUID、audienceを自分の環境の値へ置き換えます。

詳細なAccess policy、Tunnel順序、Worker deploy、境界smoke testは、GitHubの[DEPLOYMENT.md](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)に分離しています。

## 最初のOwner

最初のOwnerは、Cloudflare Accessが返すemail、表示名、Access subjectを使ってhost上で一度だけ登録します。値をシェル履歴へ残さない方法を選び、登録後は`/admin/`へそのidentityでログインできることを確認します。

次の例は値を対話入力し、コマンド履歴へ直接書きません。

```bash
IFS= read -r -p 'Owner email: ' owner_email
IFS= read -r -p 'Owner display name: ' owner_name
IFS= read -r -p 'Cloudflare Access subject: ' owner_subject
sudo env \
  LATEX_RENDER_OWNER_EMAIL="$owner_email" \
  LATEX_RENDER_OWNER_NAME="$owner_name" \
  LATEX_RENDER_OWNER_ACCESS_SUBJECT="$owner_subject" \
  sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
unset owner_email owner_name owner_subject
```

以後の管理者・利用者はWeb管理画面から招待します。レンダリング用の`lrk_` API keyと、Cloudflare tokenや管理用credentialを混同しないでください。

## TeX環境の初期設定

初期設定は`/admin/tex-environment/`から行います。一般的な英語／日本語環境では次を推奨します。

| 項目                         | 推奨値                                              |
| ---------------------------- | --------------------------------------------------- |
| Image                        | `latest`                                            |
| Languages                    | `collection-langenglish`、`collection-langjapanese` |
| Automatic image update       | On                                                  |
| Base local build fallback    | Off                                                 |
| Runtime local build fallback | Off                                                 |

この設定では、完全一致するローカルRuntime、公開GHCR Runtimeの順に再利用します。Packageが存在しない場合でも、長いローカルビルドを暗黙には開始しません。独自言語構成が必要な管理者だけが、GHCRで該当Runtimeが存在しないことを確認したうえでfallbackを明示的に有効にします。

画面を閉じても開始済みoperationは継続します。Webへ再接続できない場合は、Admin CLIまたはsystemd journalからoperation IDを確認します。

## 導入完了の確認

次をすべて満たした時点を初回セットアップ完了とします。

- 必要なsystemd serviceとtimerがactive
- loopbackのhealth endpointが正常
- 未ログイン状態では`/app/`と`/admin/`がCloudflare Accessへ移動
- `/docs/`は未ログインでも閲覧可能
- Ownerが`/admin/`へログイン可能
- 招待済み利用者が`/app/`へログイン可能
- TeX画面が公開GHCR由来のdigestと選択言語を表示
- 英語、日本語、数式、TikZを含むテストがPDF／SVGを生成
- credential、API key、入力文書、PDF、raw logがGitや公開ログに存在しない

## 更新とロールバック

TeXとアプリケーションは別々に更新します。

- TeX：`/admin/tex-environment/`でImage、言語、自動更新を管理
- アプリ：`/admin/updates/`で更新確認、通知／自動ポリシー、適用、ロールバックを管理

アプリ更新は、公開後に差し替えできない固定リリース、固定tag／commit、サーバー用bundleのdigest、埋め込みmetadata、Renderer fingerprint、Node／pnpm要件を検証します。`v1.1.0`以降がこの更新経路に対応します。`v1.0.0`はサーバー用bundleと差し替え禁止設定がないため、Update Managerでは適用できません。

Webでは`/admin/updates/`から更新確認、方針変更、適用、operation確認、rollbackを行います。認証済みのAdmin CLIを使う場合も同じAPIと安全検査を使用します。これが通常の更新経路です。旧Updaterが新しいReleaseのデプロイ処理へ到達する前に失敗する場合だけ、後述のsudo手動更新を使います。

```bash
admin_cli=/opt/latex-renderer/current/apps/admin-cli/dist/index.js
/usr/local/bin/node "$admin_cli" update status
/usr/local/bin/node "$admin_cli" update check
/usr/local/bin/node "$admin_cli" update policy --mode notify --yes
/usr/local/bin/node "$admin_cli" update apply 1.1.4 --yes
```

上の`1.1.4`は更新対象versionを明示する例です。利用可能と表示された実在versionだけを指定します。CLIは事前にAdmin API keyとCloudflare service tokenを設定し、通常ユーザーとして実行します。CLIへsudoを付けません。

更新前にはmaintenance mode、実行中jobのdrain、データベースbackupが必要です。データベースschemaを戻す必要がある場合は、アプリだけを強制的にロールバックせず、対応するbackupを復元します。

### Web／CLIの更新がデプロイ前に失敗する場合

旧Updaterは、新しいReleaseの修正コードが起動する前に、staging directory、実行時のworking directory、pnpmの起動で失敗することがあります。同じWeb operationを繰り返しても、新Releaseの修正は使われません。この場合はv1.1.0〜v1.1.3のUpdaterを経由せず、検証済みのRelease bundleを公式デプロイスクリプトで直接配置します。Web／APIにsudo権限を与える手順ではありません。

最初にこのページの「ダウンロードして検証」を通常のデプロイ用ユーザーで実行し、同じshellの`bundle_root`を使います。失敗したUpdaterのstagingやGit worktreeは再利用しません。bundleに記録されたpnpmをCorepackで用意し、固定lockfileから依存関係を導入します。

```bash
package_manager=$(jq -r .packageManager "$bundle_root/package.json")
case "$package_manager" in
  pnpm@*) ;;
  *) echo 'Release does not declare a supported pnpm version' >&2; exit 1 ;;
esac
pnpm_version=${package_manager#pnpm@}
pnpm_home="$HOME/.local/share/pnpm/bin"
install -d -m 0755 "$pnpm_home"
cd "$bundle_root"
/usr/local/bin/corepack install --global "$package_manager"
/usr/local/bin/corepack enable --install-directory "$pnpm_home"
pnpm="$pnpm_home/pnpm"
[ "$("$pnpm" --version)" = "$pnpm_version" ]
"$pnpm" --dir "$bundle_root" install --frozen-lockfile
release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' \
  "$bundle_root/.latex-renderer-release.json")
```

実行中のTeX変更とアプリ更新がないこと、jobのdrainとbackupが完了したことを確認します。失敗した旧Updaterが残っている場合はUpdate Managerを止め、lockの保持者を確認します。

```bash
sudo systemctl stop latex-renderer-update-manager.service
sudo fuser --verbose /run/latex-renderer/mutation.lock || true
```

表示されたprocessが、完了済みの更新operationが残した孤立lock helperであると確認できた場合だけ、次を実行します。TeX変更またはアプリ更新が実行中なら、processを終了せず完了を待ちます。lockファイル自体は削除しません。

```bash
sudo fuser --kill --signal TERM /run/latex-renderer/mutation.lock
```

固定Release IDを表示して確認し、bundleに含まれる公式デプロイスクリプトをsudoで一度だけ実行します。スクリプトはImage Managerのquiesce、immutable release directoryへの配置、systemd service、Cloudflare Worker／公開Web、health checkとsmoke testを同じ通常デプロイ経路で処理します。

```bash
printf 'Deploying %s\n' "$release_id"
sudo sh "$bundle_root/deploy/scripts/deploy-production-release.sh" \
  "$release_id"
```

デプロイに成功したら、現在のReleaseと必須serviceを確認します。表示するのは公開済みのbundle metadataとservice stateだけです。

```bash
active_release=$(readlink -f /opt/latex-renderer/current)
case "$active_release" in
  /opt/latex-renderer/releases/*) ;;
  *) echo 'current release is outside the immutable release root' >&2; exit 1 ;;
esac
sudo jq -r '.version + " " + .commit' \
  "$active_release/.latex-renderer-release.json"
systemctl is-active \
  latex-renderer-update-manager.service \
  latex-renderer-image-manager.service \
  latex-renderer-api.service \
  latex-renderer-admin-api.service \
  latex-renderer-admin-web.service \
  latex-renderer-worker.service
```

途中で失敗したら同じコマンドをそのまま再実行せず、最初のエラー、`/opt/latex-renderer/current`の指すRelease、停止中serviceを確認します。設定を復旧できるように、host固有の設定・credential・データベースはRelease外に保持し、bundle、Git、Issue、未編集のlogへコピーしません。

### mutation lockが使用中と表示される場合

`MUTATION_LOCK_BUSY`はアプリ更新とTeX変更の同時実行を防ぐ安全機構です。Webに実行中operationが表示されている間は、完了を待ちます。ロックファイル自体を削除してはいけません。使用中のファイルを削除すると、新旧2つのロックが同時に存在できてしまいます。

実行中operationがなく、managerのログでも直前の処理が完了しているのに同じ表示が続く場合だけ、managerを停止して保持者を確認します。

```bash
sudo systemctl stop latex-renderer-image-manager.service \
  latex-renderer-update-manager.service
sudo fuser --verbose /run/latex-renderer/mutation.lock
```

表示されたprocessが完了済みoperationの孤立したlock helperであることを確認できた場合だけ、ロックを保持しているprocessを終了してmanagerを再開します。設定ファイルやcredentialは操作しません。

```bash
sudo fuser --kill /run/latex-renderer/mutation.lock
sudo systemctl start latex-renderer-image-manager.service \
  latex-renderer-update-manager.service
```

再開後にWebから状態を読み直し、アプリ更新とTeX変更を同時には開始しないでください。原因をIssueへ報告する場合も、`/etc/latex-renderer`、credential、入力文書、生成物、未編集の実ログは添付しません。

## バックアップ

最低限、次をReleaseとは別に保全します。

- SQLiteデータベースとWAL整合性を保ったbackup
- `/var/lib/latex-renderer/storage`
- `/var/lib/latex-renderer/image-manager`のdesired／active state
- `/etc/latex-renderer`
- `/etc/cloudflared`
- Cloudflare側のTunnel、Access、Worker構成を復元できる記録

既定のbackupはageで暗号化します。復元テストを行っていないbackupを、復旧可能なbackupとして扱わないでください。秘密鍵と暗号化backupは同じ障害で失われない場所へ保管します。

## 問題が起きた場合

| 状況                                | 最初に確認すること                                                    |
| ----------------------------------- | --------------------------------------------------------------------- |
| `/app/`へ到達できない               | Tunnel、DNS、Access Application、ingressの順序                        |
| 管理者だけログインできない          | Owner invitation、Access subject、audience                            |
| TeX Imageを取得できない             | `ghcr.io`へのHTTPS、PackageのPublic設定、指定tag                      |
| TeX変更が長時間終わらない           | operation IDとImage Managerのredacted log                             |
| アプリ更新が拒否される              | Releaseが差し替え禁止か、asset digest、upgrade path、空き容量         |
| host bootstrapがunsafe pathで止まる | `/var/lib/latex-renderer`が`root:latex-renderer`、mode `2770`か       |
| 更新画面だけ起動しない              | Release内の`client-dist/manifest.json`とAdmin Webのservice状態        |
| レンダリングが開始されない          | queue、空き容量、worker、rootless Docker socket                       |
| 更新直後に問題が起きた              | 新規jobを止め、現在と以前のRelease／Runtimeを確認してからrollback判断 |

診断時もcredentialファイル、Authorization header、ユーザーのSource ZIP、PDF、raw logを表示・共有しません。詳細な運用と障害対応は、GitHubの[OPERATIONS.md](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md)および[SECURITY.md](https://github.com/n624-dev/latex-renderer/blob/main/SECURITY.md)を参照してください。
