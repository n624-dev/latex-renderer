---
slug: contributing
category: Development and contributions
title: Contribute to the documentation
description: Edit the Markdown guides and check your changes locally.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Edit a guide {#本文を編集する}

- **Report an error.** If a guide differs from the actual interface or command, open a [GitHub issue](https://github.com/n624-dev/latex-renderer/issues/new/choose) with the page and your suggested correction.
- **Submit a pull request.** Edit the relevant [Markdown source in `docs/public/`](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) and open a pull request.

## Verify locally {#ローカル検証}

After editing, run the following commands and check that the build, link checks, and header checks pass.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

The `public-web` build runs a Wrangler dry run, then starts a local Workers runtime to check representative pages, the search index, 404s, redirects, and response headers.

## Compatibility {#互換性}

- Preserve published URL paths and heading anchors (the `#...` fragments generated from heading text). If you rename a heading, check links from other pages.
- When changing a CLI option or an HTTP request example, check it against both the implementation and the OpenAPI definitions.
