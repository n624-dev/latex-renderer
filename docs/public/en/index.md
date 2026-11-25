---
slug: index
category: Getting started
title: LaTeX Renderer documentation
description: Compile TeX in your browser, from the command line, or with an AI assistant.
navOrder: 0
updated: "2026-11-24"
since: "v1.0.0"
---

## Make your first PDF {#最短でpdfを作る}

1. Open the [web app](/app/) and sign in using the method your server administrator provides.
2. Select your `.tex` file and choose **Convert to PDF**. If the document uses images or bibliography files, select a ZIP containing the document and its dependencies.
3. Open the PDF on the results page. To find it later, open **History** in the web app.

If you need a document to try, save this example as `main.tex` in UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Japanese sample document and ZIP layout](/en/docs/projects/)
- [Editing and conversion in the browser](/en/docs/web/)
- [Download PDFs and PNGs or retry SVG extraction](/en/docs/outputs/)

### Use the command line

[Install the CLI for your operating system](/en/docs/client/) and run `n624-latex setup` to connect to your server. In the folder containing `main.tex`, run `n624-latex main.tex` to create `main.pdf`. To choose XeLaTeX explicitly, run `n624-latex xelatex main.tex`. Your server’s rendering environment lists the available engines.

## Choose how to use LaTeX Renderer {#利用方法を選ぶ}

| What you want to do | What to use | Guide |
| --- | --- | --- |
| **Convert a file in your browser** | Web app | [Browser guide](/en/docs/web/) |
| **Compile in a terminal and save the result locally** | CLI for Windows, macOS, or Linux | [Install the CLI](/en/docs/client/) |
| **Compile from ChatGPT or Claude** | Remote MCP with OAuth sign-in | [Connect ChatGPT or Claude](/en/docs/mcp/) |
| **Work with local documents in Codex or Claude Code** | CLI with Local MCP and a skill | [Use Codex or Claude Code](/en/docs/integrations/) |
| **Automate conversion in your own application** | HTTP API | [Public API](/en/docs/api/) |
| **Run the service on your Linux server** | Self-hosted deployment | [Self-hosting guide](/en/docs/self-hosting/) |

## What you need {#必要なもの}

- **Web app or Remote MCP.** Sign in with the account your server administrator specifies.
- **CLI, Local MCP, or HTTP API.** Ask your administrator for a rendering API key beginning with `lrk_`.
- **CLI requirements** depend on how you install it.
  - Debian or Ubuntu APT package. The package includes its own Node.js runtime.
  - macOS Homebrew package. Homebrew installs the required Node.js version.
  - Downloadable installer for Windows, macOS, or Linux. Install Node.js 24 or later.

The server compiles your files, so you can use any of these methods without installing TeX Live locally.

> [!WARNING]
> Keep API keys out of AI conversations, source code, Git repositories, and logs. If you suspect exposure, promptly ask your administrator to revoke the key and issue a replacement.

For help signing in or converting a document, see [Troubleshooting](/en/docs/troubleshooting/).

### Edit and compile in your browser

Open a project and choose **Edit TeX**. The editor saves changes as a draft and can compile a new PDF when you pause typing. See the [browser guide](/en/docs/web/) for file management, revisions, and error navigation.
