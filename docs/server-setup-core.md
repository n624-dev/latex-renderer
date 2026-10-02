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

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/server-setup-core.test.ts \
  tests/production-profile-validation.test.ts tests/production-hardening.test.ts \
  tests/ci-standalone-fixture.test.ts
pnpm check
```

Tests cover every current deployment/authentication combination, normalized
review round-trips, secret exclusion, unchanged validator identity, malformed
models and copied verified-source operation without workspace dependencies.
They do not certify a completed setup or actual ingress/TLS operation.

Remaining work proceeds in separate review/release boundaries:

1. Native Password/OIDC method selection and provenance-aware sessions (#51),
   with predictable migration from the current single-method profile.
2. Explicit access scope and HTTPS provider configuration, including custom
   certificate validation and fail-closed unsupported automatic HTTPS (#52).
3. Shared secret generation, owner creation, environment/service planning,
   reviewed apply, health checks and recovery (#50).
4. Equivalent CUI and temporary Web-bootstrap adapters over those capabilities,
   including one-time frontend choice and bootstrap security (#50).

Until these milestones are implemented, format 1 rejects dual-method settings
instead of claiming they work. No new setup command, host changes, certificate
issuance, partition/quota changes or automatic deployment are introduced here.
