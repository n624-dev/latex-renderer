# Akebi LAN HTTPS

Akebi gives a private server an HTTPS name derived from its LAN address. For
example, `192.168.1.50` becomes `https://192-168-1-50.lan.example.org` when the
configured namespace is `lan.example.org`. No installation identifier is added
to this browser URL. RFC1918 IPv4 and ULA IPv6 are supported; public, loopback,
link-local and unspecified addresses are rejected. IPv6 uses all eight groups.

## Choose a deployment

| Deployment                              | Who operates DNS and issuance assistance | TLS private key   |
| --------------------------------------- | ---------------------------------------- | ----------------- |
| Shared authority, local ACME (default)  | Shared operator                          | Installation only |
| Self-hosted authority, local ACME       | Your organization                        | Installation only |
| Optional Keyless compatibility/fallback | Selected authority operator              | Operator only     |
| Existing custom certificate             | Your existing certificate tooling        | Your server       |

Local ACME uses a publicly trusted CA. The authority assists with DNS-01 and,
where required, produces a public-key-bound External Account Binding (EAB).
Reusable EAB HMAC credentials remain on the authority. This is not a private CA
that asks users to install a new root certificate. A private CA can be configured
only after its trust root is deliberately installed on every client/server that
needs to trust it; the software never disables certificate verification. Public CA certificates disclose their
IP-derived hostname and stable management SAN in Certificate Transparency logs.

A valid local certificate starts and serves without contacting the authority.
Renewal is a bounded oneshot task, with durable CA backoff. Keyless is explicitly
opt-in and requires an online authority when a remote signature is needed. There
is no fallback to plaintext authenticated HTTP or an untrusted certificate.

Different networks using the same private address use the same browser origin.
Cookies and browser storage therefore share that origin. Keep application keys
independent, sign out when moving between installations, and use separate browser
profiles where necessary. Akebi does not make a LAN address remotely reachable:
clients must already be on a network that routes to it. Some resolvers filter
private-address DNS responses; configure a narrow exception for your namespace
rather than disabling DNS rebinding protection globally.

## Installation setup

Use a verified release on a prepared Linux host with Node.js 26 LTS, Nginx,
`flock`, the existing application accounts, Docker and systemd. Node.js 24 LTS
remains supported during migration; CI and the release build use 26.13.0. No Go
compiler is needed on the deployed host. The signed release contains checked
amd64 and arm64 native TLS bridge binaries. TeX image support is a separate
policy and is not inferred from these bridge binaries.

In the CUI wizard select `LAN`, or use the Web setup's LAN scope. Choose the
actual private interface/address and allowed private subnets, then the shared or
custom authority, local ACME or Keyless mode, HTTPS port and authentication.
Accept the selected CA's terms explicitly for local issuance. Invitation-only
custom authorities additionally require a code, entered in the secret field.
Application password/OIDC configuration remains mandatory and independent of
certificate issuance.

The Web/CUI review preserves the existing standalone gateway and authentication
routes. Nginx listens only on `127.0.0.1:3180` behind the native TLS bridge; that
backend port must be free and must not be exposed through a router/firewall.
Only the loopback bridge can supply the internal client-address header. The
bridge checks SNI, HTTP Host and allowed private peer networks before forwarding.

The generated client configuration is
`/etc/latex-renderer/lan-https-client.json`. See
[`client.json`](../deploy/lan-https/examples/client.json) for a custom authority
example. Do not copy an example's explicit terms acceptance without reviewing
the CA's terms. The config is root-owned and service-readable, with no group or
world write permission. The state directory is owned by `latex-renderer`, mode
0700; keys and state files use 0600. Never place it in the shared application
storage tree.

The enabled units are:

- `latex-renderer-lan-https.service`: native TLS listener, 64 MiB hard memory cap.
- `latex-renderer-lan-renew.service`: bounded renewal, 192 MiB hard cap and
  ten-minute timeout; exit 75 means a durable retry was scheduled.
- `latex-renderer-lan-renew.timer`: boot and every fifteen minutes, persistent
  calendar timer with jitter. It does not issue a new certificate every time.

Inspect without selecting a new profile or generating keys:

```sh
runuser -u latex-renderer -- /usr/local/bin/node \
  /opt/latex-renderer/current/deploy/lan-https/cli.mjs client status \
  --config /etc/latex-renderer/lan-https-client.json
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Change address, authority, issuer or mode through the reviewed setup workflow.
The installation identity persists. Local TLS keys and pending orders are
separated by configuration profile; the ACME account is reused for addresses on
the same authority. At most three ordinary profiles are retained, with serving
and previous profiles protected; a hard bound stops further changes safely if
protected profiles prevent collection. Four authority groups are supported.
Never delete keys to force renewal or to bypass CA limits.

## Operate your own authority

The authority requires a publicly reachable authoritative DNS endpoint on **both
UDP and TCP port 53**, an HTTPS API and one or more configured ACME issuers.
It does not recursively resolve arbitrary DNS requests. Confirm port conflicts
before binding; the setup does not reconfigure an existing DNS server.
When a local resolver already occupies loopback port 53, bind the authority to
its public IP address instead of `0.0.0.0`; keep the existing resolver running.

Use your own parent domain in place of `example.org`:

| Parent DNS record                         | Value                                               | Purpose                               |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| `ns1.example.org A`                       | Authority public IPv4                               | DNS server address                    |
| `akebi.example.org A`                     | HTTPS proxy public IPv4                             | Control API                           |
| `lan.example.org NS`                      | `ns1.example.org`                                   | Delegate only the LAN namespace       |
| `_acme-challenge.akebi.example.org CNAME` | `_acme-challenge.authority-control.lan.example.org` | Automate the API certificate's DNS-01 |

Publish AAAA records only if the corresponding IPv6 listeners/routes work. DNS
server address records must resolve directly to the server, without an HTTP
proxy. A CDN may front the HTTPS API only if its TLS, request size and timeout
settings preserve the protocol. The API name **must be outside** the LAN
certificate namespace: the shared Keyless wildcard must never authenticate the
control API. Do not delegate a parent zone containing unrelated services.

Provision the dedicated system account `latex-renderer-lan-authority` and private
directories as an explicit administrator action. This is not part of automatic
application user/Docker/OS provisioning:

```sh
useradd --system --home-dir /var/lib/latex-renderer-lan-authority \
  --shell /usr/sbin/nologin latex-renderer-lan-authority
install -d -o latex-renderer-lan-authority -g latex-renderer-lan-authority \
  -m 0700 /var/lib/latex-renderer-lan-authority \
  /var/lib/latex-renderer-lan-authority/keyless
```

Create `/etc/latex-renderer-lan-authority` as root-owned, group
`latex-renderer-lan-authority`, mode 0750. This avoids granting the authority
access to the application's configuration or secrets.

Review [`authority.json`](../deploy/lan-https/examples/authority.json), replace
domains and endpoints, and install it as
`/etc/latex-renderer-lan-authority/authority.json`, root-owned, group
`latex-renderer-lan-authority`, mode 0640. Install the supplied systemd authority
unit and feature-specific journald namespace file. The unit is not enabled by
an ordinary application update. It uses only `CAP_NET_BIND_SERVICE`, a dedicated
192 MiB memory cap and the feature's log namespace. The namespace budget is
100 MiB/7 days; it does not change the host's default journal limits.

For an EAB issuer, store its `{"kid":"...","hmacKey":"..."}` JSON in the
configured `eabFile`, service-owned 0600, beneath a protected configuration
directory. Enter credentials locally in a secure editor or secret manager;
never put them in Git, shell arguments, screenshots, invitation codes or client
configuration. A CA without EAB omits `eabFile`. Endpoints must match the actual
issuer directory; changing an existing issuer's CA URL requires an explicit new
issuer/profile, not silently relabeling its saved account.

Install the public authority code from the already verified, root-owned release
source (replace `VERIFIED_SOURCE` with that extracted source directory):

```sh
/usr/local/bin/node VERIFIED_SOURCE/deploy/lan-https/install-authority.mjs VERIFIED_SOURCE
```

This installs only the authority modules, pure setup-policy modules and this
host's native executable under `/opt/latex-renderer-lan-authority`. A root-owned
current pointer selects an immutable version; one previous version is retained.
Installation recovers interrupted staging and checks ownership, hashes, links
and mount boundaries before collecting code. Private authority/CA state remains
outside this tree. Do not add the dedicated authority user to the application
group: it must not gain access to the application's group-readable secrets.
Application updates refresh an already installed isolated authority code tree;
a separate authority host can run the same installer explicitly from a verified
new release. After each explicit authority upgrade, restart
`latex-renderer-lan-authority.service` and verify DNS, HTTPS metadata and a
representative client before installing another version. Installing code does
not enable services or initialize/erase state.

Initialize once, then start DNS/API locally:

```sh
runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
systemctl enable --now latex-renderer-lan-authority.service
```

The API binds only loopback. Install a reviewed TLS proxy using
[`authority.nginx.conf`](../deploy/lan-https/examples/authority.nginx.conf).
Acquire the API certificate as below before enabling its TLS server block.
Nginx errors go to the host's existing syslog policy; access logging is disabled.
If enabling access logging, configure bounded rotation first.

### Registration policy

Set `policy.registration` to `open` for automatic registration or `invite` to
require administrator-issued invitation codes. This is a server decision; a
client cannot opt out. Shared deployments default to open registration.

```sh
runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

This intentionally outputs a fresh secret code to the administrator's terminal.
Deliver it privately. Only a hash is stored. Requests prove possession of the
installation's Ed25519 key, using short-lived one-use nonces bound to the exact
origin, method, path and body. Replay, revoked identities and cross-installation
challenge deletion are rejected. Capacity/rate limits remain active in open
mode. Dedicated SQLite storage is bounded to 64 MiB, with no permanent WAL,
expired challenge/invitation/nonce cleanup and fail-closed handling of corruption.
Identity/account records are retained within configured registration limits;
reaching capacity rejects new registrations rather than silently deleting owners.

### Operator certificates and automatic DNS-01

Use an existing supported Certbot installation. The authority's local DNS hook
handles only the apex wildcard and the reserved API-control name. Installation
APIs cannot register these operator challenges. No per-IP parent DNS changes or
DNS API token is needed after the delegation is established.

Install a root-only Certbot configuration, for example
`/etc/latex-renderer-lan-authority/certbot.ini` (0600). Configure the chosen CA directory,
EAB credentials if required, an administrator email, `agree-tos = true`,
`key-type = ecdsa` and `elliptic-curve = secp256r1`. Keep the EAB HMAC in that
protected file; do not pass it on the command line. Ordinary Certbot accounts and
lineage state must be backed up with restricted permissions.

Acquire the API certificate using the running authoritative DNS service:

```sh
certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook '/opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-dns-hook.sh present' \
  --manual-cleanup-hook '/opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-dns-hook.sh cleanup' \
  --deploy-hook /opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-api-certificate-hook.sh \
  --cert-name akebi-authority -d akebi.example.org
```

If Keyless is enabled, acquire a **separate**, single-name P-256 wildcard:

```sh
certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook '/opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-dns-hook.sh present' \
  --manual-cleanup-hook '/opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-dns-hook.sh cleanup' \
  --deploy-hook /opt/latex-renderer-lan-authority/current/deploy/lan-https/operator-certificate-hook.sh \
  --cert-name akebi-keyless -d '*.lan.example.org'
```

Enable the existing Certbot renewal timer for these stored lineages; verify its
saved hooks, CA settings and renewal plan. The supplied API deploy hook validates and reloads Nginx only for its named
API lineage. The supplied wildcard deploy hook
copies validated source files through a private temporary directory, atomically
imports a verified bundle, and removes its temporary files. Signer reload occurs
within sixty seconds. DNS continues if the signer has no valid bundle; only
Keyless operations return 503 until it is repaired.

For ZeroSSL, authorize `sectigo.com` in the delegated zone's CAA policy, as
described in [its CAA guidance](https://help.zerossl.com/hc/en-us/articles/360060119753-Invalid-CAA-Records). Add an explicitly selected replacement CA to CAA before switching issuers.

The CA's independent policies still apply. ZeroSSL currently documents free
unlimited 90-day ACME certificates, including wildcard certificates, using EAB;
this is not a guarantee that requests can never be throttled. Account reuse,
retained orders, scheduled renewal, ARI where supported and durable Retry-After
avoid unnecessary issuance. Other configured CAs can be chosen explicitly.
The software does not create throwaway accounts or add random SANs to evade CA
limits. See [ZeroSSL ACME](https://zerossl.com/documentation/acme) and
[Certbot hooks](https://eff-certbot.readthedocs.io/en/stable/using.html#pre-and-post-validation-hooks).

## Failure and recovery

Back up the complete private client state directory, authority database and keys,
configurations, reusable EAB credentials and Certbot account/lineage state. Use
a consistent offline copy or SQLite backup for the authority; do not copy a live
SQLite file blindly. Keep encryption/access controls separate from public source.
Restore to the same service account with 0700 directories and 0600 state files.
Do not print key material during diagnostics.

- A failed renewal retains the published local bundle. The next timer resumes
  the saved order and honors durable backoff, including after reboot.
- A saved key/account/order mismatch is a recovery error. Restore the matching
  backup; deleting metadata to create another account is not a repair.
- An interruption between bundle publication and schedule commit rebuilds the
  schedule from the verified bundle. Private temporary files are bounded and
  collected under the publisher lock.
- IP/provider/issuer changes keep independent profiles. Returning to a retained
  profile reuses its existing key/certificate/order rather than starting over.
- Service restart reloads the last valid bundle; invalid replacements do not
  replace a still-valid in-memory certificate. Expired certificates fail closed.
- Authority corruption disables mutations/TXT validation safely. Stateless
  address DNS continues; restore the dedicated state before renewing.
- Application updates restart active LAN listeners against the signed native
  binary and leave private state outside the release. Recovery quiesces the LAN
  renewer and authority as well as application writers; it restores only units
  that were previously running.
- To revoke an installation, run `authority revoke --installation ID
--confirm-revoke --config ...` as the authority service user. To revoke a local
  certificate use `client revoke --confirm-revoke --config ...`, then stop or
  reconfigure the local bridge before serving again. Revocation is explicit;
  a successful CA revoke call does not erase private keys or stop systemd units.

## Verification boundaries

Normal tests use temporary directories and a local test CA. Native tests cover
actual Node/Go API signing and TLS behavior without public CA credentials.
Release CI validates native amd64/arm64 builds; local compilation alone is not
ARM runtime acceptance. Public DNS delegation, public CA issuance/renewal,
mobile browser trust, external OIDC, cloud proxies and failure injection on an
actual target must be recorded separately. A successful fixture is not evidence
that an operator's domain, firewall or DNS delegation is already configured.

### Explicit key changes

To replace a local TLS key, run `client rotate-tls --config ...` as the client
service account, then start `latex-renderer-lan-renew.service`. This stages one
new key. The old verified bundle keeps serving until a replacement certificate
has passed validation and been atomically published. Restart/renewal recovers an
interruption between publication and local key promotion. Pending orders must
finish before a different TLS key can be staged.

For an existing ACME account, run `client rotate-account --config ...`. The
operation rolls over all saved accounts in the same authority group, retains the
same account URLs, updates retained profiles, and stores one previous key. It
never registers a replacement CA account or requests another EAB. All pending
orders in that authority group must finish first. A lost CA response leaves a
bounded journal: repeat the same command to check the new key against the
existing account and resume, rather than issuing another keyChange blindly.
Ordinary renewal pauses safely while this administrative operation is pending;
valid local TLS serving continues. Back up the complete state before rotating.

### Node LTS migration

A host on an earlier Stable does not need to install an RC first. Keep Node 24
while its historical controller installs the new Stable/RC and completes the
independent Updater cutover. Check the active controller version and health, then
switch the host runtime to Node 26 LTS and restart/recheck the application's
services. New bundles declare support for both 24 and 26; historical bundles
without that declaration are accepted only on 24 by the new verifier. Keep a
verified Node 24 runtime available while retaining recovery points that require
that historical controller. Do not downgrade only the controller while leaving
it on an unsupported runtime. This is separate from application source, data,
TeX Runtime and certificate-state recovery.
