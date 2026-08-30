# Threat model

Assets are account and owner authority, API/ticket/session/CSRF/IdP secrets, source documents, generated artifacts, audit history, host integrity, release integrity, and availability. Adversaries include Internet attackers, malicious or compromised users and administrators, compromised AI tools, hostile TeX/ZIP/PDF/image authors, a malicious upstream IdP, and a compromised dependency or release source.

Primary trust boundaries are:

- Internet to Cloudflare edge or operator-managed TLS reverse proxy;
- trusted frontend to the loopback gateway, Web, Remote MCP, and renderer APIs;
- authentication provider assertion or password proof to an internal user and role;
- API process to SQLite and persistent storage;
- unprivileged Web/Admin API to root-owned Image and Update Manager sockets;
- renderer worker to the rootless Docker daemon, and hostile Job to its sandbox;
- GitHub Release/GHCR/TeX archive inputs to the deployed application and image.

Authentication threats include forged or replayed assertions, OIDC mix-up, state or nonce replay, PKCE downgrade, algorithm confusion, email/username collision, session theft/fixation, CSRF, credential stuffing, account enumeration, and stale privilege after a role or mode change. Controls are exact HTTPS issuer/origin/audience checks, signature and asymmetric-algorithm allowlists, short one-use OIDC state with PKCE S256 and nonce, explicit identity provisioning keyed by provider/issuer/subject, generic password failures, scrypt plus a root-owned pepper, keyed account/address rate limits, bounded password concurrency, hashed rotating session secrets, idle/absolute expiry, security-version revalidation, exact Origin, and per-session CSRF. No email-based JIT linking or browser-to-CLI credential substitution is allowed.

Authentication-mode migration also risks administrator lockout or an unintended account link. The only supported transition pre-provisions the target credential locally against an explicit active-owner ID, refuses replacement, records an audit event, revokes existing sessions, validates the new production profile before restart, and keeps the old method until a separate login test succeeds.

Admission and content threats include API-key replay, ticket use after disablement, request smuggling through ambiguous lengths, oversized control requests, ZIP traversal/bombs, TeX/Lua code execution, Docker/host escape, resource exhaustion, cross-job file access, and malicious artifacts or diagnostics. Controls include shared gateway method/header/size/idempotency validation, scoped/versioned credentials, per-request principal revalidation, nonce/idempotency transactions, server-generated paths, streamed limits, strict ZIP header/path checks, rootless networkless read-only containers with dropped capabilities and seccomp/resource limits, and output type/magic/size revalidation. Large bodies bypass only the small gateway, not renderer ticket authorization or limits.

Operational threats include spoofed proxy identity headers, accidental public loopback services, arbitrary privileged commands, unsafe concurrent mutations, mutable or path-traversing release archives, secret leakage, audit tampering, and unrecoverable forward migration. Controls include loopback binds, reverse proxies that replace client-IP and strip Cloudflare identity headers, allowlisted manager protocols with a shared OS lock, immutable tag/asset/metadata/digest verification, archive path checks, root-owned secrets outside Git/releases, redacted logs, append-only audit APIs, encrypted off-host WAL-consistent backups, and explicit restore-only rollback across Migration 007.

Residual risk remains in the hosting network, reverse proxy, Cloudflare, OIDC provider, Docker/kernel, TeX, image/PDF parser, Node dependencies, GitHub/GHCR, and authorized administrator supply chains. Standalone application limits cannot provide network-level DDoS absorption. Operators must patch supported releases, protect and rotate credentials, review immutable digests, monitor capacity and authentication failures, test proxy isolation, and exercise backup restoration.
