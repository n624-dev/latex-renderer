---
slug: lan-https-authority
category: セルフホスト
title: Akebi の証明書サービスを自分で運用する
description: LAN 用ドメインの DNS 委任、証明書発行、招待制または自動登録を設定します。
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

このページは、独自の証明書サービスを運用する管理者向けです。共通サービスで LaTeX Renderer を LAN に公開する手順は [LAN で HTTPS を使う（Akebi）](/docs/lan-https/)にあります。

事前に、委任できる DNS ゾーン、公開 DNS と HTTPS を運用できる Linux ホスト（amd64 または arm64）、対応する Node.js（24 または 26）、利用する CA のアカウントを用意します。[手動ダウンロード手順](/docs/self-hosting/#v1-6-9をダウンロードして検証)で署名を検証したサーバー配布物を使用します。

## DNS を委任する

親ドメインの DNS ゾーンに次のレコードを設定します。Akebi の DNS サーバーは、インターネットから **UDP と TCP の両方で 53 番ポート**へ到達できる必要があります。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebi DNS サーバーの公開 IPv4 アドレス |
| `A` | `akebi.example.org` | Akebi API 用 HTTPS リバースプロキシの公開 IPv4 アドレス |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- `ns1.example.org` は DNS 専用にし、API のホスト名（`akebi.example.org`）は LAN 証明書の対象ゾーン（`lan.example.org`）の外側に置きます。
- 委任後は、LAN の IP 由来の `A` / `AAAA` 応答と ACME 検証用の `TXT` 応答を Akebi サービス自身が動的に返すため、親ゾーンに個別の IP レコードを追加する必要はありません。

## サービスを配置する

1. **専用ユーザーと状態ディレクトリの作成**：アプリケーション本体とは権限を分け、専用ユーザー・グループ `latex-renderer-lan-authority` を作成します。その所有者で `/var/lib/latex-renderer-lan-authority` と配下の `keyless` ディレクトリを作成し、両方とも mode `0700` にします。
2. **設定ディレクトリの準備**：`/etc/latex-renderer-lan-authority` を `root:latex-renderer-lan-authority`・mode `0750` で作成します。検証済み配布物内の `deploy/lan-https/examples/authority.json` をそこへコピーし、`root:latex-renderer-lan-authority`・mode `0640` にします。
3. **`authority.json` の編集**：
   - `policy.serverOrigin`：API の HTTPS URL（例：`https://akebi.example.org`）
   - `policy.lanDomain`：委任した LAN ドメイン（例：`lan.example.org`）
   - `dns.nameserver` / `dns.listeners`：公開 DNS のホスト名と待受アドレス（ホスト上の既存 DNS が 53 番を使っている場合は競合しない公開 IP を指定）
   - `http`：ループバックアドレスに固定
   - `issuers`：利用する公開 CA を設定。EAB（External Account Binding）が必要な CA では、指定した `eabFile`（専用ユーザー所有・mode `0600`）に `kid` と `hmacKey` を保存します。ドメインで CAA レコードを使っている場合は対象の CA を許可してください。
4. **コードと systemd ユニットの配置**（検証済みの root 所有ソースを `/path/to/verified-release` に置いた例）：

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **状態の初期化と起動**（`init` は初回のみ実行）：

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS 証明書を用意する

API 公開用の Nginx 設定例は `deploy/lan-https/examples/authority.nginx.conf` にあります（ループバックの API へ転送します）。Nginx の TLS 設定を有効化する前に、API 自身の証明書を取得します。

Certbot で自動更新する場合、CA・連絡先・規約同意・必要な EAB 情報を root 専用の `/etc/latex-renderer-lan-authority/certbot.ini` に記載し（鍵種別は ECDSA P-256 を使用）、DNS 委任が反映されてから次を実行します。

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

取得後、Nginx 設定にサーバー名と証明書パスを合わせて構文検査（`nginx -t`）・反映し、Certbot の更新タイマーを確認します。

- **Keyless モードも提供する場合**：API 用とは別に、`*.lan.example.org` だけを含む ECDSA P-256 ワイルドカード証明書を取得します（上のコマンドの `--cert-name` を `akebi-keyless`、`-d` を `'*.lan.example.org'`、`--deploy-hook` を `"$hooks/operator-certificate-hook.sh"` に変更して実行します。公開 CA モードのみ提供する場合は不要です）。

## 登録方法を設定する

`authority.json` の `policy.registration` でクライアントサーバーの登録方式を選びます。

- `"open"`：自動登録を許可
- `"invite"`：招待制（管理者が発行したコードが必要）

招待制の場合は、次のコマンドで回数・有効期限付きの招待コードを発行し、対象者にだけ安全な経路で渡します。

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

※ 自動登録・招待制のどちらでも、登録数・発行頻度・保存数のレート制限と CA 側の発行ポリシーが適用されます。

## 外部から確認する

外部端末から、DNS 委任、UDP / TCP 両方の SOA 応答、IP 由来の名前解決、および HTTPS のディスカバリ応答を確認します。

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

すべて応答したら、テスト用の LaTeX Renderer サーバーから[LAN 向けに設定する](/docs/lan-https/#lan-向けに設定する)の手順で接続し、証明書取得とログインを確認します（CA からレート制限等の待機時間が返った場合は、その時刻まで再試行しないでください）。

**バックアップの注意**：暗号化バックアップには `/var/lib/latex-renderer-lan-authority`、`/etc/latex-renderer-lan-authority`、CA アカウントと Certbot 更新設定を含めてください（稼働中の SQLite を保全する際は SQLite のオンラインバックアップ機能を使用します）。

詳細資料：[Akebi の設定例と実装仕様](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)
