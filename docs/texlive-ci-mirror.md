# Capacity-bounded TeX Live CI mirror

This is an operations design for the repository's CI, not a general CTAN
mirror. It stores only the signed TeX Live database, installer, and package
containers selected by the current Base profile plus the English/Japanese
validation collections. GitHub Actions still builds
and tests images and publishes only a validated Base to GHCR. This service
never stores images and its GC never calls a registry API.

The implementation is `deploy/texlive-mirror/texlive_mirror.py`. It requires
Python 3.11+, curl, xz, gpgv, util-linux and a dedicated service account. The
initial architecture list is `amd64`. The repository's non-publishing
`renderer-image` validation runs on native amd64 and ARM64 runners by default;
manual runs accept `architecture=amd64`, `arm64` or `both`. Before enabling
dual-architecture validation with an authenticated mirror,
enable `arm64`/`aarch64-linux` in the mirror selection and copied profile, perform
the normal peak-capacity admission check and sync a new immutable snapshot.
Do not change an existing snapshot, raise the 15 GiB budget, or silently fall
back to another download origin when an ARM lease cannot be acquired.
New daily Base dates use the same canonical snapshot and installer identity on
native amd64 and ARM64 runners. Existing immutable date tags are never replaced
to add an architecture; an old amd64-only date is retested only on amd64 and
cannot downgrade `latest` after the multi-platform transition.

Both validation jobs independently acquire and release their architecture's
lease. They use separate disposable runners and SBOM artifacts, and one failed
job does not cancel the other's validation or release its lease. Architecture
selection never substitutes for signature/checksum, snapshot identity or
English/Japanese renderer validation. Native application tests alone do not
certify a working ARM TeX renderer or signed ARM host updates.

## Multi-platform Base publication

### Selecting the CI snapshot

When the CI mirror is configured, `latest` starts from its bounded public
`latest.json` metadata, not a backwards search for an archive date that happens
to answer a network probe. Metadata schema version 1 contains `snapshotId`,
`url`, immutable `publishedAt`, the newest verified `canonicalDate` alias, and
full `installerSha512` / `databaseSha512` identities. CI validates the ID/hash
binding and age window, compares both identities with that exact canonical
archive date, and reserves the exact ID **and** date together. A changed latest
pointer cannot substitute another snapshot between selection and reservation.
Timeouts, identity differences and unavailable snapshots fail the job; they do
not silently choose an older date or another download origin. Explicit dates
remain explicit. Payload signature/checksum verification is unchanged.

For an existing deployment, install the updated manager and restricted SSH
wrapper before enabling the updated CI selector. Then run, as the mirror's
dedicated user, `texlive-mirror --config /etc/texlive-ci/config.json refresh-metadata`.
This takes the management lock and atomically updates only the small pointer;
it does not run GC, sync payloads, alter leases, change publication timestamps,
or create a snapshot generation. Normal sync and GC also maintain this schema.
Do not manually invent an alias date or rewrite a published snapshot.

An identical sync rechecks the immutable payload and internal aliases, binding
package checksums to the freshly verified upstream database before accepting a
new canonical date. Corruption fails the sync without repairing or replacing
published hardlinks. Management state records `lastVerifiedAt` separately from
immutable `publishedAt`: freshness alerts use the last successful verification,
while retention still uses publication time. Older state without that field
falls back to publication time until the next successful sync. Neither a failed
verification nor a metadata-only refresh advances verification freshness.

The daily workflow resolves the canonical date once before launching native
builds. Each runner performs the full Base, English/Japanese PDF/PNG/SVG,
compatibility and Source pipeline validation without an Actions build cache.
Only its validated, renderer-free Base is copied to a temporary compressed
image layout, checked against the validated Docker image/config ID, and uploaded by
digest without a discovery tag. The temporary layout is removed on success or
failure; its peak-space admission requires twice the image's apparent size plus
2 GiB of free headroom. No image layers are transferred through Actions artifacts
or retained on the mirror VPS. Each validation receipt is bounded to 16 KiB and
retained for one day, separately from its architecture-specific SBOM.

After both native jobs succeed, the coordinator rechecks the run/attempt,
commit, date, installer, config IDs and uploaded manifest digests before creating
the immutable two-platform date index. It rereads the date immediately before
the write and never overwrites an existing date. Registry errors, partial
credentials and digest/provenance differences fail closed. Publication uses the
single serialized daily workflow; external publishers must not write the same
date tags concurrently because the registry has no tag compare-and-swap.

Separate fresh native runners then pull the index anonymously and run the Base
smoke test. Only success on **both** allows `latest` to advance to the exact date
index digest. Failure preserves the previous `latest`. Per-platform uploads
from an interrupted run remain untagged and are subject to the existing 14-day
untagged retention; retained date/weekly/latest indexes protect their children
transitively. A failed run must not forcibly delete a digest that another index
may reference. Registry maintenance waits for all publishers but still runs if
a build, anonymous check or promotion fails, provided source validation passed
and this is a publishing `latest` run. Non-publishing runs do not mutate
retention. The independent maintenance-only dispatch remains available.
After an interrupted multi-platform run, use **Re-run all jobs**, not only failed
jobs: publication requires both validation receipts from the same run attempt.

Transfer preserves the Docker v2 image/config format (`skopeo --format v2s2`)
inside the compressed directory layout. Converting the payload to OCI can
rewrite config bytes and change the validated image ID; that is rejected rather
than treated as a new validation. The public multi-platform index itself is OCI.
The [Skopeo transport contract](https://github.com/containers/image/blob/main/docs/containers-transports.5.md)
permits digest destinations only when the uploaded manifest matches that digest;
the [copy command](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)
also uses `--preserve-digests` for the registry transfer.

Before expensive native builds, CI also runs a tiny, isolated registry protocol
probe using the exact index constructor and synthetic amd64/ARM64 image configs.
It checks OCI-index/Docker-v2-component interoperability with Docker pulls for
both platform selections, not ARM execution or real TeX. To reproduce on a
Linux development host with Node 24 and Docker, explicitly opt in:

```sh
CI_BASE_INDEX_PROBE=1 node deploy/ci/check-base-index.mjs
```

The probe binds its temporary registry only to loopback, uses a digest-pinned
stable official registry image, supplies no credentials, and removes its own
container, synthetic images and newly pulled registry image. It does not change
host Docker configuration, deploy services, or write anything to GHCR.
Ordinary Linux CI also runs the probe on both native runner architectures.
Cleanup removes only the probe's exact container, confirms its absence with a
bounded read-back, and only then removes its owned images. It never forces an
image deletion or removes a registry image that was already present. The probe
reports success only after cleanup succeeds.

GHCR retention retries metadata **GET** transport failures and temporary HTTP
responses at most three times, with bounded waits and a total read budget of
at most 95 seconds. Authentication failures, invalid JSON, TLS verification
failures and inventory/reference changes remain failures. It never blindly
retries a **DELETE**. If a DELETE response is lost, only fresh readable inventory
can establish absence; that outcome is not counted as a confirmed deletion.
Unconfirmed or unreadable deletion state still fails cleanup. Retry diagnostics
contain operation/error categories, not credentials or response bodies. These
changes do not alter weekly selection, protected descendants or retention ages.

These are Base-only images: the temporary validation Runtime is never pushed.
The mirror's 15 GiB management limit, leases and GC are unchanged. User-side
images retain canonical archive URLs, GHCR-first resolution and dated-archive
fallback; no private mirror hostname or CI credential is embedded.

## Storage and trust model

This VPS uses the existing root filesystem without enabling filesystem quota.
No partition, logical volume, loop image, new filesystem, fstab edit, remount or
reboot is required. The 15 GiB limit is therefore enforced by the mirror
application and is **not an OS-enforced quota**. This is an explicit deployment
exception to the original OS hard-limit requirement; status and documentation
must never describe quota as enabled.

Staging, trash, state and downloads remain below `/srv/texlive-ci`. Downloads
use a `.partial` beside their final staging path, and systemd sets `TMPDIR` to
the managed staging directory. The preflight verifies that the managed root is
a real canonical directory and that the OS filesystem still has 3 GiB free.
The sync admission estimate includes current unique
allocated blocks, all new known container sizes, 115% temporary/replace space,
and 256 MiB metadata headroom. An absent size is an error, never zero. Admission
requires an estimated peak no greater than 14 GiB and at least 3 GiB free on
the relevant filesystems. The 15/11/9/14 GiB values use exactly 1,073,741,824
bytes per GiB. Actual free space is re-read after deletion; apparent snapshot
sizes are not treated as reclaimed bytes.

The mirror downloads the canonical date archive, verifies both signed SHA-512
files with a locally provisioned TeX Live keyring, verifies the installer and
the uncompressed `texlive.tlpdb`, and checks the database's declared release.
The signed database is never rewritten as a subset; both its upstream compressed
form and the verified uncompressed form required by `install-tl` are published.
Package selection is a dependency
closure from `renderer/texlive.profile` plus configured
`collection-langenglish` and `collection-langjapanese`; these language packages
remain absent from Base and are used only by the temporary validation Runtime.
`.ARCH` dependencies expand only for enabled architectures. Doc and source
containers remain omitted because the profile explicitly disables them. Package
archives with no signed size or checksum abort the sync.

TeX Live's signed database identifies revisioned package archives, while
`install-tl` requests stable, unversioned archive names. Mirror format v3 records
those aliases in the completion manifest and creates them as same-directory
hardlinks to the verified revisioned files. This neither duplicates file data nor
introduces symlinks that could escape the managed snapshot.

The snapshot ID contains the TeX Live year and prefixes of the database,
installer and selection hashes plus the mirror format version. Selection hashes
cover architectures, profile hash and the complete package set. Re-running the
same input returns the existing snapshot without adding a generation. Verified
canonical dates with identical database, installer and selection identity
are recorded as verified aliases in state, not rewritten into the immutable
manifest. A dated reservation returns that requested verified date, while keeping
the same snapshot ID, hashes and fixed URL. Duplicate acquisition for another
verified date alias does not rewrite the lease or extend its original expiry.
Unknown dates are rejected; CI still compares the exact requested date and
canonical installer checksum before building. Existing files are hardlinked
only after their content checksum is recomputed. New files
are downloaded and verified in staging. The completed tree is read-only before
one atomic rename into `snapshots/`; published inodes are never updated in place.

## Install without deploying data

As root, create the service account, managed directory and configuration. Copy,
do not symlink, the executable files into root-owned locations:

```sh
useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin texlive-ci
install -d -o texlive-ci -g texlive-ci -m 0755 /srv/texlive-ci
install -D -o root -g root -m 0755 deploy/texlive-mirror/texlive_mirror.py /usr/local/libexec/texlive-mirror
install -D -o root -g root -m 0755 deploy/texlive-mirror/texlive-ci-storage-check /usr/local/libexec/texlive-ci-storage-check
install -D -o root -g root -m 0755 deploy/texlive-mirror/texlive-ci-ssh /usr/local/libexec/texlive-ci-ssh
install -d -o root -g texlive-ci -m 0750 /etc/texlive-ci
install -o root -g texlive-ci -m 0640 deploy/texlive-mirror/config.example.json /etc/texlive-ci/config.json
install -o root -g texlive-ci -m 0640 renderer/texlive.profile /etc/texlive-ci/texlive.profile
```

Import the TeX Live signing key out of band, verify its full expected
fingerprint (`C78B82D8C79512F79CC0D7C80D5E5D9106BAB6BC` in the current image
policy), and install the dearmored keyring as `/etc/texlive-ci/texlive.gpg`.
Set the real HTTPS hostname in `config.json`; `.invalid` must never pass a
deployment review. Keep `sync_enabled=false` until the hostname, HTTPS serving,
and first-sync maintenance window are ready; the sync command refuses to run
while disabled. Then run the two fail-closed preflights:

```sh
/usr/local/libexec/texlive-ci-storage-check /srv/texlive-ci 3221225472
sudo -u texlive-ci /usr/local/libexec/texlive-mirror --config /etc/texlive-ci/config.json validate-config
```

Install the supplied systemd units after review. GC runs at boot and every 15
minutes; sync runs daily, calls GC before and after, has one process lock and a
three-hour service timeout. `Persistent=true` handles downtime. Configure this
service's supplied `texlive-ci` journald namespace has a 40 MiB journal budget,
seven-day retention and daily / 4 MiB rotation without changing the host-wide
journal policy. Journald applies retention to archived files at rotation; these
are rotation-based bounds, not a byte-exact filesystem quota. No separate
connection diagnostic archive is created. If file logging is added,
the supplied logrotate example caps eight 20 MiB generations. Nginx exposes only
`/snapshots/<id>/tlnet` and the small root-level `latest.json`; `staging`,
`trash`, and `state` are denied. Supply certificates through the host's existing
ACME policy.

### Upstream failures and bounded retry

Actions still downloads exclusively from the leased VPS snapshot when the CI
mirror is configured. This change adds no direct canonical fallback to Actions,
does not bypass a failed lease, and never relabels another date's content.
The VPS continues to populate its mirror from its existing canonical upstream.

The VPS probes each candidate date at most three times with the existing
ten-second connection budget and two-second gaps. Only HTTP 404/410 means a
candidate date is absent. DNS/connect/timeouts, selected transient transfer
errors and HTTP 408/429/500/502/503/504 trigger bounded retries of the **same**
candidate. Certificate failures, authorization failures, unexpected responses
and invalid diagnostics stop immediately. Metadata/package signature and hash
verification remain mandatory; probe success alone is not verification.

If transport failures remain, the sync command retries at offsets 15 and 30
minutes from the first failed cycle (not an endless timer). The latest-date
search uses the original invocation's date, even across midnight. Once a date
is resolved, later attempts use that exact date. Capacity/state/verification
failures are not delayed retries. A process-held cycle lock excludes overlapping
jobs; the normal sync lock and staging protections apply during each attempt.
GC can run during backoff. The CLI alarm and systemd three-hour timeout bound
the **whole** command, including connection attempts, backoff, build-up of the
snapshot and cleanup. Reboot/termination releases locks; retries are not a
persisted queue that could rehydrate old dates after a reboot.

`upstream_probe_attempts` (1–5), `upstream_probe_retry_delay_seconds` (1–60),
`upstream_connect_timeout_seconds` (1–60), and `sync_retry_offsets_seconds`
(at most two strictly increasing positive offsets within `sync_timeout_minutes`)
are configurable. An empty offset list disables delayed retries. Existing
package-transfer curl retries remain separate from the date-probe attempts.

Each probe logs only date, attempt, curl exit, HTTP status, remote IP and
DNS/TCP/TLS/total cumulative timings. Missing measurements stay null, not zero.
No URL, response body, headers, curl stderr or credentials are included in probe
diagnostics. Resolver failures now reach the existing persistent event and
state-change / six-hour notification mechanism as `upstream_unavailable`.
Inspect the dedicated namespace with `journalctl --namespace=texlive-ci`.

For deployment, review/install the updated mirror executable, namespace journal
drop-in and sync service together, reload systemd and apply the namespace's
settings in a maintenance window. Do not restart an in-progress sync. No unit
changes to the host-wide journal, disk layout, firewall, or Actions credentials
are needed. Test namespace retention/rotation on a disposable systemd host;
ordinary fixture tests do not claim to verify actual journald vacuum behavior.

## Reservations and GitHub Actions

Create an unprivileged SSH account whose only authorized key line is similar to:

```text
restrict,command="/usr/bin/sudo -n -u texlive-ci -- /usr/local/libexec/texlive-ci-ssh" ssh-ed25519 AAAA... github-actions-texlive-ci
```

Install `deploy/sudoers.d/texlive-ci-lease` after validating it with `visudo`.
It preserves only `SSH_ORIGINAL_COMMAND` and permits the lease account to run
only the fixed parser as the unprivileged `texlive-ci` service account, never as
root. Keep the lease account password locked; the forced key is its sole entry
point and does not permit a PTY, forwarding, agents, X11, or arbitrary commands.
Install `deploy/sshd/90-texlive-ci-lease.conf`, validate the complete daemon
configuration with `sshd -t`, and reload rather than restart SSH. The per-user
`ForceCommand` is intentionally duplicated by the key restriction as defense in
depth.

The forced command accepts `reserve DATE OWNER ARCH`,
`reserve-snapshot ID DATE OWNER ARCH`, and
`release TOKEN OWNER`. Existence checking and creation use the same management
lock as deletion. Owners should be
`run-id:run-attempt:job:architecture`; retries therefore cannot steal or extend
an earlier lease. Duplicate acquisition returns the original server-time expiry.
amd64 and arm64 have distinct tokens. A release checks the owner and is
idempotent. Unreleased leases expire after eight hours, and no more than two
distinct snapshots may be protected simultaneously.

Publish a dedicated Cloudflare Tunnel route such as
`texlive-ci-lease.example.invalid -> ssh://127.0.0.1:22`; do not open the origin's SSH
port in its firewall. Protect that hostname with its own Cloudflare Access
self-hosted application and a `Service Auth` policy that includes only a
dedicated service token. Do not share the interactive administrator SSH
hostname or its Access policy. Cloudflare Access is the outer machine identity;
the forced SSH key and account remain a separate inner authorization boundary.

The GitHub-hosted runner uses `cloudflared access ssh` as its SSH
`ProxyCommand`. `deploy/scripts/install-cloudflared-client.sh` downloads an
exact Cloudflare release, verifies the release API's published SHA-256 digest,
and adds it to the job path without root access. Store the Access pair as
`TEXLIVE_CI_ACCESS_CLIENT_ID` and `TEXLIVE_CI_ACCESS_CLIENT_SECRET`, the private
SSH key as `TEXLIVE_CI_SSH_KEY`, and the pinned host key text as
`TEXLIVE_CI_KNOWN_HOSTS`. Store `TEXLIVE_CI_HOST` and `TEXLIVE_CI_USER` as
secrets too, so private connection metadata is not exposed as repository
variables. Store the HTTPS distribution hostname (hostname only, without a
scheme or path) as `TEXLIVE_CI_MIRROR_HOST`. The workflows register this value
with GitHub's log masker before a snapshot URL can be emitted, and the lease
helper rejects a returned URL whose hostname differs from it. Use
`texlive-ci-lease.example.invalid` and `texlive-ci-lease` only as placeholder
values in copied examples. The helper passes the Access pair through
the native `TUNNEL_SERVICE_TOKEN_ID` and `TUNNEL_SERVICE_TOKEN_SECRET`
environment variables, never as command-line arguments. It verifies that the reserved
snapshot has the exact canonical date and installer hash already selected by
CI. SSH retries overwrite a private temporary response file on each attempt;
failed attempts cannot contaminate the successful reservation JSON or release
output. Only a successful, identity-validated reservation writes job outputs.
The temporary response is removed on exit, including exhausted retries.
A reservation failure never switches to another snapshot. Workflows must
release in an `always()` step and retain a job timeout below eight hours.
Fork/untrusted PRs receive none of the connection secrets and continue to use the
canonical archive. If only
some credentials are present, trusted workflows fail closed as a partial
configuration instead of bypassing Access. The mirror remains optional rather
than a requirement for existing users.

If the Cloudflare zone has a country or browser-oriented custom WAF challenge,
add an exact-host `skip` condition for both dedicated CI hostnames before that
challenge. Do not disable the rule for the rest of the zone. Non-browser
`cloudflared access ssh` WebSocket upgrades and HTTPS package downloads cannot
complete an interactive Managed Challenge. Verify the exception in Security
Events and keep WebSockets enabled for the zone.

The server's `cloudflared` package is maintained independently from the pinned
CI client. Install Cloudflare's signed APT repository using its documented
`cloudflare-main.gpg` key, then install
`deploy/scripts/cloudflared-update.sh` as
`/usr/local/sbin/cloudflared-update` and the supplied
`cloudflared-update.service`/`.timer`. The weekly persistent timer updates only
the `cloudflared` package, restarts the tunnel only when its installed version
changes, and verifies that the service returned active. This deliberately does
not modify the host-wide unattended-upgrades policy. Package-manager installs
cannot use cloudflared's built-in updater, so the tunnel service may retain
`--no-autoupdate`.

Use only the official **Stable** source in `deploy/apt/cloudflared.list`
(`https://pkg.cloudflare.com/cloudflared any main`); never use the Nightly
`next.pkg.cloudflare.com` source or Beta/RC packages. The updater requires
root-controlled regular source/key files, rejects extra or unsigned sources,
isolates every APT operation to this source and rejects non-calendar-version
candidates, downgrades and simulated changes to other packages. A failed index
refresh stops the update instead of using stale indexes. The oneshot has a
15-minute limit; network retries and waits are bounded. An unchanged version
does not restart the tunnel. After enabling the source, run
`systemctl start cloudflared-update.service` once and check its result, the
tunnel readiness and application/mirror health; a timer being active alone is
not evidence that updates succeed. Do not disable signature verification to
work around a signing-key or network failure.

```sh
install -o root -g root -m 0755 deploy/scripts/cloudflared-update.sh /usr/local/sbin/cloudflared-update
install -o root -g root -m 0644 deploy/systemd/cloudflared-update.service /etc/systemd/system/cloudflared-update.service
install -o root -g root -m 0644 deploy/systemd/cloudflared-update.timer /etc/systemd/system/cloudflared-update.timer
systemctl daemon-reload
systemctl enable --now cloudflared-update.timer
```

## GC, recovery and alerts

GC always preserves the active year's latest healthy snapshot, live leases and
the hardlink source protected by a running sync. Normally it removes anything
older than 72 hours or outside the newest three. At 11 GiB, or when admission
needs room, it drains interrupted trash/staging and may remove older unleased
snapshots within 72 hours until measured use is at most 9 GiB. If only protected
data remains, sync records `capacity_blocked`, leaves the previous latest live,
and stops. It never expands storage or deletes protected content.

Deletion rechecks protection while holding the management lock, changes state,
atomically moves the directory to private `trash`, and releases the lock before
recursive deletion. The next GC resumes an interrupted trash deletion.

Trash is drained before selecting snapshots and after each snapshot rename;
actual allocation and free space are remeasured before choosing another one.
Moving a directory to trash does not count as freeing it. A separate `gc.lock`
serializes trash walkers without blocking lease registration during recursive
deletion. Lock order is cycle/sync (when held), GC, then management; the probe
for a live sync under the management lock is nonblocking.

Staging recovery requires both an expired operation deadline and absence of the live
sync lock; PID or directory mtime alone is never trusted. Unexpected symlinks,
mounts, names, missing state, malformed leases or corrupt JSON stop deletion and
sync for operator review.

`status` reports hardlink-deduplicated allocated blocks, managed-filesystem free
space, OS-filesystem free space and inode availability. Configure
`notify_command` for the local alert bridge. Error notifications occur on state
change and then at most every six hours, avoiding a 15-minute alert storm.
Review `journalctl -u 'texlive-ci-*'`, `status`, filesystem free space and state
before recovery. Never reconstruct state by treating unreadable reservations as
absent. Restore state from backup or reconcile every snapshot manifest offline.

For an annual transition, update `active_year`, the profile paths and CI in one
reviewed change. The previous year's latest then loses permanent protection but
keeps any live reservation until expiry. Both years share the same 15 GiB cap;
if coexistence does not fit, migration stops safely. Deleted historical
snapshots are not automatically re-downloaded.

## Tests and production-only checks

Run the normal fixture suite without large files:

```sh
python3 -m unittest -v tests/texlive_mirror_test.py
```

It covers generation/age retention, permanent latest, content IDs, leases,
expiry, lock races, source protection, restart recovery, threshold arithmetic,
unknown sizes, hardlinks, post-delete measurement, corrupt state, traversal,
symlinks, annual GC and GHCR isolation. Full ENOSPC verification is a separate
host integration procedure: use proportionally small test thresholds in a
disposable directory, stop before affecting other VPS services, and confirm
`latest.json` and the previous snapshot are unchanged. Repeat after SIGKILL
during download and trash deletion. Do not claim these production checks until
they have actually run on the selected filesystem and service account.
