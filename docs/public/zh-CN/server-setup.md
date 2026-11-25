---
slug: server-setup
category: 自托管
title: 服务器设置向导
description: 从浏览器或终端为已准备好的服务器配置身份验证、HTTPS 和运行限制。
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## 选择设置方式 {#どの手順を使うか}

首次搭建时，请先[准备服务器](/zh-CN/docs/self-hosting/#準備するもの)，再用**浏览器**打开向导。已有服务器也可通过同一向导更改登录方式和运行限制。

- 在服务器上运行 `sudo n624-latex server setup --plan`，检查所需软件包和可用磁盘空间。补齐缺少的项目后再运行一次。
- 要修改现有的专用 HTTPS 或 LAN HTTPS（Akebi），请在启动命令中添加 `--ingress`。
- 如果精简系统上的 Docker 提示缺少内核模块，请按提示准备后重试。例如，若需要 `nf_tables`，管理员可运行 `sudo modprobe nf_tables`。

## 在浏览器中打开 {#ブラウザで開く}

通过 SSH 以非 root 部署账号登录服务器并运行以下命令。**在设置完成前保持终端打开。**

```sh
sudo n624-latex server setup --web
```

1. 首次搭建时，核对显示的准备工作，确认后输入 `PREPARE`。等待系统获取已签名的发行包、准备服务，并构建和验证首个 TeX 运行环境。
2. 查看终端显示的一次性专用 URL，有效期为 **5 分钟**。
3. 在服务器浏览器中打开，或通过 **SSH 端口转发**在本机访问同一端口。例如，若显示端口为 `41234`，请在本机另开终端运行以下命令，再在浏览器中打开向导给出的 URL。

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> 请勿与他人共享设置 URL，也不要将设置端口暴露到互联网或反向代理。

## 预览并应用设置 {#プレビューから適用まで}

1. **选择访问和登录方式。** 首次搭建时需设置 HTTPS 和首位所有者。请在专用的不回显输入框中填写密码或 OIDC 客户端密钥。
2. **查看预览。** 核对公开 URL 和登录方式。更改登录方式前，请趁当前仍可登录时准备好新方式所需的所有者身份信息。
3. **应用设置。** 等待服务启动或重启完成。
4. **登录并生成 PDF。** 在另一个浏览器窗口中[验证安装](/zh-CN/docs/self-hosting/#導入完了の確認)。

首次搭建并同时启用密码和 OIDC 时，先通过密码注册所有者，再为其注册 OIDC 的 `issuer` 和 `subject`。运行限制中的内存启动条件是作业启动前必须有的可用 RAM，运行内存上限是容器可用的 RAM。

## 检查中断的变更 {#中断した変更を確認する}

- 若开始应用设置后浏览器等连接中断，请先检查同一操作的结果。
- 若向导进程已退出，请针对相同目标重启向导，在网页选择 **Recover** 或在终端选择 **`RECOVER`**。若所有者已注册，将沿用该注册信息并恢复至确认步骤。配置恢复不会将数据库回滚到旧备份。
- 恢复文件可能包含 TLS 或 OIDC 机密配置，请勿手动编辑。联系支持时，仅提供界面显示的错误码和出错阶段。

## 在终端中打开 {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

更改已有服务器时逐项输入，直接按 Enter 可保留现值。首次设置自动 LAN HTTPS 时选择 `LAN`，然后按终端提示操作。若要在终端配置首次自定义 HTTPS 或已有的 Cloudflare 入口，请按显示的格式输入单行 JSON。首次配置这类部署时，建议先[在浏览器中打开](#ブラウザで開く)。

### 旧版本和手动部署 {#旧版-手動配置の場合}

> [!DETAILS] 直接运行 server-setup.mjs
>
> 如果未使用 APT，而是自行准备专用用户、Node.js 和 rootless Docker，并将验证过的发行包放在 `/opt/latex-renderer/current`，可直接运行 `server-setup.mjs`。新服务器的准备过程见[手动部署说明](/zh-CN/docs/self-hosting/#現在の提供状況)。
>
> | 操作 | 启动参数 | 条件 |
> | --- | --- | --- |
> | 修改现有认证或运行限制 | `--existing` | 已注册所有者，服务运行正常 |
> | 首次配置并注册所有者 | `--initial` | 已准备发行包和运行环境，尚无运行中的配置或数据库 |
> | 修改受管理的专用 HTTPS | `--ingress` | 已使用专用 standalone HTTPS。从共享 Nginx 迁移需单独处理。 |
>
> - **在终端中打开**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **在浏览器中打开**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

实现细节见[向导输入格式和恢复规范](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md)。
