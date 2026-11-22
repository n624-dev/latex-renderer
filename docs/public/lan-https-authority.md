---
slug: lan-https-authority
category: セルフホスト
title: Akebi の証明書サービスを自分で運用する
description: LAN 用ドメインの DNS 委任、証明書発行、招待制または自動登録を設定します。
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

[Akebi で LAN 接続する手順](/docs/lan-https/)で独自のサービスを選ぶ場合に使うページです。公開 DNS と HTTPS の管理権限、公開 CA の ACME 設定、[署名を検証したリリース](/docs/self-hosting/#現在の提供状況)を用意します。例の `example.org` は自分で管理するドメインに置き換えてください。

## DNS を委任する

親ゾーンで次を設定します。DNS サーバーはインターネットから UDP と TCP の両方で 53 番ポートへ到達できる必要があります。

| 種別  | 名前                                | 値                                                  |
| ----- | ----------------------------------- | --------------------------------------------------- |
| A     | `ns1.example.org`                   | Akebi DNS サーバーの公開 IPv4                       |
| A     | `akebi.example.org`                 | HTTPS プロキシの公開 IPv4                           |
| NS    | `lan.example.org`                   | `ns1.example.org`                                   |
| CNAME | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

`ns1` は DNS のみで配信します。API のホスト名は、LAN 証明書の対象である `lan.example.org` の外に置きます。親ゾーンへ LAN の IP ごとのレコードを追加する作業は不要です。委任した範囲でサービスが IP 由来の名前と発行用の TXT 応答を扱います。

## サービスを配置する

1. 専用ユーザーとグループ `latex-renderer-lan-authority` を準備し、その所有者で `/var/lib/latex-renderer-lan-authority` と配下の `keyless` を作成します。両方をモード `0700` にします。アプリケーション本体とは権限を分けます。
2. `/etc/latex-renderer-lan-authority` を root 所有、専用グループ、モード `0750` で作成します。検証済み配布物の `deploy/lan-https/examples/authority.json` を同ディレクトリへコピーし、root 所有、専用グループ、モード `0640` にします。
3. `policy.serverOrigin` を API の HTTPS URL、`policy.lanDomain` を委任した LAN ドメインに設定します。`dns.nameserver` と `dns.listeners` を実際の公開 DNS に合わせます。既存の DNS が 53 番を使う場合は、競合しない公開アドレスを指定します。`http` はループバックに置きます。
4. `issuers` に利用する CA を指定します。EAB が必要な CA では、設定した `eabFile` に CA から発行された `kid` と `hmacKey` を保存します。ファイルは専用ユーザー所有でモード `0600` にします。CAA を使う場合は選んだ CA を許可します。
5. root 所有で検証済みのソースを `/path/to/verified-release` に置いた例として、次を実行します。リリースのコードと専用サービスを配置します。

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

設定を確認し、初回だけ状態を初期化します。

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS 証明書を用意する

設定例 `deploy/lan-https/examples/authority.nginx.conf` はループバックの API に転送する Nginx 設定です。サーバー名と証明書のパスを合わせます。TLS の設定を有効にする前に API の証明書を取得します。

Certbot で自動更新する場合は、CA、連絡先、規約への同意、必要なら EAB 情報を root 専用の `/etc/latex-renderer-lan-authority/certbot.ini` に設定します。ECDSA P-256 を使用します。DNS が公開された後、次を実行します。

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Nginx の設定を検査して反映し、保存済みの Certbot 更新設定とタイマーを確認します。Keyless を提供する場合は、API と別に `*.lan.example.org` だけを含む P-256 証明書を取得します。上のコマンドの証明書名を `akebi-keyless`、ドメインを引用符付きの `'*.lan.example.org'`、配置フックを `operator-certificate-hook.sh` に置き換えます。公開 CA モードだけを提供する場合、ワイルドカード証明書は不要です。

## 登録方法を設定する

`authority.json` の `policy.registration` を `open` にすると自動登録、`invite` にすると招待制になります。招待制の場合は、必要なときに管理者がコードを発行します。

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

端末に表示されたコードは対象者にだけ渡してください。どちらの方式でも登録、発行、保存数の制限があり、CA 自身の発行ポリシーも適用されます。

## 外部から確認する

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

委任先、UDP と TCP 両方の SOA 応答、例の LAN IP、HTTPS のサービス情報を確認します。その後、テスト用の導入先で[独自サービスへ接続](/docs/lan-https/#lan-向けに設定する)し、証明書を取得して HTTPS でログインします。CA の応答に待機時間がある場合は、その時間まで発行を繰り返さないでください。

暗号化バックアップには専用の状態ディレクトリ、設定、CA アカウントと Certbot 更新設定を含めます。SQLite を稼働中にバックアップする場合は、SQLite のバックアップ機能を使います。

[Akebi の設定例と実装仕様](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)
