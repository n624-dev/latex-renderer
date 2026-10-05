# Server Setup Core: profile foundation

`@latex-renderer/server-setup-core` is the first, deliberately limited shared
layer for the self-host setup work in issues #50–#52. It is separate from
`@latex-renderer/setup-core`, which installs **clients**, not servers.

This milestone provides a pure production-profile parser, a structured review
model and the exact validation used by the privileged deployment preflight.
It does **not** provide a completed wizard. A separate privileged host adapter
can apply a reviewed authentication-only change; see
[the authentication cutover runbook](authentication-cutover.md).
Explicit scope/TLS review, standalone Nginx generation and read-only host
preflight are now connected in one implementation; see
[reviewed standalone HTTPS ingress](standalone-ingress.md). This does not
automatically apply network settings or complete the CUI/Web wizard.

## Existing installations stay unchanged

`deploy/scripts/validate-production-profile.mjs` remains the privileged adapter.
It still checks root execution, environment ownership/mode/size and the existing
Password/OIDC secret-file requirements before deployment can proceed. Only its
pure environment/profile validation delegates to the shared Core.

The validator is available from verified source without compilation, pnpm
dependencies or a network call. The release assembly already includes verified
source before merging generated build outputs. The frozen Updater bootstrap,
signed-release verification and deployment ordering are unchanged.

The format-1 review model explicitly preserves current settings:

- Deployment: `cloudflare` or `standalone`, HTTPS public and renderer origins,
  and the optional admin origin.
- Authentication: `cloudflare-access`, `password` or `oidc`.
- Access: issuer and existing admin/Remote MCP audiences.
- OIDC: issuer, client ID and the asymmetric algorithm allowlist.

It never silently converts the selected authentication method, infers an
installation's network access scope or contacts Cloudflare/OIDC providers.
Standalone does not require Cloudflare credentials. Existing Cloudflare hosting
can still use any currently supported browser authentication method.

## Core API

```js
import {
  importServerSetupProfile,
  validateServerSetupProfile,
  serverSetupProfileEnvironment,
} from "@latex-renderer/server-setup-core";

// Caller supplies contents it is authorized to read; Core reads no host files.
const review = importServerSetupProfile(rendererEnvironmentContents);
const checked = validateServerSetupProfile(JSON.parse(JSON.stringify(review)));
const profileKeys = serverSetupProfileEnvironment(checked);
```

Returned profiles and their nested settings are frozen. The environment map is
a fresh copy, and model validation rejects unknown fields, invalid combinations,
origin drift, insecure URLs and algorithm lists, inherited shapes and accessors.
Input secrets are not reflected in validation errors.

Only the non-secret **profile keys** are returned. Unknown environment settings
are not round-tripped; secrets such as OIDC client secrets, API keys and peppers
are never included in this model. **Do not replace a full `renderer.env` with
this map:** that would discard unrelated renderer/storage/internal settings and
secret references. This API is a validation/review boundary, not a file writer.
Existing legacy duplicate/control-character checks still apply to all lines,
including keys excluded from the review model.

Use `importServerSetupDeploymentReview`, `validateServerSetupDeploymentReview`
and `serverSetupDeploymentReviewEnvironment` for the aggregate format-3 model
that preserves authentication **and** explicit ingress. Format-1 and auth-only
format-2 imports reject ingress keys instead of losing them. Legacy format-3
imports retain `ingress: null` without guessing exposure. The shared
`serverIngressFromEnvironment` / `validateServerIngressReview` checks are also
used by production preflight; active automatic TLS is explicitly not implemented.
Like the existing maps, format-3 export is not a full EnvironmentFile writer.

### Shared readiness and opt-in OIDC Discovery

`reviewServerSetupReadiness(format3Review)` gives CUI/Web consumers the same
non-secret credential-file requirements, initial-owner policy and ingress review
status. It performs no I/O and always reports `readyForApply: false`: validating
a profile does not certify host files, owners, services or a completed installation.
Legacy ingress stays `unreviewed`; planned automatic HTTPS stays explicitly
unsupported. This is not a full storage/renderer/secrets provisioning plan.

The source-only read-only diagnostic needs no root or installed workspace build:

```sh
node deploy/scripts/server-setup-review.mjs < deployment-review.json
node deploy/scripts/server-setup-review.mjs --oidc-check < deployment-review.json
```

Input is the **non-secret format-3 JSON**, not `renderer.env`. Input is limited to
64KiB, and unknown credential fields are rejected. By default the command is
offline. `--oidc-check` explicitly contacts only a configured, enabled native
OIDC provider. Password-only and Cloudflare Access do not contact an OIDC
provider, read stale OIDC settings or use a fallback. No credentials, keys,
owners, configuration or services are created/changed by either command.

`checkServerSetupOidc` and the runtime `OidcClient` use the same Discovery
validation: exact issuer identity, HTTPS endpoints, authorization code,
PKCE S256 and `client_secret_basic` (including its standard omitted-metadata
default). Discovery has a 10-second total deadline and 64KiB response bound;
redirects and invalid responses fail without logging provider bodies or errors.
The diagnostic's default helper transport explicitly verifies CA/hostname trust
even if Node's global TLS check was disabled; private IdPs need an explicitly
configured trusted CA, not an HTTP/TLS bypass. Runtime retains its existing fetch
transport (also used for token/JWKS requests), including explicit test injection;
the helper does not reconfigure it. Injected transports are caller-controlled.
Provider-specific unrelated metadata is not returned. Discovery checks do not
request tokens or JWKS or establish an identity.

Setup success is not used as a login cache: each runtime does its own bounded
Discovery and signed-token/JWKS validation. A failed runtime Discovery remains
retryable; concurrent login starts share only that runtime's successful metadata.
State, nonce, PKCE, issuer/audience, asymmetric algorithms and session checks are
unchanged. Secret/owner provisioning, CUI/Web wizard interaction and transactional
ingress apply/recovery remain unfinished, not implied by this diagnostic.

Protocol reference: [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html).

### Runtime review and coordinated existing-host changes

`importServerSetupReview` / `validateServerSetupReview` use **format 4**:
`{format:4, deployment: <format-3>, runtime: {databasePath, storageRoot,
rendererImage, limits}}`. Older APIs keep their existing format and do not
silently upgrade or discard settings. The runtime model includes an immutable
renderer image identity and 16 API/worker limits: upload/extracted bytes and
file/ZIP counts; output bytes/files/directories; log bytes; SVG objects/per-image
and total bytes; SVG and job timeouts; queue length; per-user storage and minimum
filesystem free bytes. Explicit positive safe integers are required in JSON.
Import uses current runtime defaults only for omitted limit environment keys.
Cross-limit constraints and the worker's 86400-second duration cap are checked.
Bytes are bytes: these settings do **not** establish an OS quota or alter the
separate 15GiB TeX Live mirror budget. Container isolation/CPU/memory settings,
retention/deletion policy and unrelated settings remain unchanged.

`serverSetupReviewEnvironment` is still a non-secret map, not a full-file writer.
Database/storage paths must be canonical absolute paths; mutable image tags,
unknown fields, inherited properties, accessors and inline credentials fail.
`reviewServerSetupReadiness`, `checkServerSetupOidc` and the read-only stdin
diagnostic accept either format 3 or 4. They still never certify apply readiness.

The privileged adapter can export an installed format-4 review and apply a
hash-bound **existing-host** authentication+limits change. It uses the same
exclusive mutation lock, secure full-EnvironmentFile store, private durable
journal and boot recovery as authentication-only changes; see
[the configuration cutover runbook](authentication-cutover.md#runtime-settings-on-an-existing-host).
All five long-lived limit consumers stop before publishing one configuration;
the worker drains last using its existing graceful stop budget. Successful apply
checks all consumers are active, both auth policies, and the actual renderer and
internal API health endpoints. Enabled native OIDC gets a bounded Discovery
preflight; runtime still validates independently. No password/login test is
implied by local health.

This path refuses storage/database migration, managed-image replacement,
deployment/origin or ingress changes. Job timeouts above 840 seconds require a
separate review of the existing 15-minute worker stop budget. Use Image Manager
for managed renderer changes. Network/TLS cutover, initial credential/owner
creation, automatic HTTPS and the interactive CUI/Web wizard remain unfinished;
the existing-host transaction is not a first-install wizard.

Origin spellings normalize during review, and omitted OIDC algorithms become
the existing default allowlist. Import/review does not rewrite installed files.

## Verification and remaining milestones

### Authentication selection / session foundation (D2a)

Core now also provides `browserAuthenticationFromMode`,
`parseBrowserAuthenticationSelection`, `validateBrowserAuthenticationSelection`
and `isBrowserAuthenticationMethodEnabled`. They support explicit host
configuration and read caller-supplied values
and return a detached, frozen, non-secret selection:

```js
{ backend: "cloudflare-access" }
// OR (at least one native method must be enabled)
{
  backend: "native",
  passwordEnabled: true,
  oidcEnabled: true,
  oidcDisplayName: "School Account", // optional presentation text only
}
```

Existing `AUTH_MODE` values map to the same single enabled method; no database
identity, credential or installed environment is migrated by parsing. The
prospective `AUTH_BACKEND` model requires both native flags to be explicitly
`true`/`false`. Legacy and new keys may not be mixed, and Access may not configure
native methods. Unknown model fields, accessors/prototypes, secrets, empty
method selections and unbounded/control-character provider labels are rejected.
Provider labels must be rendered as text, never trusted markup or identity data.

`BrowserAuthenticationService` accepts this validated selection for internal
callers and tests. Password and OIDC can operate together, while each persisted
session still records its actual method. Session use checks that method is
enabled and that identity/issuer, status, security version and expiry remain
valid. Disabling one method rejects/revokes its sessions without rejecting the
other method. Once revoked, a session does not revive when the method is
re-enabled. Password resets still revoke all of that user's sessions, including
OIDC sessions, under the existing security-version rule.

### Durable retirement before serving browser requests

The common environment factory used by Admin API and Remote MCP now calls
`BrowserAuthenticationService.retireIncompatibleSessions()` before returning a
service. It permanently retires **unused as well as used** sessions whose method
is disabled, whose external issuer/provider has changed, or whose identity
provenance no longer matches. The other enabled method's valid sessions remain
unchanged. Session retirement and its count-only, non-secret audit event commit
in one database transaction. Database/audit failure aborts startup, rather than
returning a partially prepared authentication service. Repeated starts with the
same configuration change no rows and add no retirement audit event.

Constructing a service alone does **not** retire sessions: the local CLI also
constructs password-only services for credential hashing. Those helpers must not
change a running installation's authentication policy. Direct service consumers
must explicitly call the retirement method when applying a reviewed policy.
No credentials or external identities are deleted, and no schema migration or
permanent policy history is added. Existing audit-log retention still applies.

Policy cutover requires stopping **all** old Admin/Remote MCP service instances
before starting them with one consistent configuration; this is not a live
reload API. A stale instance could otherwise still create sessions under its
previous configuration. Existing session-use/security-version checks remain in
place. Restart/re-enable and startup failure recovery are tested using disposable
SQLite databases, not the production database. The privileged authentication
adapter coordinates these consumers and journals configuration recovery.

External identities continue to require explicit provider/issuer/subject
provisioning. Matching email addresses never link accounts automatically.
Password limits, Origin/CSRF, OIDC signed-token/state/PKCE validation, Cloudflare
JWT verification and its existing legacy identity migration are retained.
Public auth configuration adds backend/method metadata, without exposing
issuer/client secrets/peppers; existing single-mode fields remain compatible.

Production preflight and runtime accept either legacy `AUTH_MODE` or explicit
`AUTH_BACKEND` with native method flags; they must not be mixed. The format-1
JSON/import API remains legacy-only: use the format-2 review API instead of
silently losing a method or label. Existing installations retain their behavior
on upgrade. Use reviewed cutover, not live file edits, to change installed policy.
Implementing this feature does not change production authentication settings.

### Shared runtime / privileged deployment requirements

`browserAuthenticationRequirements(selection)` is the single pure source for
which native credentials are required and for the approved initial-owner policy.
Password + OIDC requires **both** credentials, chooses Password for bootstrap,
and requests later explicit OIDC issuer/subject registration on that same owner.
It never creates an owner, links matching email addresses or resets credentials.
`serverSetupInitialOwnerPlan` delegates to the same policy.

The runtime environment entry point now uses an internal selection-aware builder.
Enabled methods alone read their credential files; disabled methods do not read
their stale/missing files. Both enabled methods must be constructed successfully
before session retirement. The builder is not exported by the public auth barrel,
and the environment entry point validates selection before any I/O.

`productionAuthenticationPlan(values)` validates the complete production profile
and returns only a frozen non-secret execution plan. The existing format-1
profile API and default privileged validator command
remain compatible. The privileged adapter has these explicit modes:

- `RENDERER_ENV_FILE`: validate environment ownership/mode/size and all enabled
  auth secrets, then print the existing safe success summary.
- `RENDERER_ENV_FILE --profile-plan`: validate the file and complete profile,
  returning JSON **without certifying secret readiness**. Deployment uses this
  before generating a missing Password pepper, so invalid profiles are rejected
  before that mutation.
- `RENDERER_ENV_FILE --plan`: additionally verify every required auth secret,
  returning the same non-secret JSON plan.
- `--plan-field FIELD PLAN_JSON`: read one whitelisted field from a strictly
  checked plan, without reading host files. No arbitrary property, environment
  key or shell `eval` is allowed. All command modes still require root.

Deploy, bootstrap-owner and configure-host-access consume these checked plans,
not raw `sed` extraction of `AUTH_MODE`. Deployment compares the initial and
secret-verified method plans before proceeding. This is not a whole-file lock or
a live configuration apply mechanism; do not edit configuration during deployment.
The auth-secret preflight uses independent enabled-method checks rather than an
exclusive `else if`, preserving root/group/mode/size and OIDC trimmed-length checks.
Owner-count queries are read-only; query failure, empty/non-numeric results or
multiple owners fail closed without invoking bootstrap. One existing owner
retains its credentials. No filesystem/provider/production configuration was
changed to implement this adapter integration.

Tests use disposable actual credential files and SQLite for the internal builder,
synthetic file metadata for the privileged secret preflight, and non-privileged
shell harnesses for owner-count failure branches. They do **not** certify an
actual root deployment, external IdP or Cloudflare service. Authentication
transaction tests include actual temporary files, injected service failures and
SIGKILL/reopened-store recovery. CUI/Web server setup, ingress and owner creation
through the shared wizard remain separate unfinished milestones.

### Method-aware browser UI (D2b, UI portion)

Login and administrator user controls now read the public `/auth/config`
capabilities, not the method used by the current session. Only enabled methods
are added to the login DOM after configuration has been validated. Native
Password/OIDC combinations show both choices; Cloudflare Access retains its
existing session endpoint. Legacy configuration responses remain compatible.
Unknown, malformed or partial configurations fail visibly instead of falling
back to Cloudflare Access. Provider display names are rendered as plain text.

Administrator user creation offers an explicit method choice when both native
methods are enabled. Switching methods removes the previous credential inputs;
only the selected authentication payload is sent, with existing CSRF checks.
Owner-only password reset controls depend on Password being enabled, even when
the owner signed in with OIDC. Users with both links show both in the list.
Server-side role, provisioning and authentication checks remain authoritative.
Email addresses still never auto-link identities.

These UI changes are connected to dual-method runtime/preflight and the reviewed
host adapter. Real Chromium regression tests execute the
compiled browser assets against isolated API fixtures; they do not certify an
external OIDC provider, Cloudflare deployment or production login.

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/server-setup-core.test.ts \
  tests/production-profile-validation.test.ts tests/production-hardening.test.ts \
  tests/ci-standalone-fixture.test.ts
pnpm --filter @latex-renderer/auth... build
pnpm exec vitest run tests/browser-auth-selection.test.ts \
  tests/browser-auth-method-policy.test.ts tests/browser-auth-security.test.ts \
  tests/browser-session-retirement.test.ts
pnpm check
pnpm test:browser
```

### Explicit format-2 authentication review and initial owner policy

The next pure review boundary adds `importServerSetupAuthenticationReview`,
`validateServerSetupAuthenticationReview`,
`serverSetupAuthenticationReviewEnvironment` and
`migrateServerSetupAuthenticationReview`. Existing format-1 APIs and their
validation/deployment behavior stay unchanged; no installed file is migrated
on import. The separately named format-2 APIs can review Access, Password,
OIDC or native Password + OIDC. Every enabled method must satisfy the existing
production URL, origin, issuer/client, audience and asymmetric-algorithm checks.
The review is detached and frozen and contains no passwords, peppers, client
secrets or their file paths.

```js
import {
  importServerSetupAuthenticationReview,
  migrateServerSetupAuthenticationReview,
  serverSetupInitialOwnerPlan,
} from "@latex-renderer/server-setup-core";

const review = importServerSetupAuthenticationReview(environmentContents);
// Explicit conversion of an existing validated format-1 JSON profile:
const migratedReview = migrateServerSetupAuthenticationReview(existingProfile);
const ownerPlan = serverSetupInitialOwnerPlan(review);
```

Format 2 keeps the existing deployment model. Its authentication field is
either the Access backend and its existing issuer/audiences, or:

```js
{
  backend: "native",
  passwordEnabled: true,
  oidcEnabled: true,
  oidc: {
    issuer: "https://identity.example.test/tenant",
    clientId: "renderer-client",
    allowedAlgorithms: ["RS256", "ES256"],
    displayName: "School Account", // optional, presentation only
  },
}
```

OIDC metadata is required exactly when OIDC is enabled. During environment
import, unused provider remnants are excluded rather than made mandatory for
the active backend; secret-free JSON reviews reject extraneous settings. Legacy
single-method imports map to that same single method, never enable an additional
one, and do not invent Cloudflare dependencies for native authentication.

For Password + OIDC, the approved owner plan is
`{ bootstrapMethod: "password", followUpOidcRegistration: true }`: create the
initial owner using Password, then explicitly register the OIDC issuer/subject
for that same owner. Email matching never links accounts. Password-only plans
Password bootstrap without follow-up; OIDC-only and Access retain external
identity bootstrap. This function **only returns the policy**, not credentials,
owner creation, provider discovery or a completed CUI/Web setup.

Runtime and privileged preflight accept format-2 authentication. The export returns only
non-secret profile keys and is not a complete `renderer.env`; never use it to
replace an installed environment; use the reviewed host adapter to merge changes.
Review/migration/owner planning do not read host secrets, contact providers,
write files or mutate a database.

```sh
pnpm exec vitest run tests/server-authentication-review.test.ts \
  tests/server-setup-core.test.ts tests/production-profile-validation.test.ts
```

Tests cover every current deployment/authentication combination, normalized
review round-trips, secret exclusion, unchanged validator identity, malformed
models and copied verified-source operation without workspace dependencies.
They do not certify a completed setup or actual ingress/TLS operation.

Remaining work proceeds in separate review/release boundaries:

1. Finish native Password/OIDC host configuration, method-aware login/admin UI,
   bootstrap/deployment and session retirement on apply (#51), using the D2a
   selection/session foundation with predictable migration from legacy profiles.
2. Explicit access scope and HTTPS provider configuration, including custom
   certificate validation and fail-closed unsupported automatic HTTPS (#52).
3. Shared secret generation, owner creation, environment/service planning,
   reviewed apply, health checks and recovery (#50).
4. Equivalent CUI and temporary Web-bootstrap adapters over those capabilities,
   including one-time frontend choice and bootstrap security (#50).

Until these milestones are implemented, format 1 rejects dual-method settings
instead of claiming they work. No new setup command, host changes, certificate
issuance, partition/quota changes or automatic deployment are introduced here.
