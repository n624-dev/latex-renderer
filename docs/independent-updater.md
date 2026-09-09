# Independent Updater and release upgrade E2E

This candidate separates the application and Updater lifetimes. No production
deployment has been performed as part of this implementation.

## Layout and authority

The application continues to use /opt/latex-renderer/current. Separately,
/opt/latex-renderer/updater contains bootstrap-v1 (frozen root-owned modules),
slots/<sha256> (immutable controller/helper files), state.json (atomic activation
journal), and controller-state-backup.json (root-only controller recovery data).

The controller still runs as latex-renderer-update. Its only sudo permission is
the fixed argument-free helper. Entry points verify slot hashes/ownership and
never load executable code through the application current pointer. Node.js 24
is required. Slots contain no database, credentials or application dependencies.
Collection retains active, previous and prepared candidate slots (normally two,
at most three) and reclaims interrupted staging. Identical payload/envelope data
reuse a slot. Corrupt state, unsafe paths, symlinks or mount points stop cleanup.
Application/TeX/GHCR retention is unrelated to this collection.

## Normal application update

Use the existing authenticated update operation for a published immutable
release. Controller and root helper independently verify archive digest,
publisher workflow, tag, source commit and Sigstore provenance. Renderer identity,
encrypted backup and production validation remain mandatory.

The initial migration captures the installed old controller into a sealed slot
before changing service paths. The new controller is staged separately. A
delayed systemd service activates it after application deployment succeeds and
the original operation releases the mutation lock. Busy/failed activation is
retried at most three times, 30 seconds apart. Application operation success and
Updater activation success are distinct: inspect both results.

Activation stops the old controller, backs up its bounded state JSON as its
non-root owner, journals the switch, starts the candidate, and checks its process
directory plus authenticated socket. Only successful health checks commit it.
Failure restores the previous controller and its state. A boot oneshot recovers
uncommitted switches before Update/Image Managers start.

Application DB/storage are NEVER restored by Updater recovery. Automatic
application rollback requires explicit compatibility in the active release;
rollback into pre-independent-Updater layouts is refused.

## Upgrade only the Updater

After this layout is installed, an administrator can update the Updater before
asking it to handle a breaking application/database release:

    sudo /usr/local/bin/node /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs status
    sudo /usr/local/bin/node /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade VERSION

Replace VERSION with an explicit published version (optional v prefix). This
does not deploy/migrate the application. It verifies the immutable server
artifact, then uses only .latex-renderer-updater.json and declared Updater files;
application manifest/DB format is not the bootstrap contract. There is no URL
override, Draft flag or verification-disable option. Downloads are temporary;
interrupted bootstrap downloads are collected under the shared lock on activation or
the next bootstrap mutation. Upgrade requires 4 GiB free for its bounded peak.

The schema-1 envelope pins version, commit, Node major and each file's size/hash.
deploy/updater-files.json may change internal modules without changing this
protocol. At most 64 files of 4 MiB each are accepted within allowed package/
script paths. Bootstrap protocol or Node-major changes require an explicit,
tested bootstrap/OS migration. Installation refuses to silently overwrite a
different frozen bootstrap-v1 implementation.

Protocol 1 also fixes the controller/helper entry filenames, authenticated
/v1/state health endpoint, and the bounded controller state.json recovery file.
Keep compatibility with the old application's management API during migration.
Incompatible new mutable Updater stores need their own transactional migration
or a bootstrap protocol upgrade; restoring this JSON is not a general database
rollback mechanism.

## Recovery

Application deployment logs identify validation checkpoints with
`Deployment check: NAME`. A failing command records
`Deployment failed: step=NAME exit=CODE` before temporary-file cleanup and local
service recovery. INT/TERM/HUP are failures (130/143/129), not successful exits.
The post-MCPB installer, downloads, client install/doctor/uninstall, local pages,
health and rendering checks have separate names. Do not enable shell tracing or
dump temporary client JSON to diagnose a failure: it may contain credentials.

Small HTTP checks and installer-script downloads require a complete HTTP 200
response, with 10-second connection / 30-second total timeouts and a 4 MiB body
limit per request. Redirects and partial transfers are rejected even if their
body contains the expected text. Diagnostic output includes only the static
check name, curl exit code, HTTP status or a missing-content reason, not the URL
or body. The existing public-status check still retries at most ten times with
two-second intervals; client installation and other mutations are not retried.
Archive signature/checksum checks and real rendering validation are unchanged.

These diagnostics do not retroactively identify failures from older releases.
If an application operation failed after cutover, separately inspect the active
application, services and Updater status; a working application does not turn
the recorded failed operation into a successful one. Do not edit operation
history, automatically activate a candidate, or bypass validation to clear it.

Inspect latex-renderer-updater-activate.service and its journal before retrying.
The status command shows current/previous/candidate IDs and any pending switch.
Do not edit the journal, delete protected slots, or remove a busy lock file.

For a known interrupted activation outside boot recovery, stop the controller,
run the bootstrap with recover, then start the controller. For a prepared
candidate with no pending transition, start latex-renderer-updater-activate.service
after the previous operation finishes. Unknown/corrupt state requires restoring
verified control state under administrator supervision. A failed application
database migration needs that release's recovery procedure and encrypted backup,
not merely an old code symlink.

## Release-only CI

On a fresh sudo installation, the helper uses the invoking non-root account
until `prepare-host.sh` persists `UPDATE_DEPLOY_USER`. An explicit or persisted
account still takes precedence. CI therefore builds and deploys as `runner`,
without assuming that an `ubuntu` account or its pnpm installation exists.

The recovery dependency verifies a clean committed Updater slot read-only.
It does not reacquire the application deployment lock unless an interrupted
activation journal exists. Pending recovery still acquires the shared lock,
rechecks state, restores controller data, and collects unused slots before
the service starts. A corrupt state or committed slot remains a hard failure.

The shared lock helper waits on a pipe owned by its caller, not an independent
infinite sleep. If a manual bootstrap is terminated (including SIGKILL), EOF
releases its kernel lock without relying on JavaScript cleanup or a VPS reboot.

server-release runs on explicit RC/stable release dispatch, not ordinary PRs:

1. Build/attest once and transfer by an immutable Actions artifact ID retained
   for three days. This is not an Actions build cache.
2. In a separate GitHub-hosted runner with read-only repository/attestation
   permissions, provision standalone/password/TLS. Portable signature bundles
   are transferred with the artifacts, so root verification requires no GitHub
   login or token. No production secrets,
   Cloudflare credentials or mirror leases are provided. Provisioning refuses
   an existing installation and records a sealed run/boot marker; the CI
   deployment entry also checks this marker.
   The Ubuntu 24.04 amd64 CI host registers the [official Docker APT repository](https://docs.docker.com/engine/install/ubuntu/)
   with a dedicated `Signed-By` keyring and refreshes package indexes before
   installing `docker-ce-rootless-extras`. Runner images need not retain that
   repository even when Docker is preinstalled. This setup is CI-only; the
   production installer and this VPS's APT configuration are not changed.
   The fixture uses `latex-renderer-ci.test` consistently in `/etc/hosts`, TLS
   certificate identity, proxy headers and application origins. It validates the
   generated environment with the normal production-profile validator before
   package installation; example placeholders are never exempted for CI.
   Before service-account sessions start, the disposable host removes per-user
   XDG/Docker assignments from `/etc/environment` and its provisioning process.
   This is CI-only: [hosted image defaults](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-environment.sh)
   can otherwise direct other users into runner directories through PAM.
   Both new production deployments and CI use `configure-rootless-docker.sh`,
   which sets the worker's XDG/Docker directories after `runuser`, clears caller
   Docker endpoint/context overrides and checks the actual worker daemon reports
   rootless mode. [Docker's installer](https://github.com/moby/moby/blob/master/contrib/dockerd-rootless-setuptool.sh)
   uses `XDG_CONFIG_HOME` ahead of `HOME`; changing `HOME` alone is insufficient.
   CI performs this setup before deploying the immutable RC.5 baseline, whose
   original driver then reuses the prepared Docker service. The signed baseline
   source and this VPS's environment/services are not modified.
3. Install the frozen previous signed immutable RC, create an owner and persistent
   storage data, and render English/Japanese PDF/PNG. Apply the signed candidate
   through the same sealed-assembly deployment function used by production.
   Verify data/rendering and independent Updater activation; exercise intentional
   startup failure and interrupted activation recovery. Failure blocks upload.
4. The publishing job downloads the SAME artifact ID, rechecks checksums and
   source-pinned attestations, then uploads those exact bytes to Draft without
   rebuilding. Existing stable promotion and Base-only GHCR policy are unchanged.

The historical baseline is explicit in deploy/ci/update-e2e.mjs; review it when
changing the migration floor and never rewrite it during RC-to-stable promotion.
On the disposable CI host, a runtime-only systemd condition skips automatic
activation while the CI host marker exists. E2E invokes the unchanged bootstrap
synchronously, retaining its normal mutation lock, so delayed cutover jobs cannot
race negative fixtures. Startup-failure recovery requires a per-attempt marker
written by the broken controller in its actual slot, the expected health failure,
and fully restored current/previous state with no candidate or pending journal.
A lock conflict is not evidence of recovery. Production units are unchanged.
The standalone driver verifies downloads against `client-dist`; it does not
require a Workers build. Bootstrap also generates the static-site assets as the
unprivileged build user for older signed drivers (including the frozen RC.5)
which expect `apps/public-web/dist/downloads`. This copies already-built client
bytes without re-signing them, deploying Workers, or modifying signed source.

CI is not a production “allow Draft” switch. Old production Updaters still reject
unpublished releases. Prepublication CI enters the shared post-verification
pipeline separately. After publication, the actual old-Updater-to-new-release
path must still pass on the designated host before stable promotion. One RC can
cover the transition with these separate pieces of evidence.

## Verification status

### Branch-only update validation (no Release or Git tag)

Before dispatch, run the same portable checks locally with Node.js 24 and the
repository's pinned pnpm (the test prerequisites include `age` and `acl`):

```sh
pnpm check
pnpm build:client
```

These run type checks, workspace builds, documentation checks, fixture tests,
lint, and the real client build. The package fixture also exercises both release
and tagless validation packaging and removes its temporary directory afterward.
They do not prove multi-UID permissions, systemd/PAM/rootless Docker integration,
or GitHub-issued provenance. Do not bypass the disposable-host guards to run
provisioning or the full update E2E on an existing production VPS.

After `server-update-validation.yml` is merged into the default branch, run it
manually from Actions or with:

```sh
gh workflow run server-update-validation.yml --ref YOUR_BRANCH
```

Use a branch in this repository with an RC package version. Keep that version
unchanged while fixing validation failures; no RC tag or Draft is created. This
workflow does not run on pull-request events and receives no production or
Cloudflare secrets. A branch commit is pinned at dispatch, fully checked and
packaged by the shared builder with `--validation-only`. Its manifest is marked
`validationOnly: true`. Sigstore verification pins the dedicated validation
workflow, branch ref and exact commit before the shared E2E imports any artifact
code. Production/release verification still requires the release workflow and
tag; branch-validation proofs are not a release publication authority.

The artifact is transferred by immutable Actions artifact ID, not build cache,
and retained for one day. Both runners are disposable; E2E staging and temporary
DB probes are removed in `finally` blocks. Interrupted runner execution is
reclaimed with the runner. There is no release-upload job or contents-write
permission. Passing this workflow does not replace the release-only E2E: the
final tagged, signed bytes still pass that gate before Draft creation, followed
by separate designated-host validation after publication.

### Initial database permissions

SQLite's default creation mode does not grant shared-group write even with
umask 0007. Deployment explicitly prepares the database as
`latex-renderer:latex-renderer`, mode 0660, before the first CLI migration, and
repairs existing WAL/SHM/journal modes without truncating data. It rejects
symlinks, multiply linked files and non-regular entries. Initial CI deployment
uses exclusive creation before invoking the frozen historical driver and still
refuses an existing database. No live database has been repaired by these code
changes alone.

Disposable-host provisioning also checks two distinct real service UIDs against
a temporary SQLite database, reproducing readonly failure at 0640 and verifying
successful writes with live WAL/SHM after preparation. This runs before the slow
TeX build; its success is separate from local fixture/mode tests and must not be
claimed until that CI step actually passes.

Fixture tests cover independent file lifetime, identity reuse, activation,
recovery, retention, state corruption, unsafe paths and protocol rejection.
Mocks do not establish actual Sigstore/systemd/Docker success. The real release
E2E runs only upon RC/stable dispatch; it and the production migration must not
be reported successful until results exist.

On 2026-09-09, [branch validation run 34329605991](https://github.com/n624-dev/latex-renderer/actions/runs/34329605991)
passed for commit `de5494988ae8dd3c7a162844309a43321e700279`. It verified
GitHub-issued branch provenance, distinct service-UID database writes, the
unchanged RC.5 baseline upgrade, owner/storage preservation, English/Japanese
PDF/PNG rendering, failed Updater startup recovery and interrupted activation
recovery. Build took about 2 minutes 9 seconds and the disposable-host E2E job
about 10 minutes 19 seconds. This is validation-only evidence, not a published
RC.9 artifact or a successful update of the production VPS. The final RC.10
tagged artifacts and designated-host update still require their own results.
