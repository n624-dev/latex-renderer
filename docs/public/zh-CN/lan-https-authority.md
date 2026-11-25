---
slug: lan-https-authority
category: 自托管
title: 自行运行 Akebi 证书服务
description: 配置局域网域名的 DNS 委派、证书签发，以及邀请制或自动注册。
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

本指南面向自行运营证书服务的管理员。若要使用共享服务在局域网提供 LaTeX Renderer，请参见[在局域网中使用 HTTPS（Akebi）](/zh-CN/docs/lan-https/)。

准备可委派的 DNS 区域、能提供公网 DNS 和 HTTPS 的 Linux 主机（amd64 或 arm64）、受支持的 Node.js（24 或 26）及所用 CA 的账号。按[手动下载步骤](/zh-CN/docs/self-hosting/#v1-6-9をダウンロードして検証)验证服务器发行包的签名后再使用。

## 委派 DNS {#dns-を委任する}

在父域的 DNS 区域中添加以下记录。互联网必须能通过 **UDP 和 TCP 的 53 端口**访问 Akebi DNS 服务器。

| 类型 | 名称 | 值 |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebi DNS 服务器的公网 IPv4 地址 |
| `A` | `akebi.example.org` | Akebi API 的 HTTPS 反向代理的公网 IPv4 地址 |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- `ns1.example.org` 仅用于 DNS。API 主机名（`akebi.example.org`）应位于局域网证书覆盖的区域（`lan.example.org`）以外。
- 完成委派后，Akebi 会根据局域网 IP 动态返回 `A` 或 `AAAA` 记录，并为 ACME 验证返回 `TXT` 记录。无需在父区域逐一添加 IP 记录。

## 部署服务 {#サービスを配置する}

1. **创建专用用户和状态目录。** 以专用用户和组 `latex-renderer-lan-authority` 运行服务，与主应用隔离权限。创建 `/var/lib/latex-renderer-lan-authority` 及其子目录 `keyless`，所有者设为该用户，两个目录的权限均设为 `0700`。
2. **准备配置目录。** 创建 `/etc/latex-renderer-lan-authority`，所有者与组设为 `root:latex-renderer-lan-authority`，权限设为 `0750`。将已验证发行包中的 `deploy/lan-https/examples/authority.json` 复制到此目录，所有者与组设为 `root:latex-renderer-lan-authority`，权限设为 `0640`。
3. **编辑 `authority.json`。**
   - `policy.serverOrigin` 为 API 的 HTTPS URL，例如 `https://akebi.example.org`。
   - `policy.lanDomain` 为已委派的局域网域名，例如 `lan.example.org`。
   - `dns.nameserver` 和 `dns.listeners` 分别设置公网 DNS 主机名和监听地址。若其他 DNS 服务已占用 53 端口，请选择不冲突的公网 IP。
   - `http` 固定绑定回环地址。
   - 在 `issuers` 中配置公共 CA。如需外部账号绑定（EAB），请将指定的 `eabFile` 设为专用用户所有，权限为 `0600`，并写入 `kid` 和 `hmacKey`。域名若使用 CAA 记录，请允许对应的 CA。
4. **部署代码和 systemd 单元。** 以下示例假设已验证的源码归 root 所有，位于 `/path/to/verified-release`。

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **初始化并启动。** `init` 仅首次运行。

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## 准备 HTTPS 证书 {#https-証明書を用意する}

用于公开 API 的 Nginx 配置示例位于 `deploy/lan-https/examples/authority.nginx.conf`，会转发至回环地址上的 API。启用 Nginx TLS 前，先获取 API 自身的证书。

若使用 Certbot 自动续期，请将 CA、联系方式、条款同意声明和必要的 EAB 信息写入仅 root 可读的 `/etc/latex-renderer-lan-authority/certbot.ini`。密钥类型使用 ECDSA P-256。DNS 委派生效后运行以下命令。

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

签发后，在 Nginx 中设置匹配的服务器名与证书路径，通过 `nginx -t` 检查并应用配置，再检查 Certbot 续期定时器。

- **同时提供 Keyless 时**，另行获取仅包含 `*.lan.example.org` 的 ECDSA P-256 通配符证书。在上述命令中，将 `--cert-name` 改为 `akebi-keyless`、`-d` 改为 `'*.lan.example.org'`、`--deploy-hook` 改为 `"$hooks/operator-certificate-hook.sh"`。仅提供公共 CA 模式时无需此证书。

## 配置注册方式 {#登録方法を設定する}

通过 `authority.json` 中的 `policy.registration` 选择客户端服务器的注册方式。

- `"open"`：允许自动注册。
- `"invite"`：采用邀请制，需使用管理员签发的邀请码。

采用邀请制时，使用以下命令签发有使用次数和有效期限制的邀请码，仅通过安全渠道交给指定人员。

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

两种模式均受注册数量、签发频率、存储数量限制及 CA 签发策略约束。

## 从外部验证 {#外部から確認する}

从外部设备验证 DNS 委派、通过 UDP 和 TCP 获取 SOA 响应、由 IP 生成的主机名解析，以及 HTTPS 服务发现响应。

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

所有检查均得到响应后，请使用测试用 LaTeX Renderer 服务器按[配置局域网访问](/zh-CN/docs/lan-https/#lan-向けに設定する)的步骤连接，验证证书获取和登录。若 CA 返回因限流等原因产生的等待时间，请到指定时间再重试。

**备份。** 加密备份应包含 `/var/lib/latex-renderer-lan-authority`、`/etc/latex-renderer-lan-authority`、CA 账号和 Certbot 续期配置。备份运行中的 SQLite 时，请使用 SQLite 在线备份功能。

参见 [Akebi 配置示例和实现规范](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)。
