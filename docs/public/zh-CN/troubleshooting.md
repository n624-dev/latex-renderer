---
slug: troubleshooting
category: 故障排查与安全
title: 故障排查
description: 诊断登录、安装、转换和下载问题。
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## 排查顺序 {#確認する順序}

1. **检查[服务状态](/status/)**，确认是否有全局故障或维护。
2. **检查已有作业。** 如果已开始转换，请在 Web 应用的**历史记录**中打开同一作业，或在 CLI 中运行 `n624-latex jobs get <jobId>`。
3. **检查诊断与日志。** 在结果页面查看“诊断”，或在本地检查 `.render/errors.json` 和更详细的 `.render/compile.log`。

## 常见问题 {#代表的な問題}

### 安装与登录 {#インストール-ログイン}

- **找不到 `n624-latex` 或 `latex-render`。**
  打开新的终端或 PowerShell 窗口。如果问题仍然存在，在 Linux 和 macOS 上检查 [PATH 设置](/zh-CN/docs/client/#linux-macos)，在 Windows 上检查[安装步骤](/zh-CN/docs/windows/#インストール)。
- **无法登录 Web 应用。**
  确认使用已注册的账号，并按管理员指定的方式登录（密码、OIDC 或 Cloudflare Access）。若 ChatGPT 或 Claude 连接失败，请参见[检查 Remote MCP 连接](/zh-CN/docs/mcp/#chatgptなどの接続を確認する)。
- **CLI 返回 `401` 或 `403`。**
  运行 `n624-latex auth status` 检查密钥注册状态。请管理员确认密钥有效并具有 `render:create` 和 `render:read:own` 权限，必要时[重新注册密钥](/zh-CN/docs/cli/#認証)。自托管用户还应检查[服务器 URL（`LATEX_RENDER_BASE_URL`）](/zh-CN/docs/cli/#接続先サーバー)。

### 上传与转换 {#アップロード-変換}

- **ZIP 中找不到主文档。**
  默认入口为根目录下的 `main.tex`。检查是否将外层目录一并压缩，或手动指定主文件的相对路径。参见 [ZIP 目录结构](/zh-CN/docs/projects/#構成)。
- **文件大小或扩展名被拒绝。**
  移除不必要的生成文件和不支持的文件，或配置 `.latexrenderignore`。请检查[支持的文件和限制](/zh-CN/docs/projects/#制限)。
- **转换一直排队，或连接中断。**
  服务器可能仍在处理。请重新打开同一结果页面，或查询同一作业 ID，避免重复提交。
- **找不到宏包或字体，或编译超时。**
  在[渲染环境](/app/environment/)中搜索可用的宏包或字体。若超时，请检查日志停止位置附近的复杂宏、大图片和 TikZ 图形。

### 下载输出文件 {#成果物の取得}

- **已生成 PDF，但没有 SVG。**
  如果结果为**部分成功**，请先保存 PDF，再选择**仅重试 SVG**。参见 [SVG 提取失败时的处理方法](/zh-CN/docs/outputs/#pdf-はあるが-svg-が失敗した場合)。
- **PNG 预览一直显示准备中。**
  稍候或重新打开同一页面。此时可直接下载已完成的 PDF。
- **目标位置被占用，或出现 `OUTPUT_BUSY`。**
  关闭打开目标 PDF 的阅读器，或等待正在向同一目录写入的其他进程完成，再重新下载。
- **结果已过期或存储空间不足。**
  结果过期后，请使用已保存的版本或本地文件重新转换。个人配额已满时，可删除不需要的已结束作业。如果服务器磁盘已满，请联系管理员。

## 联系支持 {#問い合わせ}

- **联系服务器管理员。** 提供发生时间、停止的操作、错误代码及已知的作业 ID（`job_...`）。
- **在 GitHub 公开报告问题。** 请提供去除机密信息和个人文档的最简复现步骤。**切勿公开 API 密钥、Cookie、原始文档、PDF 或未经删改的完整日志。**
