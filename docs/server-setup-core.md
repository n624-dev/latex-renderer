# Server Setup Core: profile foundation

`@latex-renderer/server-setup-core` is the first, deliberately limited shared
layer for the self-host setup work in issues #50–#52. It is separate from
`@latex-renderer/setup-core`, which installs **clients**, not servers.

This milestone provides a pure production-profile parser, a structured review
model and the exact validation used by the privileged deployment preflight.
It does **not** provide a completed wizard or apply configuration.

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

Origin spellings normalize during review, and omitted OIDC algorithms become
the existing default allowlist. Import/review does not rewrite installed files.

## Verification and remaining milestones

### Authentication selection / session foundation (D2a)

Core now also provides `browserAuthenticationFromMode`,
`parseBrowserAuthenticationSelection`, `validateBrowserAuthenticationSelection`
and `isBrowserAuthenticationMethodEnabled`. These are **internal building blocks,
not a supported new host configuration yet**. They read caller-supplied values
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
valid. Disabling one method rejects/revokes its sessions **when used**, without
rejecting the other method. Once revoked, a session does not revive when the
method is re-enabled. Password resets still revoke all of that user's sessions,
including OIDC sessions, under the existing security-version rule. Configuration
apply must additionally retire unused sessions across method changes before
host-level opt-in is enabled; this milestone does not implement that apply step.

External identities continue to require explicit provider/issuer/subject
provisioning. Matching email addresses never link accounts automatically.
Password limits, Origin/CSRF, OIDC signed-token/state/PKCE validation, Cloudflare
JWT verification and its existing legacy identity migration are retained.
Public auth configuration adds backend/method metadata, without exposing
issuer/client secrets/peppers; existing single-mode fields remain compatible.

**Do not replace `AUTH_MODE` in an installed `renderer.env` yet.** The production
preflight and runtime both call `legacyBrowserAuthenticationMode`, which rejects
new backend/method keys before secret reads or provider/DB operations. The legacy
profile parser retains these keys specifically so they cannot be silently
ignored during import. Deployment, bootstrap and reviewed apply integration
remain pending; the rollout gate stays until they and
their end-to-end tests are complete. No service or production setting changes
are part of this foundation.

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

These UI changes **do not enable dual-method host configuration**. The same
runtime/preflight gate remains until deployment/bootstrap and reviewed session
retirement have been integrated. Real Chromium regression tests execute the
compiled browser assets against isolated API fixtures; they do not certify an
external OIDC provider, Cloudflare deployment or production login.

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/server-setup-core.test.ts \
  tests/production-profile-validation.test.ts tests/production-hardening.test.ts \
  tests/ci-standalone-fixture.test.ts
pnpm --filter @latex-renderer/auth... build
pnpm exec vitest run tests/browser-auth-selection.test.ts \
  tests/browser-auth-method-policy.test.ts tests/browser-auth-security.test.ts
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

**Format-2 output is not a deployable host configuration yet.** The runtime and
privileged preflight still reject `AUTH_BACKEND`. The export returns only
non-secret profile keys and is not a complete `renderer.env`; never use it to
replace an installed environment. Runtime/deployment/bootstrap integration and
persistent session retirement remain prerequisites for removing the rollout
gate. Review/migration/owner planning do not read host secrets, contact providers,
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
