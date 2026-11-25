---
slug: reference
category: 运维与开发
title: 运维与开发参考
description: 查询客户端存储与恢复机制、MCP 认证及旧版迁移流程。
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## 输出文件的保存与恢复 {#成果物の保存-復旧の仕様}

> [!DETAILS] 规范与步骤
>
> - **原子切换目录。** CLI 和 Local MCP 保留 `.render/result.pdf`、`job.json`、预览等路径。它们会核验每个文件声明的大小和 SHA-256，整套文件齐备后才切换目录，不会在原目录逐个覆盖。切换瞬间目录可能暂时不可见，外部程序应在命令完成后读取。
> - **自动恢复。** 输出目录旁的 `<输出目录名>.latex-renderer-state` 管理目录会自动从输入收集中排除。正常退出时清除临时数据；强制退出后，下次下载会自动恢复。提交前中断则恢复旧文件，提交后中断则保留新文件并清理旧文件。处理期间或恢复前请勿手动删除管理目录。
> - **互斥和异常检测。** 并发写入同一输出目录时返回 `OUTPUT_BUSY`。不会仅因经过一定时间而抢占运行中进程的锁，PID 被复用时也会安全停止。发现管理信息损坏、未知文件或外部链接时，会要求检查而不会自动删除。
> - **保护用户文件和使用限制。** 用户放入输出目录的普通文件会复制到新目录。下载期间若检测到用户修改文件，将停止发布并保留修改。宜使用专用目录。新旧两套文件各限 1 GiB、10,000 项，切换时需要可同时容纳两套文件和临时数据的空间。仅支持本地文件系统，含符号链接、硬链接或其他文件系统挂载点的路径会被拒绝。不保证网络共享上的互斥或断电时的完全原子性。Windows 上若有打开的文件阻止切换，将保留旧文件。

## Web 身份验证边界 {#web認証の境界}

> [!DETAILS] 规范与步骤
>
> `/app/`、`/admin/` 及其 API 受服务器端会话保护，不列入公开搜索索引。普通用户可访问 `/app/`，只有管理员和所有者可以访问 `/admin/`。外部身份提供商以 `issuer + subject` 识别用户，密码认证以 `login name` 识别用户，不使用邮箱或显示名称作为身份键。ZIP 上传、作业、输出文件及 TeX 编译均由服务器上的渲染器处理。
>
> > [!NOTE]
> > 浏览器不会持久保存作业的短期票据，需要时通过服务器端会话重新签发。请勿复制和分享会话 Cookie、CSRF 令牌或短期票据。

## Remote MCP 注册与诊断 {#remote-mcpの登録-診断}

> [!DETAILS] 规范与步骤
>
> - **动态客户端注册（DCR）的保留和上限。** 未完成或不活跃的注册通常在 30 天后清理，仍被有效授权码或令牌族引用的注册受保护。总上限为 10,000 项。若清理后出现 `invalid_client`，请在 AI 客户端重新注册。标准 DCR 请求允许省略客户端名称，仍会验证名称和重定向 URI。
> - **临时保存授权请求（数据库模式 20）。** 需要先通过浏览器登录的授权请求以短随机 ID 暂存，可恢复原请求，无需将长 OAuth `state` 重新嵌入登录返回 URL。有效期 10 分钟，只有认证浏览器和专用 Cookie 匹配时才可使用一次。并行标签页使用独立 ID。总上限 1,000 个请求，每个浏览器最多 8 个续接 Cookie。达到上限时返回 `503`，不会清除已有请求。数据库仅保存 ID 和 Cookie 的哈希，重启或恢复备份不会延长期限。
> - **IP 限流和来源标头。** 每个受信任来源 IP 在 15 分钟内最多注册 10 次，共用代理出口 IP 的客户端共享配额。从第 11 次起返回 HTTP `429`、`temporarily_unavailable` 和 `Retry-After`。无效的注册元数据不消耗配额。来源 IP 缺失或无效时返回 `503`，提示检查代理，而不会把请求合并到公共配额。后端绑定回环地址，代理将 `X-Latex-Renderer-Client-IP` 覆盖为实际来源 IP。不接受任意 `X-Forwarded-For`；Cloudflare 路由也会处理信任边界内的 `CF-Connecting-IP`。
> - **管理员连通性检查。** 以下命令不发送凭据，仅检查公开服务发现和 `401` Bearer 质询，不更改设置、不跟随重定向，也不输出响应正文、Cookie 或秘密信息。
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **分阶段排查日志。** 服务发现返回 `200`、`401` 质询正常，仅能证明这些阶段通过。请将停滞的阶段、时间和 `X-Request-ID` 与服务器日志中的 `remote_mcp.http_result`、`remote_mcp.oauth_stage`、`remote_mcp.protocol_error`、`remote_mcp.rpc_result` 对照。不要在日志或 Issue 中披露 OAuth 授权码、令牌、Cookie、PKCE verifier、输入或用户 ID。
> - **认证成功但发现操作失败。** 分别检查令牌签发后的 `initialize`、初始化通知及 `tools/list`。即使 HTTP 为 `200`，若 JSON-RPC 响应含 `error` 仍属失败。`remote_mcp.rpc_result` 会记录 HTTP 状态、结果分类、协议版本、工具数量、响应字节数和列表基本结构。检查缓冲区上限 256 KiB，超出时只记录 `inspection_limited`，不会改写响应。不要仅凭 SSE 响应或 `GET` 返回 `405` 判定故障。检查 `Accept`、`Content-Type`、协议协商以及代理请求是否到达后端。本地 HTTP 测试通过后，仍需在实际部署中验证外部 OIDC、Cloudflare 策略和真实 ChatGPT 账号。

## MCP 结果与资源 {#mcpの結果とresource}

> [!DETAILS] 规范与步骤
>
> Remote MCP 响应分为三层。
> 1. **标准 `content`** 提供 AI 判断及调用下一工具所需的输入 ID、作业 ID、状态、偏移量、游标、可用性及有限诊断。即使客户端不支持 `structuredContent` 或自定义资源，也可完成创建、修正和重新渲染。
> 2. **`structuredContent`** 包含经过验证、可供程序处理的完整结果对象。
> 3. **MCP 资源（`latex-renderer://jobs/...`）** 提供 PDF、完整的 `compile.log`、原始 JSON、`svg/manifest.json`、`svg/objects/*.svg` 等较大数据，仅同一 OAuth 所有者可读取，沿用常规输出的保留期和大小上限。各层均不包含 API 密钥、OAuth 令牌、票据、输入正文或原始 base64。

## CLI 等待与重试 {#cliの待機と再試行}

> [!DETAILS] 规范与步骤
>
> 等待作业结束期间，如轮询遇到临时 HTTP `502`、`503`、`504` 或无效 JSON，CLI 仅对同一作业的状态查询自动重试，**最多 5 次**，依次等待 1、2、4、8、8 秒，不延长总超时。创建作业、上传、更新令牌和校验输出均不会自动重试，认证或权限错误立即返回。CLI 等待失败不代表服务器作业已停止。

## CLI JSON 格式 {#cliのjson形式}

> [!DETAILS] 规范与步骤
>
> 指定 `--json` 时，标准输出使用以下格式，永不包含 API 密钥、`uploadTicket` 或 `jobTicket`。
>
> - **成功（退出码 `0`）**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI 或 API 错误（退出码 `1`）**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **LaTeX 编译失败等作业错误（退出码 `2`）。** `result` 包含作业信息和保存路径，响应返回 `success: false`。

## 旧版迁移与特殊恢复 {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　旧版更新程序迁移和解压错误
>
> ### 从 v1.2.x 的 root 更新程序迁移到权限分离架构 {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> v1.2.x 及更早的 Update Manager 作为 root 守护进程运行。自 v1.3.0 起，常驻控制器以 `latex-renderer-update` 用户运行，短时 root 辅助进程仅接受固定操作。旧更新程序通过 Web 更新时可能报 `Application Update Manager must use a separate non-root build tree`，请勿反复执行同一网页操作。
>
> 此一次性迁移使用 [v1.3.6 服务器发行包](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6)。以普通用户按[下载和验证步骤](/zh-CN/docs/self-hosting/#v1-6-9をダウンロードして検証)操作，将开头的 `version=` 行替换为 `version=1.3.6`。在同一终端中继续使用验证和解压时设置的 `bundle_root`。
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> 脚本以 root 身份重新获取同一不可变发行包，复核摘要、标签与提交、Sigstore bundle、归档上限及元数据。`gh` 仅允许来自 `/usr/local/bin/gh` 或 `/usr/bin/gh`，并须归 root 所有且组和其他用户不可写。构建时分离 root 所有的 `verified`、非 root 的 `bootstrap-build`（专用 Corepack shim 使用固定 pnpm）和 root 所有的 `assembly` 目录。仅在取得共享变更锁后停止旧管理器，失败时重新启动旧管理器。成功后用以下命令确认 `User=latex-renderer-update` 和各服务的 `active` 状态，之后使用正常的 Web 或 Admin CLI 更新。
> 不向 Web 或 API 提供 sudo 权限或 GitHub 令牌。
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar 解压时报 Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Ubuntu 的 GNU `tar` 使用 `openat2` 时，更新程序的 `RestrictSUIDSGID=true` 限制可能导致多层归档解压失败，报 `ENOSYS`（Function not implemented）。修复版保留 GNU `tar` 检查和签名验证，仅改用 `/usr/bin/bsdtar` 在空的私有暂存目录中解压，不导入所有者、ACL 或扩展属性。不会关闭 `RestrictSUIDSGID` 或替换系统 `tar`。
>
> 旧更新程序也可能无法解压含修复的发行包。确认无进行中操作、应用和数据库正常且加密备份已验证后，使用已安装的 `bootstrap-v1` **先单独将更新程序升级到已发布的修复版**。
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> 确认更新程序的新版本以及 `ready`、`pending=false` 后，通过正常 Web 或 Admin CLI 的 `update apply` 操作将同一版本应用到应用本身。
>
> `v1.4.0-rc.3` 更新程序存在已知问题：复制到 root 空间的 bundle 仍归非 root 用户所有，导致 `Release extraction requires a private regular bundle`。请保留检查，先单独更新到含所有者修复的新发行版，再更新应用。可用 `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs` 单独验证 root 和 systemd 下的解压操作。

> [!DETAILS] 检查更新或 TeX 变更的锁
>
> ### 变更锁被占用 {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` 用于防止应用更新与 TeX 变更同时执行。有操作运行时请等待。**切勿删除 `/run/latex-renderer/mutation.lock` 本身**，否则新旧两个锁可能同时生效。如果应用更新期间内部恢复 TeX 运行环境时遇到此错误，可能发生自身竞争；请先检查日志和已停止的服务，避免直接重试。
>
> 只有在没有运行中的操作且日志表明上一次已完成时，才停止两个管理器并检查持有锁的进程。
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> 仅当确认该进程是已完成操作遗留的孤立锁辅助进程时，才终止它并重启管理器。
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## 旧版候选发行的渲染器标识 {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　v1.3.4 候选版本
>
> 从 `v1.3.4-rc.3` 更新到 `v1.3.4-rc.4` 时，因渲染器标识哈希覆盖的文件从 5 个变为 6 个，服务切换前更新失败。此组合应迁移到含旧版兼容信息的修复版 `v1.3.4-rc.5`。发行包整体校验和及来源签名也会验证新增的文件。

## 更新程序的运行目录 {#updaterの実行領域}

> [!DETAILS] 规范与步骤
>
> Update Manager 严格分离保存已验证发行包的 root 所有 `verified` 目录、仅安装依赖及构建的非 root `build` 目录，以及仅包含获准输出的 root 所有 `assembly` 目录。root 执行的部署脚本始终是 `assembly` 中经过验证的副本。以部署用户进行 Cloudflare 发布等操作时，使用通过 root 检查的临时 `deployment-build` 副本。回滚同样遵循此规则。

## Windows 安装位置和保护 {#windowsの配置と保護}

> [!DETAILS] 规范与步骤
>
> Windows 更改安装目录时，默认命令目录随之移至其 `bin` 子目录。如设置 `LATEX_RENDER_BIN_DIRECTORY`，则受管理的启动程序放在指定位置，用户 PATH 与 Local MCP 共用。不会覆盖其他启动程序。旧版记录的路径可通过 `setup repair` 修复，旧 PATH 条目会保留以免影响其他用途。路径必须为绝对路径，不得包含分号、引号或控制字符。如果 `--open` 或 GUI 未能打开浏览器或阅读器，已保存的 PDF 仍然保留。

## 已保存项目的共享和保留 {#保存プロジェクトの共有-保持}

> [!DETAILS] 共享与保留规范
>
> - Web（`/app/`）、CLI、公开 API、Local MCP 和 Remote MCP 共享同一用户的项目和不可变修订历史。隶属同一用户的多个 API 密钥或服务账号也可查看和更新项目。仍可使用不保存项目的临时输入和作业流程。
> - 输入、主文档、引擎与输出格式的组合共同标识一个版本。输出格式不同的版本可以共享同一输入。**重新转换**时选取的输出格式仅适用于本次运行。选择初始设置则使用该版本已保存的输出格式。
> - 有效项目版本引用的输入即使超过孤立保留期限也会保留，并计入用户存储配额。删除项目会隐藏记录。最后一个引用它的项目被删除且已无作业引用时，不再保护该输入，过期后由定期清理回收。需要立即彻底删除时，请联系管理员。

## 显示语言 {#表示言語}

编辑器的**显示语言**设置保存在账号中。未设置时按浏览器语言顺序匹配，找不到支持的语言时使用英语。文档引擎和文本编码需另行设置。

| 范围 | 翻译覆盖情况 |
| --- | --- |
| 网页与设置 | 操作、执行状态、确认信息和诊断。 |
| CLI 与 MCP | CLI 帮助和提示使用终端语言。远程 MCP 说明使用账户语言。 |
| 编辑器 | 编辑、查找与替换、保存与冲突、编译状态和预览控件均支持 18 种语言。 |
| 公开指南 | 所有指南均提供下列 18 种语言版本。使用页面顶部的“显示语言”切换。 |

编辑器支持英语、日语、简体中文、韩语、西班牙语、葡萄牙语、法语、德语、意大利语、俄语、土耳其语、波兰语、捷克语、荷兰语、瑞典语、挪威语（书面语）、丹麦语和芬兰语。TeX 及第三方宏包的日志保留原文，便于排查错误。

## 恢复审计日志 {#監査ログの復旧}

恢复数据库后，审计日志导出位置记录（`export_database_id`、行序号 `export_sequence`、`export_token`）可能与数据库不符。为保护数据，导出和清理会停止。

1. 调查与恢复期间，停止审计导出和清理服务及其定时器。
2. 在其他位置保存已恢复的数据库、已有的加密导出和所有新旧格式的检查点文件。校验目标数据库的完整性、外键及迁移状态。
3. 如果没有一致的检查点，且决定重新导出数据库中的审计记录，请将检查点文件移出有效路径。若设置了 `AUDIT_EXPORT_CHECKPOINT`，也需检查该路径。保留数据库内的审计行、SQLite 序号和 `export.lock`。
4. 使用与生产服务相同的凭据手动执行一次导出，验证加密输出可解密且已生成格式 3 的新检查点后，重新启动定时器。

只会重新导出已恢复数据库中仍存的记录。与历史输出比对时，请使用 `export_database_id`、`export_sequence` 和 `export_token` 的组合去重，仅凭时间戳无法确认。
