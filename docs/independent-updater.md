# Independent Updater: implementation status

This work separates application updates from the lifetime of the application
itself. It is not yet ready to release or install. The running host is unchanged.

## Trust boundary implemented

Production still accepts only published, immutable GitHub releases from
`n624-dev/latex-renderer`. Both the unprivileged controller and root helper
independently verify the archive. Their common attestation policy pins the
publisher workflow, tag, **source commit**, SLSA predicate and GitHub-hosted signer.
The legacy bootstrap's control-file comparison includes the new policy module.

`deploy/scripts/ci-release-artifact.mjs` is a separate, read-only CI entry for
unpublished server artifacts. It requires an explicit SHA-256 and commit, verifies
the same signature policy, checks bounded archive structure and release metadata,
and does not deploy or grant production permission to accept Draft releases.
Its unit tests mock signature verification; they are not evidence of a real
Sigstore verification or host update.

The release-only workflow runs this gate after attestation and before draft
upload. It checks the saved checksum list immediately before upload; no rebuild
is allowed between verification and upload. RC and stable use the same gate.
Existing stable promotion, renderer identity, Base publication and validation
rules remain in force. No Actions cache or production credential is added.

## Remaining work before the next RC

1. Introduce a root-owned, versioned Updater installation with an atomic active
   pointer independent of `/opt/latex-renderer/current`. Keep its bootstrap
   protocol small and explicitly versioned; reject unsupported protocols.
2. Recover safely from interrupted Updater activation. Preserve the previous
   runnable Updater and fail closed for unsupported application/database schemas;
   do not claim a database migration is automatically reversible.
3. Provision a disposable standalone/password/TLS validation host with no
   production data, credentials or Cloudflare configuration. Install the previous
   immutable RC and exercise the separately authenticated migration entry.
4. Feed the pinned, signed candidate to the shared post-verification deployment
   path, then exercise service restart, persisted data, PDF/PNG rendering and
   failure recovery. Make this release-only E2E a required gate before uploading
   the exact tested artifacts. The current read-only gate is **not this E2E**.
5. After publication, test the real old-Updater-to-new-RC production entry.
   A prepublication test cannot establish that the old Updater accepts a Draft;
   it deliberately does not. One RC can cover the transition, but these two entry
   paths need separate evidence.

No service path, sudo permission, live deployment, RC tag or release is changed
by this initial trust-boundary patch.

## Local verification of this first stage

On 2026-09-09, all 101 Vitest files / 636 tests passed, TypeScript checking
passed, changed JavaScript/TypeScript files passed ESLint, and the public docs
check passed (13 pages). The saved, published RC.5 server artifact also passed
the real GitHub attestation verifier with its exact source commit. Verification
with a different source commit was rejected. No release workflow or disposable
host E2E was run, and no production service was restarted.
