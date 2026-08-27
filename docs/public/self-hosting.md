---
slug: self-hosting
category: セルフホスト
title: 自分のサーバーに構築
description: 対応するサーバー構成、導入前の準備、初期設定、更新とバックアップを説明します。
navOrder: 18
updated: "2026-08-28"
since: "v1.0.0"
---

## 現在の提供状況

> [!WARNING]
> 一般利用者向けのサーバーインストールは、まだ正式提供前です。公開済みの`v1.0.0`にはクライアント配布物だけが含まれ、検証済みのサーバー用配布ファイルは含まれていません。また、`v1.0.0`は公開後の差し替えを禁止した固定リリースではないため、サーバーの自動更新機能は安全上の理由から適用を拒否します。

現在の`main`ブランチをcloneして本番へ直接デプロイしないでください。このページでは、正式なserver bundleが公開されるまでに準備できる内容と、公開後に利用する初期設定・運用方針を説明します。ホスト済みサービスを利用する場合は、[はじめに](/docs/)または[クライアントのインストール](/docs/client/)へ進んでください。

正式提供の条件は次のとおりです。

- 公開後にタグや配布ファイルを差し替えできない固定リリース（GitHub Immutable Release）
- commit、バージョン、Renderer fingerprintを含むサーバー用bundle
- GitHub APIから確認できるSHA-256 digest
- 対応するNode.js・pnpmバージョンとアップグレード経路
- 新規ホストで完了するインストールと実レンダリングの検証

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
| `/etc/cloudflared/config.yml`                       | Tunnel ingress                         | `0600`   |
| `/etc/latex-renderer/secrets/`                      | pepper、ticket key、manager credential | 個別指定 |

> [!WARNING]
> `.env`、Cloudflare token、Tunnel credential、API key、データベース、ユーザー文書、PDF、実ログをGitへ追加しないでください。Issueやサポート依頼にも貼り付けません。

公開リポジトリの`*.example`ファイルは項目確認のための雛形です。設定済みファイルを雛形へ上書きしてcommitする運用はしません。

## 正式Release公開後の導入順序

一般向けserver bundleが公開された後は、次の順序を正式なセットアップ経路にします。このページには、bundle名、digest検証、実行コマンドが新規ホストで検証された時点で追記します。

1. Releaseとサーバー用bundleが公開後に差し替えできないことを確認
2. GitHub APIが返すdigestとダウンロードしたbundleのSHA-256を照合
3. 非rootのデプロイ用ユーザーから、sudoで一度だけhost bootstrapを実行
4. Node.js 24、pnpm 11、`latex-render-worker`用rootless Docker、cloudflaredを準備
5. `/etc/latex-renderer`と`/etc/cloudflared`へhost-local設定を作成
6. Cloudflare Tunnel、Access、Worker Routesを設定
7. バージョン付きReleaseを`/opt/latex-renderer/releases/`へ配置し、サービスを起動
8. 最初のOwnerを登録
9. 公開GHCRからTeX Runtimeを適用
10. health check、Access境界、英語／日本語の実レンダリングを確認

導入作業を`git pull`、`pnpm install`、ローカルの`docker build`から始める手順は、一般向けセットアップには採用しません。これらは開発・保守用です。

## Cloudflareの境界

同じhuman-user Access Applicationで`/app/`、`/admin/`、`/oauth/authorize`を保護し、同じAccess audienceを使用します。公開Docsとダウンロードは認証なしで利用でき、Renderer APIの狭い公開面だけをWorker Routesで処理します。

Tunnel ingressは、固有のAPI／管理pathを先に、Web fallbackを後に、最後を`http_status:404`にします。設定例をそのまま使わず、すべての`example.com`、`REPLACE_*`、UUID、audienceを自分の環境の値へ置き換えます。

詳細なAccess policy、Tunnel順序、Worker deploy、境界smoke testは、GitHubの[DEPLOYMENT.md](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)に分離しています。

## 最初のOwner

最初のOwnerは、Cloudflare Accessが返すemail、表示名、Access subjectを使ってhost上で一度だけ登録します。値をシェル履歴へ残さない方法を選び、登録後は`/admin/`へそのidentityでログインできることを確認します。

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

アプリ更新は、公開後に差し替えできない固定リリース、固定tag／commit、サーバー用bundleのdigest、埋め込みmetadata、Renderer fingerprint、Node／pnpm要件を検証します。現在の`v1.0.0`は公開後の差し替えを禁止する設定がないため、Update Managerでは適用できません。

更新前にはmaintenance mode、実行中jobのdrain、データベースbackupが必要です。データベースschemaを戻す必要がある場合は、アプリだけを強制的にロールバックせず、対応するbackupを復元します。

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

| 状況                       | 最初に確認すること                                                    |
| -------------------------- | --------------------------------------------------------------------- |
| `/app/`へ到達できない      | Tunnel、DNS、Access Application、ingressの順序                        |
| 管理者だけログインできない | Owner invitation、Access subject、audience                            |
| TeX Imageを取得できない    | `ghcr.io`へのHTTPS、PackageのPublic設定、指定tag                      |
| TeX変更が長時間終わらない  | operation IDとImage Managerのredacted log                             |
| アプリ更新が拒否される     | Releaseが差し替え禁止か、asset digest、upgrade path、空き容量         |
| レンダリングが開始されない | queue、空き容量、worker、rootless Docker socket                       |
| 更新直後に問題が起きた     | 新規jobを止め、現在と以前のRelease／Runtimeを確認してからrollback判断 |

診断時もcredentialファイル、Authorization header、ユーザーのSource ZIP、PDF、raw logを表示・共有しません。詳細な運用と障害対応は、GitHubの[OPERATIONS.md](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md)および[SECURITY.md](https://github.com/n624-dev/latex-renderer/blob/main/SECURITY.md)を参照してください。
