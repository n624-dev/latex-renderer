# Public documentation content

Public documentation lives in `docs/public/*.md`. The Web and Cloudflare
Static Assets builds read these files directly; normal body edits should not
require TypeScript changes.

Each published file starts with this frontmatter contract:

```yaml
---
slug: cli
category: CLI
title: CLI
description: Short page summary
navOrder: 30
updated: "2026-08-10"
since: "v1.0.0"
---
```

- `slug` is `index` or a lowercase URL segment and must match the filename.
- `navOrder` is a unique non-negative integer.
- `updated` uses `YYYY-MM-DD` and must be quoted so YAML keeps it as text.
- `since` identifies the first compatible service/client release.
- H2/H3 headings receive deterministic Japanese-compatible fragment IDs.
- GitHub-flavored tables and fenced code blocks are supported.
- `> [!NOTE]` and `> [!WARNING]` blockquotes become styled notices.
- Raw HTML is escaped. Use Markdown rather than embedding executable markup.

Run the same documentation contract checks used by pull-request CI with:

```bash
pnpm check:docs
```

This builds on the repository Markdown source and rejects broken public links or
heading fragments, unsupported `latex-render` commands/options, inconsistent MCP
setup commands, and method/path drift from the Gateway and Renderer OpenAPI
files. Every rendered page also links back to its corresponding Markdown file
on GitHub.

The former TypeScript templates remain temporarily as a rollback path. Build or
run with `PUBLIC_DOCS_SOURCE=legacy` to select them without deleting Markdown:

```bash
PUBLIC_DOCS_SOURCE=legacy pnpm --filter @latex-renderer/public-web build
```

Remove the legacy templates only after the Markdown pages and their operational
rollback have remained stable through the Phase 2 compatibility window.
