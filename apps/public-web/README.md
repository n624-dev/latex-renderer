# Public Web Static Assets

This package builds the public LaTeX Renderer landing page for Cloudflare
Workers Static Assets. Production routes are deliberately kept out of
`wrangler.jsonc`: deploying the Worker uploads a previewable version without
changing the shared production hostname. A separate reconciler owns only the
explicit public paths.

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
pnpm --filter @latex-renderer/public-web build
pnpm --filter @latex-renderer/public-web dev
pnpm --filter @latex-renderer/public-web check:preview
pnpm --filter @latex-renderer/public-web check:deploy
pnpm --filter @latex-renderer/public-web run deploy
pnpm --filter @latex-renderer/public-web routes:check
pnpm --filter @latex-renderer/public-web routes:apply
pnpm --filter @latex-renderer/public-web routes:disable
```

The build first creates the deterministic Windows client distribution, then
rejects any generated file over the Workers Static Assets 25 MiB per-file
limit. `build` and `check:deploy` perform a Wrangler dry run and start a local
Workers runtime that verifies pages, headers, 404s, and redirects without
Cloudflare credentials. `deploy` uploads the Worker but does not attach the
production hostname. `routes:apply` adds only `/`, `/docs`, `/downloads`,
`/assets`, `/openapi`, and legacy `/client` patterns. `routes:disable` removes
only routes assigned to this public Worker, returning those requests to the
existing Tunnel/VPS origin without deleting the Worker.
