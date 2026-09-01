# Security policy

## Supported versions

Security fixes are provided for the latest `1.3.x` release. Deployments should follow the immutable image and dependency pins in the latest release rather than a mutable branch or image tag.

## Reporting a vulnerability

Use [GitHub Private Vulnerability Reporting](https://github.com/n624-dev/latex-renderer/security/advisories/new). Do not open a public issue or discussion for a suspected vulnerability.

Include the affected version or commit, deployment profile, impact, and a minimal reproduction. Do not send credentials, customer TeX, generated PDFs, production database contents, private keys, or live exploit output. You should receive an acknowledgement within seven days. Disclosure timing will be coordinated after impact and remediation are understood.

## Required invariants

- Host application services bind to loopback. Public traffic enters through either the documented Cloudflare profile or a TLS reverse proxy using one of the hardened standalone examples. Internal API and privileged-manager sockets are never public.
- Deployment and browser authentication modes are explicit and fail closed. Cloudflare Access JWT signatures, exact issuer, audience, type, algorithm, and expiry are verified at origin. OIDC requires HTTPS discovery, exact issuer/audience, Authorization Code with PKCE S256, state, nonce, a fixed callback, and an asymmetric algorithm allowlist.
- External identities are keyed only by provider, issuer, and subject. Local login names are separate credentials. Email, provider username, and display name are never authentication or automatic-linking keys.
- Local passwords use scrypt with per-credential salts and a dedicated root-owned pepper. Login errors do not identify an account, account/address attempts are rate-limited with keyed identifiers, retained counters are bounded, and concurrent password derivations are capped.
- Browser sessions persist only token and CSRF hashes, have idle and absolute expiry, are revoked on identity/credential/security changes, and cannot survive an authentication-mode or issuer change. Browser mutations require an exact canonical Origin and the session-specific CSRF token. CLI administration uses independent scoped `lra_` keys.
- Authentication-mode changes require local provisioning against an immutable active-owner ID. The recovery command refuses credential replacement, revokes prior sessions, and never selects or links an owner by email.
- The Cloudflare Worker and standalone gateway share the same small-request admission core. Standalone application controls do not replace hosting-provider network DDoS protection, reverse-proxy connection/rate/body limits, or TLS maintenance.
- API key secrets are stored only as HMAC-SHA-256 values with a versioned server pepper. Tickets are short-lived, key-versioned, scope-bound, job-bound, and revalidate principal state.
- TeX is hostile code. Rendering has no network, runs in rootless Docker as a non-root UID/GID with all capabilities dropped, a read-only root, no-new-privileges, a default-deny seccomp allowlist, and PID, CPU, RAM, and time limits. The production profile does not claim AppArmor support under rootless Docker.
- ZIP paths and headers are validated before extraction; directory entries and actual extracted byte and file totals are enforced.
- Only allowlisted, validated artifacts are copied from untrusted staging into persistent storage.
- Secrets and document contents are never logged. Returned log and error text is treated as untrusted.
- The Web and Admin API never run `sudo`. Privileged application updates cross a local Unix-socket boundary to a root-owned helper that accepts only allowlisted operations and immutable project Releases. It verifies the locked release tag, GitHub asset digest, archive paths, and embedded version/commit metadata before executing the fixed deployment entry point. Update logs are redacted and host secrets/configuration remain outside release artifacts and Git.

Development may use `ALLOW_ROOTFUL_DOCKER=true` only on an isolated machine; production must not. Key rotation, emergency revocation, and incident procedures are in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
