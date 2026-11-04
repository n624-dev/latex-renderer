# LAN HTTPS integration

Status: in development. The released setup does not yet activate Akebi or the
local ACME provider. This document describes the implementation boundary for
issues #48 and #49; it is not an installation guide for a released feature.

## Address-derived URLs

An installation's browser URL is derived from its selected private address and
the authority's LAN domain. For example, `192.168.1.50` and `lan.example.net`
produce `https://192-168-1-50.lan.example.net`. No installation identifier is
inserted into the browser hostname. Custom authorities supply their own domain
and API origin.

IPv6 ULA names use eight four-digit lowercase hexadecimal groups separated by
hyphens. This encoding also represents addresses ending in `::` without an
invalid trailing hyphen. Public, loopback, link-local, multicast, IPv4-mapped
IPv6 and scoped addresses are excluded from this LAN provider. Existing custom
certificate deployments retain their existing address rules.

Installations on different networks can have the same browser origin. Separate
TLS keys and certificates do not separate their browser cookies or storage.
Session validation must remain installation-specific, and this behavior must be
documented when selecting the provider.

## Registration and the authority

An authority chooses either `open` automatic registration or `invite`
registration. This is server policy; a client cannot change it. Invitations have
bounded lifetime and use counts and are stored as digests. Administrative invite
creation and installation revocation have no public HTTP routes.

An installation persists an Ed25519 identity key before registering. A public
identity is the SHA-256 digest of its canonical public JWK. Requests use a
server-issued, short-lived nonce and a domain-separated signature over the
authority's exact HTTPS origin, POST method, exact API path, nonce and body
digest. The authority consumes the nonce in the same SQLite transaction as the
successful mutation. A failed mutation is rolled back; the unexpired nonce may
be used for a corrected, freshly signed request.

The authority database is separate from application data. Registrations,
nonces, invitations and challenges have explicit count limits. SQLite has a
64 MiB page limit, a bounded cache and no growing WAL. Unsupported, corrupt or
foreign database state is not reset or treated as empty.

## ACME account binding

The authority retains the CA's reusable EAB HMAC credential. For an enrolled
installation it returns an RFC 8555 external account binding over one P-256
ACME public key and the configured CA's `newAccount` endpoint. The installation
does not receive the HMAC credential and cannot substitute an arbitrary signing
payload or endpoint. The binding's KID is public protocol metadata, not a secret.

The installation owns and persists its ACME account private key and its
independent TLS private key. It submits the bound public account key to the CA
using its own ACME account signature. The authority currently permits one bound
account key per installation and issuer, with at most four issuers. Account-key
rotation/recovery requires an explicit protocol and is not implemented by
silently registering new identities.

ZeroSSL ACME is the initial provider under evaluation. Its published ACME
offering is separate from the dashboard/REST API certificate quotas. The
authority must still apply abuse controls and bounded issuance concurrency;
external service availability and unrestricted issuance are not guaranteed.
An alternative CA can be configured and tested independently. An increased
Let's Encrypt allowance is not a prerequisite for this design.

The client requires explicit CA terms acceptance. No account registration or
real certificate issuance happens merely by importing these modules or
reviewing a provider configuration.

## DNS

The parent domain can remain with its existing DNS provider. Its LAN subdomain
is delegated to an authoritative server. LAN browser traffic goes directly to
the selected LAN host.

Normal A/AAAA answers are derived from the name without reading registration
or challenge state. DNS-01 TXT records are authorized for canonical private IP
names and the requesting installation's independent management name.
Concurrent installations retain separate challenge records, even when they
need the same name or TXT value. Deleting one record cannot remove another
installation's challenge. Repeated presentation does not extend an existing
record's lifetime indefinitely.

The DNS responder supports UDP and TCP, returns proper authoritative negative
answers, refuses recursion and ANY amplification, rejects malformed/compressed
question names, bounds replies, and truncates only at complete record boundaries.
State failures yield SERVFAIL for TXT, not a fabricated empty answer. Socket
listeners bound source counts, requests and TCP connections.

## Issuance and state publication

The ACME implementation uses a pinned standard client with bounded HTTP
responses, request deadlines, no redirects and a bounded set of HTTPS CA
origins. DNS-01 authorizations are processed sequentially and verified before
asking the CA to complete them. No HTTP-01 listener or insecure fallback is
started. A newly registered account is saved before placing orders. Pending orders and
CSRs are saved before challenge presentation, bound to the configured names,
issuer, account and local public keys. On restart, the client refreshes the same
order with POST-as-GET. An already processing or completed order is downloaded
without duplicate finalization. Once the order URL is persisted, an uncertain network result does not discard
the order or trigger a replacement. A response lost during the original order
creation is an unresolved boundary: the CA may have created an order before
returning its URL. Backoff bounds subsequent attempts; this does not establish
exactly-once remote order creation. The journal is cleared after verified
certificate publication or after an explicitly checked terminal order state.

The certificate request covers the exact browser hostname and a separate
management SAN. Management names do not alter the browser URL. Returned
certificates must match the expected names, persisted private key and validity
period. A bounded local TLS handshake exercises the platform's certificate path
and name-constraint checks before publication.

Installation state lives in a canonical, private directory with mode `0700`;
secret files have mode `0600`. Reads check the same opened descriptor and reject
symlinks, extra hardlinks, unsafe ownership/modes and size changes. Replacements
use a bounded temporary file, file sync, atomic rename and directory sync. One
previous bundle is retained. Missing referenced keys and invalid metadata stop
the operation instead of automatically re-registering.

A service or CLI must hold one shared OS flock throughout enrollment/renewal
and temporary-file recovery. Recovering abandoned writes uses that lock, not
mtime/PID guesses, and removes only validated, service-owned temporary files in
bounded batches. The certificate agent takes this lock around enrollment, renewal and recovery.
It stores one renewal schedule and one pending order. Retry timing survives
restarts, with exponential backoff, bounded jitter and longer CA Retry-After
instructions. An invocation records a recovery delay before network work, so
repeated process crashes do not cause immediate issuance loops. A valid existing
bundle stays available after renewal failure. Scheduling an attempt never
publishes an unverified certificate. Service and updater integration remains
pending.

## TLS boundary

The Go standard-library bridge validates local bundles before installing them
in memory. Fresh TLS 1.2/1.3 handshakes use a valid local certificate without
reading files or contacting an authority. Reload failures retain the last
verified bundle until expiry. Strict SNI checks prevent using this listener for
another host. An explicit Keyless callback is considered only when no usable
local certificate exists. The callback transport and operator signer service
are still being integrated.

Keyless uses an ECDSA P-256 `crypto.Signer` over the supplied SHA-256 transcript
digest. It does not hash that digest again. Each returned signature is checked
against the certificate public key. The fallback certificate chain uses ordinary
CA trust and hostname verification. No shared private TLS key is installed on
the client. Concurrent fallback retrieval is bounded.

The bridge accepts only explicit private/loopback peer networks and forwards to
a numeric loopback HTTP origin. It rejects plaintext requests, mismatched Host
and unapproved peers; it replaces untrusted forwarding headers while retaining
application authentication. The existing Nginx routing template supplies a
separate loopback backend on port 3180, with explicit trust of the bridge's
peer header. Existing custom-TLS ingress continues to use original socket peers.
The backend cannot replace public HTTPS or become an HTTP fallback. Setup must
check the reserved backend port before activating this topology.

The ordinary Linux amd64 and native arm64 CI jobs run Go tests with the race
detector. Go dependency caching is disabled. The module has no external Go
packages. This is not yet a shipped binary or an activated setup provider.

## Remaining integration and acceptance

- Integrate the local-first TLS manager, peer-restricted proxy and loopback
  backend into a shipped executable with live bundle reload and authenticated
  Keyless transport.
- Add the operator Keyless signer, private configuration loading, isolated
  service/timer units and HTTPS ingress configuration.
- Integrate periodic ARI refresh and account-key rotation/recovery. The agent
  persists the initial renewal plan and retry/backoff; continuous ARI refresh
  and lifecycle service integration remain pending.
- Connect setup CUI/Web, interface selection, terms acceptance, status,
  diagnostics, update and recovery.
- Verify the signed release and native amd64/arm64 host paths.
- Validate actual CA issuance, multiple independent keys for the same name,
  DNS delegation, fresh TLS handshakes, outages, and desktop/phone trust.

Fixtures and loopback communication tests do not replace these acceptance
checks. Existing Cloudflare/custom-certificate deployments are not migrated by
this work's data-review modules.

## Developer checks

The ordinary CI discovers `tests/lan-https-*.test.ts` through the existing unit
test configuration on amd64 and native arm64. For a low-memory local machine,
run the component tests serially and use the scoped typed lint configuration:

```sh
NODE_OPTIONS=--max-old-space-size=384 pnpm exec vitest run tests/lan-https-*.test.ts --maxWorkers=1 --no-file-parallelism
NODE_OPTIONS=--max-old-space-size=384 pnpm exec eslint --config deploy/ci/lint-lan-https.config.mjs deploy/lan-https packages/server-setup-core/src/lan-https.mjs 'tests/lan-https-*.test.ts' tests/fixtures/lan-https.ts
```

References: [ACME external account binding](https://www.rfc-editor.org/rfc/rfc8555.html#section-7.3.4),
[ZeroSSL ACME](https://zerossl.com/documentation/acme),
[Let's Encrypt rate limits and ARI](https://letsencrypt.org/docs/rate-limits/),
[Cloudflare subdomain delegation](https://developers.cloudflare.com/dns/manage-dns-records/how-to/subdomains-outside-cloudflare/).
