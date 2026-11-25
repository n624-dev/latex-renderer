---
slug: index
category: 入门
title: LaTeX Renderer 使用指南
description: 在浏览器、终端或 AI 工具中将 LaTeX 文档转换为 PDF。
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## 快速生成 PDF {#最短でpdfを作る}

1. 打开 [Web 应用](/app/)，按管理员提供的方式登录。
2. 选择 `.tex` 文件，点击**转换为 PDF**。如果文档用到图片或参考文献，请将它们与文档打包成 ZIP，再选择该压缩包。
3. 打开转换结果中的 PDF。稍后要查看结果时，可打开 Web 应用中的**历史记录**。

如果手边没有文档，可以将以下内容以 UTF-8 编码保存为 `main.tex`。

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [日文示例与 ZIP 打包方法](/zh-CN/docs/projects/)
- [Web 应用使用指南](/zh-CN/docs/web/)
- [保存 PDF、PNG 和重试 SVG](/zh-CN/docs/outputs/)

要在终端中使用，请先[为当前操作系统安装 CLI](/zh-CN/docs/client/)。运行 `n624-latex setup` 配置连接，然后在 `main.tex` 所在的文件夹中运行 `n624-latex main.tex`，即可生成 `main.pdf`。

## 选择使用方式 {#利用方法を選ぶ}

| 目标 | 使用的功能 | 指南 |
| --- | --- | --- |
| **在浏览器中快速转换** | Web 应用 | [在浏览器中转换](/zh-CN/docs/web/) |
| **在终端中转换并保存到本机** | CLI（Windows、macOS、Linux） | [安装 CLI](/zh-CN/docs/client/) |
| **在 ChatGPT 或 Claude 中转换** | Remote MCP（OAuth 登录） | [连接 ChatGPT 或 Claude](/zh-CN/docs/mcp/) |
| **在 Codex 或 Claude Code 中处理本地文档** | CLI、Local MCP 和 Skill | [在 Codex 或 Claude Code 中使用](/zh-CN/docs/integrations/) |
| **从自己的应用自动转换** | HTTP API | [公开 API](/zh-CN/docs/api/) |
| **在自己的 Linux 服务器上运行** | 自托管 | [自托管指南](/zh-CN/docs/self-hosting/) |

## 准备工作 {#必要なもの}

- **Web 应用 / Remote MCP**：需要服务器管理员提供的登录账号。
- **CLI / Local MCP / HTTP API**：需要管理员签发的渲染 API 密钥（以 `lrk_` 开头）。
- **CLI 运行环境**：
  - Debian / Ubuntu（APT 软件包）：已内置专用的 Node.js，无需单独安装。
  - macOS（Homebrew 版）：Homebrew 会安装所需的 Node.js。
  - Windows / macOS / Linux（独立安装程序）：需要 Node.js 24 或更高版本。

所有转换都在服务器上完成。无论选择哪种方式，都无需在本机安装 TeX Live。

> [!WARNING]
> 请勿将 API 密钥粘贴到 AI 对话、源代码、Git 仓库或日志中。如怀疑密钥泄露，请立即联系管理员撤销并重新签发。

遇到转换或登录问题时，请参阅[故障排查指南](/zh-CN/docs/troubleshooting/)。
