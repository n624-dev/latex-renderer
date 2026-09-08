# Capacity-bounded TeX Live CI mirror

This is an operations design for the repository's CI, not a general CTAN
mirror. It stores only the signed TeX Live database, installer, and package
containers selected by the current Base profile plus the English/Japanese
validation collections. GitHub Actions still builds
and tests images and publishes only a validated Base to GHCR. This service
never stores images and its GC never calls a registry API.

The implementation is `deploy/texlive-mirror/texlive_mirror.py`. It requires
Python 3.11+, curl, xz, gpgv, util-linux and a dedicated service account. The
initial architecture list is `amd64`, matching issue #62 and current CI. The
parser understands `arm64`/`aarch64-linux`, but enabling it is part of the
separate ARM CI work and also requires updating the copied profile.

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

The snapshot ID contains the TeX Live year and prefixes of the database,
installer and selection hashes plus the mirror format version. Selection hashes
cover architectures, profile hash and the complete package set. Re-running the
same input returns the existing snapshot without adding a generation. Existing
files are hardlinked only after their content checksum is recomputed. New files
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
service's supplied `texlive-ci` journald namespace caps its own journal at 200
MiB without changing the host-wide journal policy. If file logging is added,
the supplied logrotate example caps eight 20 MiB generations. Nginx exposes only
`/snapshots/<id>/tlnet` and the small root-level `latest.json`; `staging`,
`trash`, and `state` are denied. Supply certificates through the host's existing
ACME policy.

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

The forced command accepts only `reserve DATE OWNER ARCH` and
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
`TEXLIVE_CI_KNOWN_HOSTS`. Set repository variables
`TEXLIVE_CI_HOST=texlive-ci-lease.example.invalid` and
`TEXLIVE_CI_USER=texlive-ci-lease`. The helper passes the Access pair through
the native `TUNNEL_SERVICE_TOKEN_ID` and `TUNNEL_SERVICE_TOKEN_SECRET`
environment variables, never as command-line arguments. It verifies that the reserved
snapshot has the exact canonical date and installer hash already selected by
CI. A reservation failure never switches to another snapshot. Workflows must
release in an `always()` step and retain a job timeout below eight hours.
Fork/untrusted PRs receive none of the three credentials and continue to use the
canonical archive even though repository variables remain visible. If only
some credentials are present, trusted workflows fail closed as a partial
configuration instead of bypassing Access. The mirror remains optional rather
than a requirement for existing users.

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
recursive deletion. The next GC resumes an interrupted trash deletion. Staging
recovery requires both an expired operation deadline and absence of the live
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
