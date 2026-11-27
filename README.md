# LaTeX Renderer

[![CI](https://github.com/n624-dev/latex-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/n624-dev/latex-renderer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Turn LuaLaTeX documents into PDFs through a browser, the command line, an HTTP
API, or an MCP-compatible AI client. Upload one `.tex` file or a ZIP containing
your document, images, bibliography, and local style files. You can also request
PNG page previews and SVG files for equations and TikZ figures.

## Get started

[日本語の利用ガイド](https://latex-render.n624.jp/docs/)

| I want to…                                 | Start here                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Convert a document in my browser           | [Open the Web app](https://latex-render.n624.jp/app/) · [Web guide](https://latex-render.n624.jp/docs/web/) |
| Render from a terminal                     | [Install the CLI on Windows, macOS, or Linux](https://latex-render.n624.jp/docs/client/)                    |
| Use ChatGPT, Claude, or another MCP client | [Connect an AI client](https://latex-render.n624.jp/docs/mcp/)                                              |
| Integrate rendering into my application    | [HTTP API guide](https://latex-render.n624.jp/docs/api/)                                                    |
| Run my own server                          | [Self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/)                                       |

For the hosted service, ask your administrator to set up your account for Web and
Remote MCP access, or to issue a rendering API key for CLI, Local MCP, and HTTP
API access. The same guides apply to a self-hosted server using its own URL.

### Try a small document

Save the following as `main.tex`. Select it in the Web app and choose **PDFに変換**
(Convert to PDF). Open or download the PDF on the result page.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

For a document with images or references, ZIP the files together and keep their
relative paths. See the [project guide](https://latex-render.n624.jp/docs/projects/)
for a Japanese example, file types, and project layout.

## Run your own server

Use the versioned [v1.7.2 server release](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.2).
The [self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/) covers
Linux prerequisites, supported HTTPS and sign-in options, release verification,
first-time setup, updates, and backups.

Rendering runs on the server in a resource-limited, non-root Docker container
with a read-only filesystem and no network access. See the
[security guide](https://latex-render.n624.jp/docs/security/) for deployment
and credential guidance.

## Help and contributions

- [Troubleshoot installation, sign-in, or rendering](https://latex-render.n624.jp/docs/troubleshooting/)
- [Report a bug or request a feature](https://github.com/n624-dev/latex-renderer/issues/new/choose)
- [Report a vulnerability privately](SECURITY.md)
- [Build, test, and contribute](CONTRIBUTING.md)

Licensed under the [Apache License 2.0](LICENSE).
