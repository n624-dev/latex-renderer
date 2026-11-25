---
slug: lan-https-authority
category: Self-hosting
title: Run an Akebi certificate service
description: Delegate DNS for a LAN domain, issue certificates, and configure open or invitation-only registration.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

This guide is for administrators running their own certificate service. To expose a LaTeX Renderer server on a LAN with the shared service, see [Use HTTPS on your LAN with Akebi](/en/docs/lan-https/).

Prepare a DNS zone you can delegate, a Linux host (amd64 or arm64) that can serve public DNS and HTTPS, a supported Node.js version (24 or 26), and an account with your CA. Use a server distribution whose signature you have verified with the [manual download procedure](/en/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegate DNS {#dns-を委任する}

Add these records to the parent DNS zone. The Akebi DNS server must be reachable from the internet on **port 53 over both UDP and TCP**.

| Type | Name | Value |
| --- | --- | --- |
| `A` | `ns1.example.org` | Public IPv4 address of the Akebi DNS server |
| `A` | `akebi.example.org` | Public IPv4 address of the HTTPS reverse proxy for the Akebi API |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reserve `ns1.example.org` for DNS. Keep the API hostname (`akebi.example.org`) outside the LAN certificate zone (`lan.example.org`).
- After delegation, Akebi dynamically returns `A` and `AAAA` records derived from LAN IPs and `TXT` records for ACME validation. The parent zone needs no individual LAN IP records.

## Deploy the service {#サービスを配置する}

1. **Create a dedicated user and state directories.** Give the service its own user and group, `latex-renderer-lan-authority`, separate from the application. Create `/var/lib/latex-renderer-lan-authority` and its `keyless` subdirectory with that ownership and mode `0700` on both.
2. **Prepare the configuration directory.** Create `/etc/latex-renderer-lan-authority` owned by `root:latex-renderer-lan-authority` with mode `0750`. Copy `deploy/lan-https/examples/authority.json` from the verified distribution there and set its ownership to `root:latex-renderer-lan-authority` and its mode to `0640`.
3. **Edit `authority.json`.**
   - `policy.serverOrigin` is the API’s HTTPS URL, for example `https://akebi.example.org`.
   - `policy.lanDomain` is the delegated LAN domain, for example `lan.example.org`.
   - `dns.nameserver` and `dns.listeners` specify the public DNS hostname and listening addresses. If another DNS server uses port 53 on the host, select a public IP that avoids the conflict.
   - Bind `http` to loopback.
   - Configure the public CA under `issuers`. If the CA requires External Account Binding (EAB), store `kid` and `hmacKey` in the specified `eabFile`, owned by the service user with mode `0600`. If the domain uses CAA records, authorize the selected CA.
4. **Install the code and systemd unit.** This example assumes the root-owned, verified source is at `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initialize the state and start the service.** Run `init` only the first time.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Obtain an HTTPS certificate {#https-証明書を用意する}

The Nginx example in `deploy/lan-https/examples/authority.nginx.conf` proxies the public API to loopback. Obtain the API’s own certificate before enabling TLS in Nginx.

To renew automatically with Certbot, put the CA, contact details, terms acceptance, and required EAB information in the root-only `/etc/latex-renderer-lan-authority/certbot.ini`. Use ECDSA P-256. After DNS delegation propagates, run the following command.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

After issuance, set the server name and certificate paths in Nginx, test the configuration (`nginx -t`), apply it, and check the Certbot renewal timer.

- **Offering Keyless.** Obtain a separate ECDSA P-256 wildcard certificate containing only `*.lan.example.org`. In the command above, change `--cert-name` to `akebi-keyless`, `-d` to `'*.lan.example.org'`, and `--deploy-hook` to `"$hooks/operator-certificate-hook.sh"`. This certificate is necessary only if you offer Keyless.

## Configure registration {#登録方法を設定する}

Set `policy.registration` in `authority.json` to choose how client servers register.

- `"open"` allows automatic registration.
- `"invite"` requires a code issued by an administrator.

For invitation-only registration, use the command below to issue a code with a use limit and expiration time. Send it securely only to its intended recipients.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Both registration modes enforce limits on registration count, issuance frequency, and stored items. The CA’s issuance policy also applies.

## Verify from outside the network {#外部から確認する}

From an external device, check delegation, SOA responses over both UDP and TCP, IP-derived name resolution, and the HTTPS discovery response.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Once all checks respond, connect a test LaTeX Renderer server using [Configure LAN access](/en/docs/lan-https/#lan-向けに設定する). Verify certificate issuance and sign-in. If the CA returns a retry time, for example because of a rate limit, wait until that time before trying again.

**Backups.** Include `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA accounts, and Certbot renewal settings in encrypted backups. Use SQLite’s online backup facility for a live database.

See [Akebi configuration examples and specification](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
