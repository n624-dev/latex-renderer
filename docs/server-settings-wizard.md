# Prepared-host server settings

This is an **existing-host settings frontend**, not a completed fresh-server
installer. The planned fresh-install wizard will also be restricted to prepared
environments: OS packages, service users, Docker, filesystem/quota preparation
are the operator's responsibility. No frontend runs apt, creates system users,
installs Docker or reconfigures disks.

## Existing installation prerequisites

- A verified managed release, compatible recovery unit and active application
  services are already installed. Use a trusted root terminal for launch.
- The installed environment, existing owner and enabled login credentials must
  pass the existing preflight. This frontend never resets an owner or generates
  an API key. Prepare new login methods explicitly before changing policy.
- Existing database/storage/image identity, deployment/public origin and ingress
  remain fixed. A storage migration, image update or TLS/ingress change is not
  converted into a settings change. Cloudflare hosting/Access stays supported.

Choose one frontend and finish there; there is no terminal step midway through
the Web flow:

```sh
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
# Or, instead of CUI:
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
```

CUI prompts for limits and supported native login methods. Web provides the same
limit fields and an advanced **non-secret** format-4 review editor. Bytes are
bytes, seconds are seconds; the installer does not confuse application storage
limits with OS quotas. No secret belongs in the editor. Editing or previewing
does not apply anything. An explicit final confirmation applies the exact
reviewed candidate; changing the draft invalidates its earlier confirmation.
Both frontends call the same state machine and installed privileged transaction.
Existing-host job timeout is limited to 840 seconds to keep worker drain inside
the existing 15-minute service-stop window; the general review model's larger
limit is not permission to extend this deployed service budget.

## Web bootstrap

The process opens an ephemeral **127.0.0.1-only HTTP** port. This is a temporary
bootstrap, not public application HTTP or an HTTPS fallback. Use a same-host
browser or SSH forwarding of the printed port. Never expose it in Nginx,
Cloudflare, a firewall rule or a service unit. Wildcard/LAN bootstrap is not
implemented in this milestone.

The printed fragment contains a private one-use token, valid for at most five
minutes. Treat the terminal output as sensitive. The browser removes the
fragment immediately, exchanges it for memory-only session/CSRF tokens and does
not use localStorage/sessionStorage. Exact socket/Host/Origin checks, request
size/type limits, a fixed action allowlist and eight-attempt bootstrap failure
limit protect the endpoint. Responses are no-store; CSP rejects external
scripts, frames and inline execution. Never copy the URL into a ticket or log.

The session lasts at most 30 minutes, with a ten-minute idle limit. Applying a
review suspends the idle limit, not the absolute limit: a worker may drain for
up to its existing stop budget. Successful apply or explicit close immediately
stops the listener; expiry/signals close it too. Browser disconnection/expiry
does not cancel a durable host transaction. If the response is lost, do not
resubmit blindly: check the transaction and actual service health.

## Apply and recovery

The host adapter accepts no browser-selected path, command or systemd unit. It
invokes only the installed, root-controlled configure-authentication entrypoint
from its verified managed release. Candidate/envelope inputs use exclusive
root:root 0600 files in a root-controlled 0700 directory and are removed after
the operation. A crash can leave a small input file; it is not a download cache
or a secret export, and is not interpreted as permission to resume/apply. The
next launch removes only verified private wizard inputs older than two hours
(the bounded host operation cannot still be using them). Unexpected names,
symlinks, sharing and permissions are not silently erased or repaired.
Recovery uses the durable transaction journal, not a browser session or token.
Ambient credentials and TLS-disable environment switches are not forwarded to
the privileged child. Explicit `NODE_EXTRA_CA_CERTS` trust is preserved only for
a bounded, root-controlled regular CA file under root-controlled directories.

Apply rechecks the full-environment hash, existing secret/owner readiness and
enabled OIDC discovery before stopping the fixed service set. Failures use the
same coordinated recovery described in
[the runtime-settings runbook](authentication-cutover.md#runtime-settings-on-an-existing-host).
DB/session retirement is not rolled back. Errors returned to the frontend have
fixed codes, never raw child stderr, provider bodies or EnvironmentFile content.
Check owner login and a representative render after apply; local UI tests are
not evidence of production acceptance.
The preflight also checks the **loaded** recovery unit's ordering before all
five consumers and the API's recovery dependency. An active historical
authentication-only recovery unit is not treated as a compatible runtime
recovery installation. Install the matching verified release/service units
through the normal deployment path first; the wizard does not rewrite them.

## Initial-provision primitives and remaining scope

`bootstrapInitialOwner` in the auth package is now the shared implementation
used by the existing privileged bootstrap CLI. Password hashing keeps the real
scrypt/password policy. Explicit issuer+subject is required for external
identity; email is metadata, not linking authority. Owner existence is checked
inside an immediate SQLite transaction, including disabled owners. Concurrent
attempts cannot create two owners; user/credential/principal/audit creation is
atomic. This function is not a public admin API or an unauthenticated route.

`ServerSetupSecrets` is a prepared-host primitive for API/password peppers only.
It generates cryptographic 32-byte keys into fixed slots, preserves valid
existing keys and fails on invalid files rather than rotating or chmodding
them. Publication cannot overwrite a concurrent key. Its explicit recovery
method handles only verified temporary names/inodes, under the caller's shared
host mutation lock. It never follows symlinks or recursively deletes files.
No current settings frontend calls it or changes live secrets.
The initial coordinator must establish that no initialized credentials can
reference a missing key before calling generation. A missing key after restore
is a recovery problem, not permission to generate a replacement pepper.

Still required before declaring the full setup work complete: fresh-install
configuration/secret/owner/TLS/service coordination and recovery, secret input
in both frontends, standalone ingress transaction, any explicitly warned LAN
bootstrap option, and prepared-host production/upgrade acceptance. An unsupported
fresh host fails before opening the current existing-host frontend; it is never
reported as successfully installed. Linux fixtures and Chromium mobile layout
tests do not replace Windows or real VPS acceptance.
