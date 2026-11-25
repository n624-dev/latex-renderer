---
slug: self-hosting
category: 自托管
title: 在自己的服务器上运行
description: 了解支持的部署架构，准备服务器，并完成初始设置、更新和备份。
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## 安装方式 {#現在の提供状況}

新服务器可先安装 [APT 软件包](/zh-CN/docs/client/#debian-ubuntu-の-apt-パッケージ)，再通过设置向导配置 HTTPS、登录方式和首位所有者。

### 首次部署步骤 {#初回導入の順序}

1. **准备服务器。** 检查[支持的系统和访问方式](#対応する構成)，然后[准备 Docker Engine 和 Nginx](#準備するもの)。
2. **安装 APT 软件包。** 按 [Debian 或 Ubuntu 的步骤](/zh-CN/docs/client/#debian-ubuntu-の-apt-パッケージ)安装 `n624-latex`。
3. **运行设置向导。** 从非 root 部署账号运行 `sudo n624-latex server setup --plan`。解决列出的缺项后，[在浏览器中继续设置](/zh-CN/docs/server-setup/#ブラウザで開く)。
4. **生成第一份 PDF。** 打开已配置的 HTTPS URL，[登录并转换测试文档](#導入完了の確認)。设置过程会准备初始 TeX 运行环境。

如要升级现有服务器，请[在管理页面更新](/zh-CN/docs/updates/)。如需从 tarball 安装，请参见[手动部署步骤](#v1-6-9をダウンロードして検証)。

## 局域网自动 HTTPS {#lan-内の自動-https}

在局域网中，可通过 **Akebi** 根据私有 IP 地址生成 HTTPS URL。可先使用共享证书服务。参见[在局域网中使用 HTTPS（Akebi）](/zh-CN/docs/lan-https/)。

## 支持的部署架构 {#対応する構成}

APT 支持在运行 `systemd` 的单台 Debian 12、13 或 Ubuntu 24.04、26.04 主机上首次安装，支持 amd64 和 arm64。LaTeX 转换通过专用用户的 rootless Docker 执行。

| 部署模式（`DEPLOYMENT_MODE`） | 入口 | 登录方式 |
| --- | --- | --- |
| `standalone` | Nginx、Caddy、Apache 或 LAN HTTPS（Akebi） | 本地密码、OIDC 或两者并用 |
| `cloudflare` | Cloudflare Tunnel 和 Worker | Cloudflare Access，或原生认证（密码、OIDC 或两者并用） |

- **OIDC** 适用于已有组织身份提供商（IdP）的环境。
- **Cloudflare Access** 需要在 Cloudflare 配置面向用户的 Access Application。
- **本地密码**无需外部 IdP，在管理界面注册用户即可。
- **并用密码和 OIDC。** 通过原生认证的 `AUTH_BACKEND=native`、`AUTH_PASSWORD_ENABLED=true` 和 `AUTH_OIDC_ENABLED=true` 启用两者。原有的单一认证方式可用 `AUTH_MODE` 指定。

## 准备服务器 {#準備するもの}

- **操作账号。** 使用非 root 账号连接，以 `sudo` 运行服务器设置命令。
- **磁盘空间。** 初始检查要求 `/opt` 和 `/var/lib` 所在的每个文件系统均有**至少 5 GiB 可用空间**。还要为 TeX 镜像、发行包、输出和加密备份预留空间。
- **Docker Engine。** 从官方软件仓库安装 Docker Engine 和 `docker-ce-rootless-extras`。向导会配置用于转换的 rootless Docker。参见 [Debian 官方安装步骤](https://docs.docker.com/engine/install/debian/)或 [Ubuntu 安装步骤](https://docs.docker.com/engine/install/ubuntu/)。
- **Nginx。** 运行 `sudo apt install nginx` 安装。即使使用 Caddy、Apache 或 Cloudflare 作为入口，首次通过 APT 安装也会检查 Nginx 是否存在。
- **入口和 TLS。** 自定义 HTTPS 需准备主机名、证书和私钥，并腾出内置 HTTPS 所需的地址和端口。使用 Cloudflare 时需准备 Tunnel、DNS 和 Worker。参见 [LAN HTTPS 的要求](#lan-内の自動-https)。
- **认证信息**
  - OIDC：issuer URL、客户端 ID、客户端密钥及首位所有者的固定 `subject`。
  - Cloudflare Access：Access Application 信息及所有者的 `subject`。
  - 密码：所有者登录名及初始密码。
- **出站连接。** 服务器必须能通过 HTTPS 访问 GitHub Releases 和 Attestations、GHCR（`ghcr.io`）、TeX Live 归档以及 Debian 或 Ubuntu 软件仓库。
- **APT 软件包。** 软件包自带 Node.js。参见 [APT 安装步骤](/zh-CN/docs/client/#debian-ubuntu-の-apt-パッケージ)。

## 验证安装 {#導入完了の確認}

1. 打开已配置 HTTPS 地址下的 `/admin/`，以设置时注册的所有者身份登录。
2. 在同一 HTTPS 地址打开 `/app/`，选择[示例 `main.tex`](/zh-CN/docs/#最短でpdfを作る) 并点击**转换为 PDF**。
3. 从结果页面打开 PDF，确认能看到示例正文。

> [!DETAILS] 进一步验证服务和输出
>
> 管理员可以运行通过公开 URL 进行转换的冒烟测试。测试签发的 API 密钥会在测试后立即撤销。
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> 还可验证普通用户登录、公开指南、TeX 环境中显示的语言和镜像，以及实际需要的日语文档或 SVG 等输出。

### 注册用户和签发 API 密钥 {#利用者と-api-キーの発行}

成功以所有者身份登录 `/admin/` 后，即可注册用户。

- **Web 和 Remote MCP 用户。** 在管理界面的**用户**中创建账号，登记对应登录方式的身份信息，并向用户提供 Web 应用 URL。
- **CLI、Local MCP 和 HTTP API 用户。** 在管理界面创建与用户关联的**服务账号**。在 **API 密钥 → 签发 API 密钥**中，签发具有 `render:create` 和 `render:read:own` 权限的渲染密钥（`lrk_...`），通过安全渠道交给用户。

## 更新与回滚 {#更新とロールバック}

### 更新应用 {#アプリケーションを更新する}

- 更新应用本身时，以所有者身份打开**管理 → 更新**。参见[更新正式版本及回滚](/zh-CN/docs/updates/)。
- 更改 TeX Live 版本或语言时，打开**管理 → TeX 环境**。参见[配置 TeX 环境](#tex環境の初期設定)。

> [!DETAILS] 履歴資料　旧版迁移与特殊恢复步骤
>
> ### 迁移 v1.2.x 的 root 更新程序至权限分离架构 {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> 参见[迁移到权限分离更新程序](/zh-CN/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合)。
>
> ### GNU tar 解压时报 Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> 参见[排查解压错误](/zh-CN/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合)。
>
> ### 变更锁被占用 {#mutation-lockが使用中と表示される場合}
>
> 参见[确认持有锁的进程](/zh-CN/docs/reference/#mutation-lockが使用中と表示される場合)。

## 备份 {#バックアップ}

关于定期备份、更新前的恢复点、恢复测试和数据恢复，请参见[创建、验证和恢复备份](/zh-CN/docs/backups/)。恢复后若审计日志的输出位置不匹配，参见[恢复审计日志](/zh-CN/docs/reference/#監査ログの復旧)。

## 故障排查 {#問題が起きた場合}

| 情况 | 首先检查 |
| --- | --- |
| 无法访问 `/app/` | DNS、TLS 证书、Tunnel 或反向代理配置，以及回环服务的启动顺序 |
| 仅管理员不能登录 | 所有者的明确身份或凭据、`AUTH_MODE`、issuer 和 audience、角色配置 |
| 无法获取 TeX 镜像 | 到 `ghcr.io` 的 HTTPS 连接、软件包是否公开、指定标签是否支持主机架构 |
| TeX 变更长时间未结束 | 操作 ID 和 Image Manager 的脱敏日志 |
| 应用更新被拒绝 | 目标发行版是否不可变、资源摘要、升级路径和可用磁盘空间 |
| 主机初始化因路径不安全停止 | `/var/lib/latex-renderer` 是否归 `root:latex-renderer` 所有且权限为 `2770` |
| 仅更新页面无法启动 | 发行包中是否有 `client-dist/manifest.json`，以及 Admin Web 服务状态 |
| 渲染未开始 | 队列状态、磁盘可用空间是否至少 5 GiB、worker 服务和 rootless Docker 套接字 |
| 更新后立即出现问题 | 暂停接收新作业，检查新旧发行版及运行环境，再决定是否回滚 |

调查时请记录操作 ID、失败阶段以及可安全分享的错误代码。另见[故障排查](/zh-CN/docs/troubleshooting/)、[账号与文档安全](/zh-CN/docs/security/)及[部署架构与配置文件清单（DEPLOYMENT.md）](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)。

## 配置 TeX 环境 {#tex環境の初期設定}

初始设置会准备转换所需的 TeX 环境。要添加语言或更改 TeX Live 版本，请打开**管理 → TeX 环境**（`/admin/tex-environment/`）。以下示例配置支持英语和日语。

| 项目 | 建议值 |
| --- | --- |
| Image | `latest`（使用固定日期标签时，选择支持主机架构的版本） |
| Languages | `collection-langenglish`、`collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off（默认禁用） |

- 服务器仅从公开 GHCR 软件包获取不含语言的**基础镜像**，拉取后按摘要固定。在服务器上叠加所选语言和当前渲染器代码，构建**运行时镜像**。若已有相同配置的本地运行时则复用，运行时镜像不会对外发布。
- 关闭浏览器后构建仍会继续。完成后在管理界面检查生效的运行时及所选语言。获取镜像失败时，检查到 `ghcr.io` 的 HTTPS 连接及主机架构支持。

### 自动释放磁盘空间 {#自動容量整理}

> [!DETAILS] 自动清理未使用的镜像和构建缓存
>
> Image Manager 默认每 24 小时清理未使用的受管理镜像。当前和上一回滚版本的基础及运行时镜像，以及被配置引用的镜像受保护。其他受管理镜像创建满 24 小时后可删除；未使用的构建缓存以 2 GiB 为清理目标。这不是整个 Docker 存储的容量上限。
>
> 可在 `/etc/latex-renderer/renderer.env` 中调整设置，待 TeX 更新结束后通过 `sudo systemctl restart latex-renderer-image-manager.service` 生效。
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` 为 `0` 时禁用自动清理，也可设为 `1` 至 `720` 小时。启动 5 分钟后，每 5 分钟检查是否到期。更新或部署期间会因共用锁而推迟。Web 和 CLI 手动清理不等待保留期，只清理未受保护的内容。
> - `RETENTION_HOURS` 可设为 `0` 至 `8760` 小时，`BUILD_CACHE_MAX_GIB` 可设为 `0` 至 `1024` GiB。
> - 从 `1.3.4-rc.2` 开始，非 root Docker 的 Buildx 元数据移至 worker 主目录的 `.docker/buildx-worker` 下，避免与 root 构建发生权限冲突。旧配置镜像和手动恢复目录不会自动删除。只应逐项删除确认不需要的内容，不要直接删除 Docker 数据目录。

## sudo 与常规运维的权限边界 {#sudoと通常運用の境界}

首次设置需要准备专用系统用户、目录、`systemd` 单元、rootless Docker 和私钥文件，因此使用 `sudo`。**日常运行不向 Web 或 Admin API 授予 `sudo` 权限。**

- **TeX 环境变更**通过受权限限制的 Unix 套接字交给 root 所有的 Image Manager。
- **应用更新**通过 Unix 套接字提交给非 root Update Manager 控制器，只有固定操作会委派给短时 root 辅助程序。
- **互斥控制。** TeX 变更和应用更新由共用主机锁串行执行。Web 和 API 无法向 root 传递任意命令、路径或 URL。

## 配置和机密信息 {#設定と秘密情報}

主机专属配置与机密信息（例如 `/etc/latex-renderer/`）保存在应用及 Git 工作树之外。

| 路径 | 内容 | 建议权限 |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | 访问方式、URL、限制及非机密 IdP 设置 | `0640` |
| `/etc/latex-renderer/deployment.env` | Cloudflare 模式专用标识符和令牌 | `0600` |
| `/etc/latex-renderer/update-manager.env` | 非 root 部署用户设置 | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | 生产 Worker 的绑定和路由 | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel 入口配置 | `0640` |
| `/etc/latex-renderer/secrets/` | pepper、票据密钥和管理器凭据 | 分别指定 |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC 模式专用客户端密钥 | `0440` |

> [!WARNING]
> 切勿将 `.env`、Cloudflare 令牌、Tunnel 凭据、API 密钥、SQLite 数据库、用户文档、PDF 或未编辑的真实日志提交到 Git，或粘贴至 Issue 和支持请求。仓库中的 `*.example` 仅供核对配置项。

## 手动及旧版部署（tarball 安装） {#手動配置-旧版向けの構築手順-tarball-導入}

通过 APT 软件包和 `sudo n624-latex server setup` 安装时，手动解压、准备主机及运行所有者注册脚本均由向导引导或执行。如需从 `v1.7.1` 发行包手动部署，或查看公开入口和更改认证方法的细节，请展开以下内容。

> [!DETAILS] 手动下载、验证和部署 v1.7.1 并注册所有者
>
> 新的手动安装使用正式版 [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1)（`latex-renderer-server-1.7.1.tar.gz`）。发布后无法替换标签或发行文件。常规运维不支持直接从开发分支 `main` 部署或在本地通过 `docker build` 构建 TeX 镜像。
>
> ### 下载并验证 v1.7.1 {#v1-6-9をダウンロードして検証}
>
> 准备 `curl`、`jq`、`tar`、`sha256sum` 及支持 `gh attestation verify` 的 GitHub CLI。服务器所用的 Node.js 和 Corepack 将在下文准备主机时安装。
>
> 以普通用户在同一 Bash 会话中执行以下命令。它们会验证 GitHub Releases 的 SHA-256 和 GitHub Actions 的构建来源证明。通过公开 API 将证明数据传入 `gh`，无需 GitHub 登录或令牌。任一步骤失败时，`bundle_root` 不会被设置，请排除原因后重试。
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### 准备主机 {#ホストを準備}
>
> 安装 `setfacl` 配置存储权限，安装 `bsdtar` 供受限更新程序解压，并用 `unzip` 检查发行 ZIP。按官方步骤准备 Node.js 26 或 24（`/usr/local/bin/node`、`/usr/local/bin/corepack`）和 rootless Docker 工具。若使用 `cloudflare`，还需 `cloudflared`。Update Manager 会通过 Corepack 为部署用户安装并核对指定版本的 pnpm。
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> 然后从普通部署账号初始化主机，为 `latex-render-worker` 配置 rootless Docker。
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### 创建主机专属配置 {#ホスト固有設定を作成}
>
> 所有模式均需创建 `renderer.env`，设置 `PUBLIC_ORIGIN`、`DEPLOYMENT_MODE` 和 `AUTH_MODE`。没有 `ADMIN_ALLOWED_ORIGINS` 等替代设置，浏览器操作的来源必须与 `PUBLIC_ORIGIN` 完全一致。
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **`cloudflare` 模式。** 将 `example.com`、`REPLACE_*`、UUID 及 Access audience 全部替换成本环境的值。若 Tunnel 为远程管理，不要放置本地 `config.yml`，并提前确认 connector 已处于 active 状态。
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **`standalone` 模式。** 安装 Nginx、Caddy 或 Apache，从 `deploy/reverse-proxy/` 复制配置示例并设置 FQDN 和证书路径。代理必须移除收到的 `CF-Access-*` 标头并覆盖客户端 IP 标头，3100 至 3105 端口的回环服务不能直接对外监听。
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **使用 `AUTH_MODE=oidc` 时。** 在 IdP 注册 `https://<PUBLIC_ORIGIN的主机名>/auth/oidc/callback`，于 `renderer.env` 中设置 `OIDC_ISSUER` 和 `OIDC_CLIENT_ID`，将客户端密钥另存为不带结尾换行的文件。
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### 部署服务 {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - 仅供初装的引导程序会重新获取并验证公开的不可变发行包签名，将 root 所有的控制目录和非 root 的构建目录分离，构建 `client-dist` 并部署至 `/opt/latex-renderer/releases/$release_id`。如已有数据库或 `current` 则拒绝执行；安装后请使用常规更新功能。
> - 部署前会检查 `renderer.env`（归 root 所有、权限 `0640`、无重复键）、`PUBLIC_ORIGIN`、认证配置，以及 pepper 和密钥的所有者、权限及长度，不会输出秘密值。
> - 更新程序独立保存在 `/opt/latex-renderer/updater`。详见仓库中的 `docs/independent-updater.md`。更新暂存目录 `/opt/latex-renderer/update-staging` 仅部署用户的主组可以穿过，各阶段按 `0700` 隔离，结束时清理。若中断，则在满 24 小时后的启动时清理。
>
> ### 公开访问边界 {#公開境界}
>
> - **`cloudflare-access`。** 使用面向人工用户的同一 Access Application 保护 `/auth/*`、`/app/`、`/admin/` 和 `/oauth/authorize`，源站也必须验证 audience。Cloudflare 配合 OIDC 或密码时不要用 Access 拦截 `/auth/*`。公开文档和下载无需认证，仅 Renderer API 的公开端点通过 Worker Routes 处理。Tunnel 入口规则依次为特定 API 和管理路径、Web 兜底路由、`http_status:404`。
> - **`standalone`。** TLS 反向代理按路径转发到回环地址，仅将小型 JSON 票据操作送往 3105 端口的 Standalone Gateway。Nginx 示例包含连接数及密码登录和票据 API 的速率限制。标准 Caddy 和 Apache 缺少同等的按客户端请求限制，必须在上游负载均衡器或托管层限流。禁止公开 `/internal/*`、数据库或管理器套接字。
>
> ### 注册首位所有者 {#最初のowner}
>
> 外部认证的唯一标识为 `provider + issuer + subject`，密码认证为 `login name`。邮箱仅供显示，不会按邮箱自动关联或即时创建账号。根据选择的方法，仅执行一次对应操作。
>
> **使用 Cloudflare Access 或 OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **使用本地密码（示例登录名 `owner`）**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### 更改 AUTH_MODE {#後からauth-modeを変更する場合}
>
> 仅在无法使用[服务器设置向导](/zh-CN/docs/server-setup/)时使用以下流程。
> 先创建加密备份，停止 Admin API，再为管理界面或 `users list` 中查到的不可变 `user_...` ID 添加新的认证方式。现有凭据不能被覆盖，现有浏览器会话将失效。添加后修改 `renderer.env`，重启 Admin API 和 Web 服务。在隐私窗口验证新方式可登录后，才可删除旧凭据。
>
> 先执行准备步骤，然后仅执行目标认证方式对应的命令。
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **切换到 OIDC 或 Cloudflare Access 时**，输入 `oidc` 或 `cloudflare-access`。
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **切换到密码认证时**，通过不回显的输入框输入密码。
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
