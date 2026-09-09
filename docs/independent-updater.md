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

CI is not a production “allow Draft” switch. Old production Updaters still reject
unpublished releases. Prepublication CI enters the shared post-verification
pipeline separately. After publication, the actual old-Updater-to-new-release
path must still pass on the designated host before stable promotion. One RC can
cover the transition with these separate pieces of evidence.

## Verification status

Fixture tests cover independent file lifetime, identity reuse, activation,
recovery, retention, state corruption, unsafe paths and protocol rejection.
Mocks do not establish actual Sigstore/systemd/Docker success. The real release
E2E runs only upon RC/stable dispatch; it and the production migration must not
be reported successful until results exist.
