# Reviewed standalone HTTPS ingress

This connects the shared server setup Core to a read-only host preflight and a
scoped Nginx configuration generator (issue #52). It is not an automatic network
cutover or a completed CUI/Web wizard. Existing Cloudflare installations keep
their configuration and do not read standalone TLS secrets or contact a provider
through this code. No firewall, DNS, disk, certificate-renewal or service settings
are changed by these commands.

## Explicit exposure, no legacy inference

Keep the existing authentication selection and matching HTTPS
`PUBLIC_ORIGIN` / `RENDERER_PUBLIC_URL` / optional `ADMIN_API_URL`. Add ingress
settings only when an operator has reviewed the intended exposure:

```ini
DEPLOYMENT_MODE=standalone
PUBLIC_ORIGIN=https://renderer.example.test:8443
RENDERER_PUBLIC_URL=https://renderer.example.test:8443
AUTH_MODE=password
INGRESS_ACCESS_SCOPE=lan
INGRESS_TLS_PROVIDER=custom
INGRESS_LISTEN_ADDRESS=192.168.1.2
INGRESS_LAN_NETWORKS=192.168.1.0/24
```

Replace example addresses/origins with actual reviewed settings. This excerpt
is **not** a complete production EnvironmentFile. Do not drop existing storage,
renderer, internal tokens or secret-file references.

- `local`: bind explicitly to `127.0.0.1` or an assigned loopback IPv4/IPv6
  address such as `::1`. No wildcard/external listener or LAN network list.
- `lan`: bind to one assigned RFC1918 or IPv6 ULA address. Require 1–32 unique,
  private client CIDRs with zero host bits, including the server's subnet.
  Routed private client subnets can also be included. No wildcard, public or
  link-local CIDRs. No interface/address is guessed when one disappears.
- `internet`: explicitly bind to an assigned unicast address or `0.0.0.0` / `::`.
  This is not a firewall/NAT configuration. Wildcard IPv6 dual-stack behavior is
  a property of the operator's OS/Nginx and must be reviewed before applying.

Only HTTPS is generated, on the origin's port (default 443). The standalone
origin's hostname must be a literal IP or DNS labels (no trailing dot or Nginx
wildcard shorthand). Internal ports 3100–3199 are reserved and cannot be used
for ingress. The non-default origin
port is preserved in forwarded Host headers. All upstreams remain fixed
`127.0.0.1:3100`–`3105`; the generator cannot accept arbitrary upstreams.

Without any `INGRESS_*` keys, legacy profiles remain **unreviewed**, not
implicitly Internet/LAN/local. Existing deployment/authentication behavior is
preserved. Partial/new invalid settings fail production preflight before secret
generation. A Cloudflare ingress review may explicitly declare `internet` /
`cloudflare`, but cannot contain standalone listener/network settings.

`automatic` TLS is representable in a planning review, but **not implemented**:
active ENV export, production preflight and Nginx generation reject it with an
actionable error. There is no silent HTTP/custom-provider fallback or ACME call.
Certificate automation and renewal remain unfinished work.

## Custom PEM certificate and key

The privileged adapter reads only these fixed slots:

```text
/etc/latex-renderer/secrets/https-cert.pem
/etc/latex-renderer/secrets/https-key.pem
```

The certificate is PEM leaf first, optionally followed by its intermediate
chain. The private key is unencrypted PEM. Keep both as single-link regular
files owned by `root:latex-renderer`, mode `0440`, under root-owned directories
without group/other write permission. Final symlinks, hardlink aliases, FIFOs,
incorrect metadata and oversized files are rejected. Certificate limit: 512KiB
and 16 certificates; key limit: 16KiB. Reads use one no-follow, nonblocking file
descriptor and compare metadata/length before and after the bounded read.

Preflight checks parsing, key pairing, validity of each supplied certificate,
leaf-not-CA, server EKU when present, SAN hostname/IP (no CN fallback), supplied
chain ordering/signatures and creation of a TLS 1.2-or-newer context. Errors do
not echo PEM/key contents. The non-secret result contains certificate fingerprint,
expiry and origin; no private key/profile secret is part of a review.

A valid pair **does not prove public/client CA trust**, complete trust path,
revocation, DNS routing, renewal, reachability or working Nginx. Local/LAN clients
must explicitly trust their private CA when used. A Cloudflare Origin CA
certificate intended for Cloudflare-to-origin traffic is not a replacement for
a certificate trusted by standalone clients. Do not disable TLS verification.

## Review, generate, validate, then operator apply

Use Node 24+ and verified release source. These are root-only host commands;
the Core APIs used by CUI/Web consumers need neither root nor a host file read.
The environment input must be `root:latex-renderer` mode `0640`, regular,
single-link, no symlink, and at most 128KiB.

```sh
node deploy/scripts/server-ingress.mjs --review /etc/latex-renderer/renderer.env
node deploy/scripts/server-ingress.mjs --check /etc/latex-renderer/renderer.env
node deploy/scripts/server-ingress.mjs --nginx /etc/latex-renderer/renderer.env
```

`--review` emits the complete **non-secret format-3 review** (authentication
review plus ingress), certifying no files or service readiness. `--check` adds
custom TLS checks and assigned-interface checks, but labels the result
`preflight-only`. `--nginx` performs those checks and prints the http-context
configuration to stdout. It does **not** install the file, replace an existing
server, bind sockets, reload Nginx or rewrite the ENV. The legacy format-1 and
auth-only format-2 imports reject new ingress keys instead of silently losing
exposure settings. The format-3 environment map is still only selected non-secret
settings, not a replacement for a full EnvironmentFile.

For operator apply, keep the previous config recoverable, inspect the generated
output, include it **once** in the chosen Nginx http context, and run `nginx -t`
before any reload. Do not retain a competing old wildcard/HTTP vhost for the
same origin; review the complete listener set, not just this generated file.
Check for another service using the port and check OS/firewall exposure.
The config requires `ngx_http_realip_module`. No HTTP redirect listener is
generated. Client-IP ACLs, rate keys and upstream identity use the original
socket peer (`$realip_remote_addr`) even if an enclosing http context rewrites
`$remote_addr`. Forwarded/Cloudflare authentication headers from clients are
cleared; this renderer is for **direct standalone ingress**, not a trusted
forward-proxy/Cloudflare chained deployment.

After explicit operator apply/start:

```sh
node deploy/scripts/server-ingress.mjs --health /etc/latex-renderer/renderer.env
```

This GETs the exact configured HTTPS origin's `/api/v1/health`, using normal
system/client CA trust and explicit certificate verification (even if the caller
disabled it globally), a 5-second total deadline and 16KiB response bound.
Require HTTP 200 and `status: "ok"`; redirects, HTTP fallback, wrong hosts,
untrusted certificates and unavailable upstreams fail. Success proves only
that host's HTTPS health path. Also test from an intended client and a denied
network, confirm all application listeners remain loopback, and run existing
PDF/PNG/SVG/auth/Source acceptance before declaring setup complete. A failed
health check does not automatically revert or alter any configuration.

The existing privileged deployment preflight now checks custom TLS material and
the selected assigned interface
before proceeding; `--profile-plan` remains profile-only. Authentication cutover
also checks the existing custom TLS material/interface before changing methods. Their
authentication plan JSON and existing rollback semantics are unchanged. This
does not apply ingress live or provide an ingress transaction/recovery wizard.

## Tests and remaining scope

Normal tests generate small temporary EC certificates, enforce metadata on
actual file descriptors, and run isolated **non-root Nginx** on random loopback
ports. They validate every existing location/upstream mapping, actual trusted
TLS, forwarded-port preservation, forged-header handling, wrong Host rejection,
port conflicts, unavailable upstreams and LAN ACL denial even with inherited
real-IP rewriting. All temporary configuration, keys and Nginx processes are
removed. No production files/services are touched.

CI installs `nginx-light` in disposable hosted test runners and fails if actual
Nginx is unavailable. Locally the Nginx integration case is explicitly skipped
when no binary exists; the remaining Core/TLS tests still run. Install Nginx
separately if you intend to certify the full local integration suite.

```sh
pnpm exec vitest run tests/server-ingress-review.test.ts \
  tests/server-ingress-tls.test.ts tests/server-ingress-host.test.ts \
  tests/server-ingress-nginx.test.ts --maxWorkers 1
```

No live/root deployment, actual LAN NIC binding, external CA/IdP/Cloudflare,
firewall, certificate renewal or Internet exposure is certified by these fixtures.
Keep issue #52 open until the complete CUI/Web setup, explicit interface selection,
transactional apply/recovery and all relevant live readiness checks are finished.

Reference semantics: [Node 24 X509](https://nodejs.org/docs/latest-v24.x/api/crypto.html#class-x509certificate),
[Nginx geo](https://nginx.org/en/docs/http/ngx_http_geo_module.html) and
[original client address](https://nginx.org/en/docs/http/ngx_http_realip_module.html#var_realip_remote_addr).
