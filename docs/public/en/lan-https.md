---
slug: lan-https
category: Self-hosting
title: Use HTTPS on your LAN with Akebi
description: Connect to the server using an HTTPS URL derived from its LAN IP address.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Connect using the server’s LAN address {#lan-の-ip-アドレスからアクセスする}

Akebi derives a hostname from the server’s private IP address so clients can use HTTPS.

To use the shared certificate service, configure it in the LaTeX Renderer setup wizard. To operate a certificate service of your own, see [Run an Akebi certificate service](/en/docs/lan-https-authority/).

- **IPv4 example.** For server IP `192.168.1.50` and LAN domain `lan.example.org`, the URL is `https://192-168-1-50.lan.example.org`.
- **IPv6.** The hostname expands all eight groups of a supported private address. Use the exact URL shown by setup.

**Network and DNS requirements**
Client devices must be able to reach the server’s LAN. If name resolution fails, check whether your router or DNS resolver blocks responses containing private IPs as **DNS rebinding protection**. If needed, add an exception limited to your LAN domain.

## Choose a certificate method {#証明書の方式を選ぶ}

| Method | Requirements and behavior |
| --- | --- |
| **Shared service, public CA** | Use the shared service settings and accept the public CA’s terms. The certificate’s private key stays on your server. |
| **Your own service, public CA** | Supply the URL and LAN domain of [your Akebi service](/en/docs/lan-https-authority/), plus an invitation code if required. |
| **Keyless** | Requires a service supporting Keyless. It signs TLS handshakes on the server’s behalf. |
| **Existing certificate or private CA** | Provide a certificate matching the server name and its private key. For a private CA, configure trust in the root CA on the server and every client. |

> [!NOTE]
> - A public CA records the issued certificate’s hostname in public **Certificate Transparency (CT) logs**.
> - Browsers treat the same private IP and LAN domain combination as **the same origin**, even on LANs at different sites. Those sites can share cookies and other browser storage.

## Configure LAN access {#lan-向けに設定する}

1. For a new installation, [prepare the server](/en/docs/self-hosting/#準備するもの) and open the [wizard](/en/docs/server-setup/#ブラウザで開く) with `sudo n624-latex server setup --web`. To switch a server already using managed dedicated HTTPS, run `sudo n624-latex server setup --ingress --web`.
2. Choose **LAN** for ingress and specify the network interface, private IP address, allowed client subnets, and HTTPS port.
3. Select the certificate service and method. The shared service sets the service URL to `https://akebi.n624.net` and the LAN domain to `lan.n624.net`, then registers automatically when you apply the settings. No invitation code is required. For a public CA, review and accept its terms. For a private invitation-only service, enter the code supplied by its administrator.
4. Review the generated HTTPS URL and allowed subnets in the preview, then apply. Application password or OIDC authentication still applies.
5. From a second device on an allowed subnet, open the HTTPS URL. Verify that you can sign in and compile a sample without a certificate warning.

To provide your own certificate service, see [Run an Akebi certificate service](/en/docs/lan-https-authority/).

## Check certificate status {#証明書の状態を確認する}

Use these commands to check service status, the renewal timer, and logs in the dedicated namespace.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

If issuance or renewal fails, check the server clock, HTTPS connectivity to the certificate service, domain and IP settings, and the retry time from the CA. A temporary renewal failure retains the existing unexpired certificate. The next timer run resumes the recorded issuance process. If the private key and issuance state disagree, check the stored state files from the same generation.

See [Akebi design and detailed troubleshooting](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
