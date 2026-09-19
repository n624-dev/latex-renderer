# Contributing

Thank you for helping improve LaTeX Renderer.

## Before opening a change

- Use a public issue for bugs and feature proposals that contain no sensitive information.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Keep production credentials, customer documents, databases, render artifacts, and host-specific configuration out of commits and test fixtures.
- For substantial behavior or deployment changes, discuss the design in an issue first.

## Development workflow

Use Node.js 24 or newer and pnpm 11.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Add or update tests for behavior changes. Keep Cloudflare and host configuration generic by using `example.com`, placeholder IDs, and environment variables. External GitHub Actions must be pinned to a full commit SHA.

For changes to the Web render form, also run the real Chromium regression suite:

```bash
pnpm exec playwright install --only-shell chromium
pnpm test:browser
```

On a fresh Linux test machine, use `playwright install --with-deps --only-shell chromium`
to install OS dependencies (requires administrator privileges). Do not run this
privileged setup on a production host without approval. CI installs the pinned
browser without an Actions cache. The suite serves the shipped App HTML/CSS/script
and simulates the API boundary; it does not replace server API, TeX rendering,
production authentication, or update/recovery tests. It covers delayed file reads,
bounded admission, shared ZIP uploads, capacity retries and mobile viewport widths.
It writes no screenshots, videos or traces by default. `PLAYWRIGHT_BROWSERS_PATH`
can point to a disposable directory so local browser downloads can be removed
after testing without touching another tool's browser cache.

Open a pull request against `main` and describe the user-visible behavior, security impact, and verification performed. Do not include generated archives or local `.env` files.

## License

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project is licensed under the Apache License 2.0, without additional terms or conditions.
