---
slug: troubleshooting
category: Troubleshooting and security
title: Troubleshooting
description: Diagnose problems with sign-in, installation, conversion, and downloads.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Where to start {#確認する順序}

1. **Check [service status](/status/)** for outages or scheduled maintenance.
2. **Check the existing job.** If you already started a conversion, open the same job in **History** or run `n624-latex jobs get <jobId>`.
3. **Read the diagnostics and log.** In the web app, open **Diagnostics** on the results page. In the CLI, check `.render/errors.json` and the detailed log at `.render/compile.log`.

## Common problems {#代表的な問題}

### Installation and sign-in {#インストール-ログイン}

- **The shell cannot find `n624-latex` (or `latex-render`).**
  Open a new terminal or PowerShell window. If the problem persists, check [PATH on Linux or macOS](/en/docs/client/#linux-macos) or the [Windows installation instructions](/en/docs/windows/#インストール).
- **You cannot sign in to the web app.**
  Use the registered account and sign-in method specified by your administrator (password, OIDC, or Cloudflare Access). For ChatGPT or Claude connection issues, see [Check a Remote MCP connection](/en/docs/mcp/#chatgptなどの接続を確認する).
- **The CLI returns `401` or `403`.**
  Run `n624-latex auth status` to check the saved key. Ask your administrator to confirm that the key is active and has `render:create` and `render:read:own`. If needed, [register the key again](/en/docs/cli/#認証). For self-hosted installations, also check the [server URL (`LATEX_RENDER_BASE_URL`)](/en/docs/cli/#接続先サーバー).

### Uploads and conversion {#アップロード-変換}

- **The ZIP has no main document.**
  The default is `main.tex` at the root. Check whether you included the parent folder in the archive, or specify the main file’s relative path. See [ZIP layout](/en/docs/projects/#構成).
- **The server rejects a file size or extension.**
  Remove unnecessary generated files or unsupported files, or configure `.latexrenderignore`. Check [supported files and limits](/en/docs/projects/#制限).
- **Conversion stays queued, or the connection drops.**
  The server may still be working. Reopen the same results page or job ID before creating another job.
- **A package or font is missing, or compilation times out.**
  Search the [rendering environment](/app/environment/) for available names. For timeouts, look for complex macros, large images, or TikZ diagrams near the point where logging stopped.

### Downloading artifacts {#成果物の取得}

- **The PDF is available, but the SVGs are missing.**
  If the result shows **Partial success**, save the PDF, then choose **Retry SVG only**. See [Retry SVG extraction](/en/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **A PNG preview keeps showing that it is being prepared.**
  Wait briefly or reopen the same page. You can download the finalized PDF immediately.
- **The destination is in use or the CLI reports `OUTPUT_BUSY`.**
  Close any viewer that has the output PDF open, or wait for another process writing to the same folder to finish. Then download again.
- **The result has expired or storage is full.**
  Recompile expired results from a saved revision or local files. If you have reached your personal quota, delete finished jobs you no longer need. Contact your administrator if the server reports that its disk is full.

## Get help {#問い合わせ}

- **Contact your server administrator.** Include the time, the operation that stopped, the error code, and the job ID (`job_...`) if available.
- **Report a bug or suggest an improvement** in the [public issue tracker](https://github.com/n624-dev/latex-renderer/issues). Describe what you were doing, include the steps and conditions needed to reproduce the issue, and share the error code if one appeared. Remove any sensitive information.
- **For private support with the official ChatGPT plugin**, email [contact@n624.jp](mailto:contact@n624.jp). Use the same address for privacy questions or requests to delete connection data. In your first message, describe the operation and include the error code if available.

Keep API keys, cookies, original documents, PDFs, and full unedited logs out of public reports and initial emails.
