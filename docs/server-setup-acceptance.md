# Disposable prepared-host acceptance

This is a privileged integration procedure, **not part of ordinary tests**.
Do not run it on the production VPS or reuse real secrets/owners/backups.
Record exact release commit, OS/Node/Docker versions and observed outcomes.
Linux fixtures and source/unit contract tests are not substitutes for this run.

1. Prepare a disposable host using the documented OS/account/rootless-Docker
   prerequisites. Preparation is outside the wizard. Install normal Updater
   verification tools and operator-selected CA trust. Do not add production
   Cloudflare credentials. A standalone local HTTPS origin is sufficient.
2. Independently verify a published versioned release's checksum, attestation,
   exact commit and server/Updater metadata using the normal release-verification
   procedure. Stage its sealed built tree under `/opt/latex-renderer/releases/`
   and nominate `/opt/latex-renderer/current`. It must include compiled DB/auth
   packages, `.latex-renderer-release.json`, `.latex-renderer-updater.json` and
   the frozen bootstrap. An arbitrary Git checkout is not a trusted release.
3. Prepare one small validated immutable renderer Runtime in the worker's
   rootless Docker. Use fixture owner credentials and a valid fixture certificate
   for an HTTPS hostname trusted by the **server** health-check client. Do not
   disable TLS verification; a self-signed fixture must have explicit trust.
4. Launch `server-setup.mjs --cui --initial`. Cancel before APPLY: no owner,
   renderer.env, credentials or active consumer should exist; application-only
   staged directories/units may remain. Repeat using `--web --initial` over SSH
   forwarding, and cancel again. No terminal handoff or browser persistence.
5. Complete initial install in one chosen frontend. Check configuration/secret
   ownership/modes, actual owner login, management APIs, immutable image identity,
   representative PDF/PNG render and service/timer enablement. Verify other
   co-hosted Nginx/TeX paths are unchanged. Confirm journal is removed only after
   successful health checks and persistent activation.
6. In independent clean fixture hosts, test Password-only, OIDC-only, dual native
   and existing Cloudflare Access. Use a test IdP with real issuer/subject and
   discovery; disabled methods must fail. Dual initial owner uses Password;
   register OIDC explicitly later, never by matching email. Real Cloudflare test
   is optional/separate and requires operator-provided test connector/identity.
7. Exercise `--existing` and `--ingress`, including mobile Web. Reject stale
   review, bad certificate/key, wrong hostname, unknown account, missing immutable
   image, unavailable OIDC and incompatible recovery ordering before stopping
   consumers. Managed ingress does not migrate legacy shared Nginx implicitly.
8. Simulate crashes **only on disposable hosts**: stop the wizard process before
   owner creation, after SQLite owner commit, during file publication and after
   health commit before journal cleanup. Capture phase without publishing secret
   contents. Relaunch the same frontend and recover. Repeat after reboot. No DB
   or key deletion/reset is allowed. Before-owner boot stays failed/stopped until
   credentials are resubmitted; after-owner boot retains pending-health journal
   until explicit foreground recovery succeeds.
9. Simulate ENOSPC in an isolated bounded fixture filesystem (not the production
   filesystem), or use file-store fault injection in ordinary tests. Failed
   publication must retain recoverable state; unrelated existing configuration
   must not be overwritten. For failed managed HTTPS apply, prove old HTTPS and
   active services are restored, including a second failure during rollback.
10. Perform a normal verified versioned Updater upgrade and restoration on this
    fixture installation. Confirm auth credentials, data, independent Updater,
    secret identities, dedicated HTTPS, services and timers survive. Run Windows
    and macOS interactive-client acceptance separately on their actual platforms.

The repository's ordinary gates include actual SQLite owner bootstrap,
transaction interruption/ENOSPC fault injection, file-link boundaries, CUI/Web
session checks and real Chromium flows with shipped mobile login/Admin CSS.
They never invoke privileged initial preparation or write production paths.
Any step not actually executed must be recorded as **unverified**, not passed.
