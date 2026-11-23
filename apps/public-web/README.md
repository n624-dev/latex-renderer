# Public Web Static Assets

This package builds the public LaTeX Renderer landing page for Cloudflare
Workers Static Assets. A separate reconciler owns the explicit public routes.
When those routes are attached, `wrangler deploy` immediately serves the
uploaded version to production traffic.

## Included

- `/`
- `/docs/*`
- `/assets/styles.css`
- `/assets/site.js`
- `/downloads/*`
- public Gateway and Renderer OpenAPI files
- the public 404 page
- cache and security headers from `_headers`
- legacy `/client/*` redirects from `_redirects`

The generated files are written to `dist/`. Public templates and assets remain
owned by `@latex-renderer/web`, so the VPS and Static Assets builds do not fork
the page implementation.

## Intentionally left on the VPS

- `/status/*`, because it performs live health probes
- `/admin/*` and `/admin/api/*`
- Renderer API, upload, job, and artifact routes

## Commands

```bash
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm --filter @latex-renderer/public-web dev
pnpm --filter @latex-renderer/public-web check:preview
pnpm --filter @latex-renderer/public-web check:deploy
pnpm --filter @latex-renderer/public-web routes:check
pnpm --filter @latex-renderer/public-web routes:apply
pnpm --filter @latex-renderer/public-web routes:disable
```

Build the Web workspace after changing public templates or CSS. The Static
Assets build uses that compiled workspace to render the pages. It creates the
client distribution, then
rejects any generated file over the Workers Static Assets 25 MiB per-file
limit. `build` and `check:deploy` perform a Wrangler dry run and start a local
Workers runtime that verifies pages, headers, 404s, and redirects without
Cloudflare credentials.

For a public site update from a clean `main` checkout, set `PUBLIC_ORIGIN`
and run `sh deploy/scripts/deploy-public-web-production.sh`. The script
reuses a successful CI run for the exact main commit or runs the checks
locally. It verifies the latest immutable Stable client downloads, builds the guides,
checks the uploaded Worker preview, and verifies the public routes and asset
hashes after activation. Cloudflare credentials, Worker version previews, and
the public routes configured by `routes:apply` must be available.

`routes:apply` adds only `/`, `/docs`, `/downloads`,
`/assets`, `/openapi`, and legacy `/client` patterns. `routes:disable` removes
only routes assigned to this public Worker, returning those requests to the
existing Tunnel/VPS origin without deleting the Worker.
