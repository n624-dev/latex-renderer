---
slug: security
category: 故障排查与安全
title: 账号与文档安全
description: 了解如何保护凭据、上传的文件、渲染器和管理区域。
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- API 密钥泄露时，请立即联系服务器管理员撤销该密钥并重新签发。
- 发现软件漏洞时，请通过 [GitHub 私密漏洞报告](https://github.com/n624-dev/latex-renderer/security/advisories/new)提交，不要在公开 Issue 中披露。

## 凭据 {#資格情報}

- 不要在命令行参数（可通过 `ps` 等工具查看）、URL、Git 仓库、日志或 AI 提示词中包含 API 密钥。
- 本地凭据应使用操作系统的保护机制。Windows 使用 DPAPI，Linux 和 macOS 使用权限为 `0600`、仅所有者可读的文件。
- 浏览器密码、OIDC 客户端密钥和会话 Cookie 应与 CLI 和 API 密钥（`lrk_`、`lra_`）分别使用。

## 项目 {#プロジェクト}

所有上传的 LaTeX 源码及附件均作为不可信输入处理。系统禁用符号链接、shell escape、外部命令执行和容器外网络通信。不要尝试绕过沙箱、超时限制或文件限制。

## 公开区域与管理区域 {#公開領域と管理領域}

公开文档和下载、需要认证的 Web 页面（`/app/`、`/admin/`）以及 Renderer API 使用同一规范 HTTPS 源下的不同路径。

- **网络边界。** Cloudflare 模式下，Tunnel 和 Workers 是唯一入口；standalone 模式下，唯一入口是 TLS 反向代理。所有应用服务仅绑定回环地址。Internal API、SQLite 和管理器套接字不对外开放。需要认证的区域也会从搜索引擎索引中排除。
- **浏览器认证与会话保护。** 外部 IdP 身份仅在 `provider + issuer + subject` 完全一致时匹配，不根据邮箱或显示名称自动关联。服务器可立即撤销会话。更改状态的请求必须提供完全匹配的 `Origin` 和会话专用的 CSRF 令牌。密码由 `scrypt` 和 root 所有的独立秘密值（pepper）保护。公开部署还应在代理上限制连接数及请求速率，并使用托管服务商的 DDoS 防护。
- **Remote MCP。** `/mcp`、OAuth 令牌端点和发现元数据可公开访问。调用工具必须使用受 audience 和 scope 限制的短期 Bearer 令牌。授权页面与 `/app/` 使用相同的浏览器会话，明确关联到有效的已有用户。
  - 标准工具响应（`content`）仅包含继续工作所需的所有者范围内 ID、状态、游标和有限的诊断信息。来自用户的路径和诊断文本会去除控制字符并限制长度和数量，以不可信数据返回。
  - 标准 `content` 和诊断日志均不含 OAuth 令牌、API 密钥、票据、原始 base64、输入全文、完整日志、堆栈跟踪、Access subject 或服务器内部路径。只有重新检查所有者权限的资源读取才能返回完整 PDF 或日志。

## 本地设置 Web 界面 {#local-setup-web-ui}

`n624-latex setup --gui`（旧版为 `latex-render setup --gui`）仅侦听本机 `127.0.0.1` 的随机端口。

- CLI 打开的 URL 片段（`#...`）包含一次性引导令牌。浏览器会立即将其从历史记录中移除，并换取短期会话。
- 所有操作 API 都要求完全匹配的 `Origin`、Bearer 会话和单独的 CSRF 令牌。界面禁用 CORS，验证 Host 和回环来源，并启用严格的 CSP、`frame-ancestors 'none'` 和 `no-store`。
- 输入的 API 密钥只传给保存操作，状态、诊断及示例转换的响应不会包含它。空闲 30 分钟或自启动满 2 小时后，界面将自动关闭。
