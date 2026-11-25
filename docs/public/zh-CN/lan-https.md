---
slug: lan-https
category: 自托管
title: 在局域网中使用 HTTPS（Akebi）
description: 通过根据服务器局域网 IP 地址生成的 HTTPS URL 访问服务。
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## 使用局域网地址连接 {#lan-の-ip-アドレスからアクセスする}

Akebi 将服务器的私有 IP 地址转换成主机名，以便通过 HTTPS 连接。

使用共享证书服务时，请在 LaTeX Renderer 服务器的设置向导中配置。若要自行提供证书服务，请参见[运行 Akebi 证书服务](/zh-CN/docs/lan-https-authority/)。

- **IPv4 示例。** 若服务器地址为 `192.168.1.50`，局域网域名为 `lan.example.org`，则 URL 为 `https://192-168-1-50.lan.example.org`。
- **IPv6。** 主机名使用受支持的私有地址展开后的全部 8 组地址段。连接时请直接使用向导显示的 URL。

**网络与 DNS 要求**
客户端必须能访问服务器所在的局域网。如果无法解析主机名，请检查路由器或 DNS 解析器的 **DNS 重绑定防护**是否拦截了指向私有 IP 的响应。必要时仅为所用的局域网域名添加例外。

## 选择证书方式 {#証明書の方式を選ぶ}

| 方式 | 要求与特点 |
| --- | --- |
| **共享服务，公共 CA** | 使用共享服务配置并同意公共 CA 条款。证书私钥保存在本机服务器。 |
| **自建服务，公共 CA** | 提供[自建的 Akebi 证书服务](/zh-CN/docs/lan-https-authority/) URL 和局域网域名。邀请制服务还需邀请码。 |
| **Keyless** | 需要支持 Keyless 的证书服务，TLS 握手签名由证书服务执行。 |
| **现有证书或私有 CA** | 提供与服务器名匹配的证书及私钥。使用私有 CA 时，服务器及所有客户端均需信任根 CA。 |

> [!NOTE]
> - 使用公共 CA 时，签发证书中的主机名会记录在公开的**证书透明度（CT）日志**中。
> - 即使位于不同地点的局域网，相同的私有 IP 和局域网域名组合在浏览器中也被视为**同源**，会共享 Cookie 等浏览器存储。

## 配置局域网访问 {#lan-向けに設定する}

1. 首次搭建时，先[准备服务器](/zh-CN/docs/self-hosting/#準備するもの)，再运行 `sudo n624-latex server setup --web` 打开[向导](/zh-CN/docs/server-setup/#ブラウザで開く)。若服务器已使用受管理的专用 HTTPS，可运行 `sudo n624-latex server setup --ingress --web` 切换。
2. 在访问方式中选择 **LAN**，指定网络接口、私有 IP、允许访问的子网范围和 HTTPS 端口。
3. 选择证书服务和证书方式。选择共享服务后，服务 URL 自动设为 `https://akebi.n624.net`，局域网域名设为 `lan.n624.net`，应用配置时会自动注册，无需邀请码。使用公共 CA 时请审阅并同意条款。若自建服务采用邀请制，请输入管理员提供的邀请码。
4. 核对预览中的 HTTPS URL 和允许访问的子网，然后应用。应用自身的密码或 OIDC 身份验证仍然有效。
5. 在允许的子网中，使用另一台设备打开此 URL，确认无证书警告，并验证登录和示例转换。

自建证书服务时，请参见[自行运行 Akebi 证书服务](/zh-CN/docs/lan-https-authority/)。

## 检查证书状态 {#証明書の状態を確認する}

可用以下命令检查运行状态、自动续期定时器和专用命名空间中的日志。

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

签发或续期失败时，检查服务器时钟、到证书服务的 HTTPS 连接、域名和 IP 配置，以及 CA 提示的重试时间。暂时续期失败时，仍在有效期内的证书会保留。下次定时任务会从已记录的签发状态继续。如果私钥和签发状态不匹配，请核对同一代的状态文件。

更多信息见 [Akebi 设计与故障排查](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)。
