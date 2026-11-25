---
slug: security
category: Troubleshooting and security
title: Account and document security
description: Protect credentials and uploaded documents and understand the renderer and administration boundaries.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- If an API key is exposed, immediately ask your server administrator to revoke it and issue a replacement.
- Report software vulnerabilities through [GitHub’s private vulnerability reporting form](https://github.com/n624-dev/latex-renderer/security/advisories/new). Keep vulnerability details out of public issues.

## Credentials {#資格情報}

- Keep API keys out of command-line arguments (visible in tools such as `ps`), URLs, Git repositories, logs, and AI prompts.
- Protect local credentials with Windows DPAPI or an owner-only file with mode `0600` on Linux and macOS.
- Keep browser passwords, OIDC secrets, and session cookies separate from CLI and API keys (`lrk_` and `lra_`). Use each credential only for its intended purpose.

## Projects {#プロジェクト}

The renderer treats all uploaded LaTeX source and attachments as untrusted input. It disables symbolic links, shell escape, external command execution, and network connections outside the container. Respect the sandbox, time limits, and file limits.

## Public and administrative areas {#公開領域と管理領域}

Public documentation and downloads, authenticated web pages (`/app/` and `/admin/`), and the Renderer API use separate paths on one canonical HTTPS origin.

- **Network boundary.** The only entry point is Tunnel / Workers for the Cloudflare profile, or a TLS reverse proxy for the standalone profile. All application services bind to loopback. The Internal API, SQLite, and manager sockets stay private. Authenticated areas are excluded from search-engine indexing.
- **Browser authentication and sessions.** External identity providers identify users only by an exact `provider + issuer + subject` match. Email addresses and display names cannot automatically link accounts. The server can revoke sessions immediately. State-changing requests require an exact `Origin` match and a session-specific CSRF token. Passwords are protected with `scrypt` and a root-owned pepper. Public installations should also apply proxy connection and rate limits and use the hosting provider’s DDoS protection.
- **Remote MCP.** `/mcp`, the OAuth token endpoint, and discovery metadata are publicly reachable. Tool calls require a short-lived Bearer token bound to the audience and scope. The authorization page uses the same browser session as `/app/` and explicitly links authorization to an active existing user.
  - Standard tool responses (`content`) contain only owner-scoped IDs, status, cursors, and limited diagnostics needed to continue the workflow. User-supplied paths and diagnostics are returned as untrusted data with control characters removed and limits on length and count.
  - Standard `content` and diagnostic logs exclude OAuth tokens, API keys, tickets, raw base64, full source text, complete logs, stack traces, Access subjects, and internal server paths. Full PDFs and logs are available only through resource reads that recheck ownership.

## Local setup web interface {#local-setup-web-ui}

`n624-latex setup --gui` (formerly `latex-render setup --gui`) listens only on a random port at `127.0.0.1` on your computer.

- The CLI opens a URL with a one-time bootstrap token in its fragment (`#...`). The browser immediately clears it from history and exchanges it for a short-lived session.
- Every operation API requires an exact `Origin` match, a Bearer session, and a separate CSRF token. The interface disables CORS, validates the Host and loopback peer, and enforces a strict CSP, `frame-ancestors 'none'`, and `no-store`.
- The interface passes the entered API key only to credential storage. Status, diagnostics, and sample-render responses omit it. Setup exits after 30 minutes of inactivity or 2 hours from launch, whichever comes first.
