# Base-only renderer image CI

## Verified registry retention

Registry Runtime support (`runtime-v1-*`) has ended; current hosts build Runtime
locally from verified Base. Daily retention removes unsupported legacy versions
first, by default. Keep recent daily Base, weekly Base, `latest`, unknown/mixed tags and
the bounded on-demand hold. This does not delete VPS snapshots or backups.

Deletion requires package Admin for this repository in **Manage Actions access**,
not just registry push/Write. CLI classic tokens need `read:packages` and
`delete:packages`. A read-only deleted-inventory preflight catches missing access;
reading deleted inventory does not prove Admin, so every DELETE still logs its
status and must be verified against an active list.
An HTTP 404 never counts as a newly deleted version. Remaining versions after
three bounded checks fail the job, and retention errors are not hidden by daily.
Weekly tag promotion is verified before deleting the previous weekly source.
Untagged manifests reachable from retained indexes/subjects are preserved.

For cleanup without any image build/publication, manually dispatch
`renderer-image-daily` with `texlive_date=latest`, `publish=true`,
`maintenance_only=true`, and `purge_legacy_runtimes=true`. Source checks still run,
and the same workflow concurrency group serializes publication and retention.
The default `maintenance_only=false` keeps ordinary daily validation/publication.
Locally, `GHCR_DRY_RUN=true` plans retention without DELETE or tag promotion;
its weekly changes are hypothetical until a real run verifies the aliases.
The diagnostic `GHCR_PURGE_LEGACY_RUNTIMES=false` override is not a compatibility
support guarantee. Public versions over GitHub's download deletion limit must
not be forcibly removed. Version counts do not measure shared-layer GiB savings.

This is the workflow policy for issue #62. It targets native amd64 on the
ephemeral GitHub-hosted Ubuntu runner. ARM64 and multi-platform indexes are
deferred. The server setup features in #50–#53 are a separate change.

Both `renderer-image` and `renderer-image-daily` use
`deploy/scripts/ci-validate-texlive-base.sh`:

1. Validate the language-neutral Base.
2. Discard the Base builder's redundant local build cache after loading Base.
3. Build one temporary English/Japanese Runtime from that exact Base using the
   application's language-runtime builder, with layer-cache reuse disabled.
4. Run basic rendering, English/Japanese PDF + PNG, SVG and compatibility smoke
   tests, then Source/client integration.
5. Remove the temporary Runtime and unused default-builder cache, even on failure.

On ephemeral hosted runners, both workflows select and verify the native
`default` Docker builder by default, avoiding a separate builder container.
`builder_driver=docker-container` in manual dispatch retains the previous
export/load path for comparison and rollback. `renderer-image` also accepts an
explicit `texlive_date` for a same-snapshot, non-publishing cold comparison.
Manual Renderer comparisons have their own run-ID concurrency group and do not
cancel push/PR validation or other comparisons. Daily publication and retention
still share their original serialized group. Hosted validation defaults to four
format workers; `format_jobs=1` or `2` retains serial/lower-parallelism comparison
and rollback, without changing the one-worker default for normal host builds.
The default builder is pruned only on the disposable runner; it is never
removed. Native selection does not enable cache reuse or skip verification.
Actual hosted native-driver results are still required before claiming a
performance or disk improvement. See [measurement and comparison](actions-efficiency.md).

### Bounded Debian bootstrap

Both Dockerfiles bind-mount `renderer/install-debian-packages.sh` only for their
APT phase. It keeps the exact Debian snapshot, signed Release/package checks,
HTTP bootstrap of CA certificates and subsequent verified HTTPS. No floating
Debian mirror, unverified data or permanent download cache is introduced.

Every request has an explicit 30-second connect/inactivity timeout and three
retries. HTTP pipelining is disabled for proxy/CDN compatibility, and unneeded
APT description translations are not fetched. Both index updates use
`--error-on=any`, so a transient index failure cannot produce a successful build
with incomplete package lists. The entire bootstrap and package installation
has a separate 20-minute deadline with a 15-second forced-termination grace;
request timeouts alone would not bound slow responses or retry delays.
The supervising shell waits for the actual APT process even after TERM, so
the force-kill timer still applies to a request ignoring TERM. Normal failures
and timeouts remain fatal. The small inventory is collected before sorting,
so a failed `dpkg-query` is not hidden by a successful `sort`.

Build arguments (validated by the helper):

- `DEBIAN_INSTALL_TIMEOUT_SECONDS=1200`, range 1..3600.
- `DEBIAN_ACQUIRE_TIMEOUT_SECONDS=30`, range 1..120.
- `DEBIAN_ACQUIRE_RETRIES=3`, range 0..5 (additional attempts).

`DEBIAN_INSTALL_PHASE` identifies the active operation, and `DEBIAN_APT_STAGE`
records its wall time and exit status. A timeout may terminate before a stage's
completion record; absence of that record is not success. GNU timeout returns
124 on a normal timeout, or SIGKILL/137 if forced termination is necessary.
These limits concern Debian only, not the VPS mirror sync's three-hour limit.
See the Debian [transport](https://manpages.debian.org/bookworm/apt/apt-transport-http.1.en.html),
[retry configuration](https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html)
and [strict-update](https://manpages.debian.org/bookworm/apt/apt-get.8.en.html) references.

The PR168 old-head run stalled at the first HTTP Packages index, before any
TeX installation or image export. VPS HEAD probes returned HTTP 200 for both
transports, but do not establish hosted-runner connectivity or identify the
precise CDN/network fault. The transport workaround and native-driver speedup
still require a completed hosted cold build; the old run is not a benchmark.
Fixture tests use fake APT commands and isolated destinations, but real GNU
timeout, including a TERM-ignoring process. No host APT configuration is changed.
They select `gnutimeout` or a `timeout --version` identifying GNU coreutils;
having a same-named uutils/BusyBox command is not equivalent to testing Debian's
implementation. If neither GNU command exists, the POSIX fixture tests fail
with a dependency error rather than silently treating an untested deadline as
success. Temporary command wrappers, destinations and process groups are
removed on success or failure.

For an optional real Debian-only check, on a disposable machine with Docker:

```sh
docker run --rm --user 0 \
  --mount "type=bind,src=$PWD/renderer/install-debian-packages.sh,dst=/tmp/install-debian-packages.sh,readonly" \
  --env DEBIAN_FRONTEND=noninteractive \
  debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 \
  sh /tmp/install-debian-packages.sh 20260812T235959Z curl
```

This installs only inside the disposable container, requires network access,
and leaves Docker's normal pulled-image storage. Do not prune a production
daemon to clean it up. This check was not run on the VPS.

PR CI does not log in to GHCR or publish images. Daily publishes only Base after
the entire sequence succeeds. No language Runtime is published. Installer
signature/checksum verification in the Base Dockerfile remains mandatory.

Base installation uses `--no-continue`: a failed package must fail the build,
even if the upstream installer considers it inessential. Language installation
also checks required collections and installed-package dependencies directly
from TLPDB, plus `tlmgr check files`, before generating
formats/caches. An incomplete installation is retried once with collection
reinstallation, preserving checksum verification; a second failure stops the
build. The language-install helper participates in Runtime identity and recovery.
Standalone fonts in the language-neutral Base are allowed: unlike the broad
`tlmgr check depends` audit, this does not require every package to belong to an
installed collection. Missing required dependencies still fail the check.
With docfiles disabled, an empty `texmf-dist/doc/man` directory keeps the shipped
`bin/<arch>/man` symlink valid. No documentation payload is downloaded, and the
normal missing-file check remains enabled.

The cold Base build explicitly installs the Perl LWP HTTPS modules used by
`install-tl` and enables its standard persistent downloader. This keeps the
installer's normal, serial package installation order while reusing the HTTPS
connection instead of starting a separate `curl` process for every archive.
The Docker build log emits `TEXLIVE_INSTALL_SECONDS` (including the installer's
format generation) and `TEXLIVE_FONT_CACHE_SECONDS` for the subsequent font cache
step so hosted-run regressions can be compared without exposing the private
download repository. Setting
`TL_DOWNLOAD_PROGRAM` would bypass this LWP path and is intentionally avoided.

Initial diagnostic evidence (2026-09-08): hosted run `34220055487` reached
package 2574/4557 after 20m55s of installation before cancellation. A local
LWP-enabled cold build reached package 3740/4555 after 9m41s before cancellation.
These are incomplete runs on different machines and slightly different generated
profiles, not a controlled speedup measurement or total build times. Compare
completed hosted runs before attributing an improvement to LWP.

The completed LWP-only hosted run `34222463572` took 29m06s for installation
(packages finished at 26m41s), 11s for font cache, 32m48s for the Base build,
4m55s for Base/runtime validation, and 41m25s for the entire job. This is the
baseline for bounded prefetch. It passed the PDF/PNG/SVG tests, vulnerability
scan, SBOM generation, and lease release. GHCR publication was not part of this
PR job. CPU time and peak temporary disk were not sampled in that run.
Subsequent log auditing found missing `collection-texworks`/`texworks` archives
even in this nominally successful baseline. The checked-in mirror profile now
includes that collection. Its `.ARCH` dependency is conditional, as in the
standard installer: Windows-only binaries do not imply a Linux binary exists.
The stricter failure policy above prevents this incomplete Base from recurring.

The completed 16-object prefetch run `34239058615` took 13m21s for installation,
10s for font cache, 16m47s for the Base build, 4m39s for validation, and 25m34s
for the job. Main package-phase download wait was 156.034s, package wall time
664.094s and CPU time 533.160s; peak reserved compressed buffer was 107663828
bytes. All validation, security scan, SBOM and lease release passed. This is
an observed comparison, not a controlled same-snapshot benchmark, and does not
yet measure the subsequent 20-object automatic-refill change.

### Bounded archive prefetch

`TeXLivePrefetch.pm` is mounted only during the Base install RUN. It wraps the
standard installer's resolved `install_packages` list and `download_file`
entry point; it does not edit upstream Perl sources or metadata. The standard
installer continues installing one package at a time. Four persistent LWP
HTTPS workers fetch later archives while the installer verifies and extracts
the current one. Workers verify the exact size and SHA-512 from the already
verified TLPDB; standard `unpack` then checks them again before extraction.
Database, installer, signatures, and unexpected URLs use the original path.

The default compressed lookahead budget is 256MiB, with at most 20 objects
ahead and four concurrent transfers (not twenty simultaneous transfers).
A separate coordinator refills idle workers as downloads finish, including
while the installer is extracting. It pauses below twenty objects whenever the
next archive would exceed the byte budget, and resumes after consumption.
Reservations count incomplete downloads at their full expected size.
Each response is capped while streaming, retries are limited to two, and each
attempt has a 120s deadline. Unknown sizes, objects larger than the budget,
non-HTTPS repositories, and profiles requesting sources/docs use the standard
downloader. Prefetch rejects redirects to keep each request at its fixed
snapshot origin; the standard path remains available for non-prefetched files.
Workers prioritize the currently requested object before scheduling later
ones. Workers and their private temporary directory are removed at the end of
each install phase, including normal failures. Abrupt parent termination closes
the coordinator control socket; it reaps workers on EOF. An active demanded
download can delay EOF handling, bounded by the attempt deadlines. A hard kill
can leave temporary files until the build's temporary filesystem is discarded;
it does not create a persistent cache.

This budget covers prefetched compressed archives, not the installed tree,
the current archive handed to standard unpack, its expanded tar, or Docker
export state. Existing hosted-run disk guards remain required. Nothing is
cached in Actions or permanently on the VPS. Base/runtime validation and
publication policy are unchanged.

Use `--build-arg TEXLIVE_PREFETCH_WORKERS=0` for the LWP-only baseline or a value
from 1 to 8 for comparison. The module also validates `TEXLIVE_PREFETCH_BYTES`
(1..1073741824) and `TEXLIVE_PREFETCH_WINDOW` (1..64) when run directly. The
`TEXLIVE_PREFETCH` log lines report time blocked on prefetched downloads,
verified bytes, peak reserved buffer bytes, package-phase wall time, and summed
process/child CPU seconds. Download waits exclude original-downloader fallbacks;
CPU seconds may exceed wall time because workers overlap. A speed comparison
must use the same snapshot/profile and include complete hosted validation.

Run `python3 -m unittest -v tests/texlive_prefetch_test.py` with Perl LWP HTTPS
modules and OpenSSL installed. Tests use a small local HTTPS server with a
temporary CA certificate; they do not download TeX Live or require root.
They also simulate extraction pauses to check autonomous refill, the twenty
object ceiling, byte-budget pauses below that ceiling and subsequent resumption,
as well as worker/coordinator failures and skipped/backward package requests.

## Failed builds, retries and cache

A cached layer or existing local tag is never evidence of passing validation.
Both Base cold builds and CI Runtime builds disable layer-cache reuse; neither
workflow imports or exports an Actions build cache. Runtime tags include the run
ID and attempt, are removed before use, and are discarded after testing.
Runtime cache policy on end-user servers is unchanged.

Only the language-install helper is copied before the expensive language layer
in a managed Runtime build; renderer sources and their fingerprint ARG follow
it. Host builds can reuse existing language layers on renderer-only changes,
without adding a new cache. Runtime identity still covers all current sources,
the Base ID and selected languages; installer changes invalidate that layer.
CI still cold-builds the Runtime. Language install, format generation and font
caches have separate wall-time log markers; each command's failure remains
fatal. `TEXLIVE_CI_STAGE` also records each required validation stage and its
exit status, including failure, without recording private URLs or arguments.

Daily checks the public registry for the immutable dated Base. A manifest 404
means missing; authentication/network/server failures stop the run. It does not
use GitHub's potentially permission-masked package-list 404 as proof of absence.
An existing Base is pulled by digest and must match the selected snapshot,
installer checksum, profile and Base-kind labels and pass fresh tests with the
current renderer code. A changed dated digest before publication is rejected.

If a previous attempt published Base but failed later, the next attempt verifies
and reuses that Base rather than overwriting it. If no Base was published, the
next attempt cold-builds it. Failed/unvalidated builds are not published as
checkpoints. This deliberately favors correctness over faster failed retries.

The public `latest` alias is changed only after validation, dated publication
and an anonymous digest-qualified pull/Base test succeed. A failure before
promotion leaves `latest` unchanged. Existing immutable dates are never replaced.

## Disk lifecycle and evidence

The CI-only disk helper logs `df` and `docker system df`, requiring at least
12 GiB free before a Base build/pull and 6 GiB before language validation. These
are early safety checks, not a proven upper bound on peak usage. Actual hosted
run results remain required before claiming the disk budget is satisfied.
The Base and one derived Runtime share Docker layers; there is no second
language-neutral Runtime or parallel language-variant build. Intermediate
BuildKit state is discarded between stages, before SBOM generation/publication.
Do not run CI cleanup helpers against production Docker: they require
`GITHUB_ACTIONS=true` and `RUNNER_ENVIRONMENT=github-hosted`.

Validation commands:

```sh
pnpm exec vitest run tests/renderer-ci-validation.test.ts tests/renderer-builder-selection.test.ts tests/runtime-build-layer.test.ts tests/application-update-contract.test.ts tests/tex-environment-contract.test.ts tests/supply-chain-contract.test.ts
```

The command-level failure tests use isolated fake Docker/smoke commands, never
production images. Real rendering still requires the GitHub-hosted image CI.
Run a non-publishing Daily dispatch to exercise registry reuse; run PR image CI
to exercise a cold build. Long image CI is not continuously monitored.

## Smoke-test output isolation

Renderer and Base smoke fixtures use a temporary Docker-managed output volume,
not a host bind mount whose ownership assumes identical host/container UIDs.
This supports the root caller of Image Manager with rootless Docker as well as
rootful GitHub-hosted CI. A restricted initialization container owns only that
new output volume; actual rendering runs as UID/GID 10000 with the existing
read-only filesystem, network, capability, seccomp, and resource restrictions.
Results are copied back for PDF/PNG/SVG validation and failure diagnostics.
The temporary containers and output volume are removed on success and failure;
failure to remove them fails the smoke test rather than reporting success.
Base fixtures also copy input to their temporary workspace, so Docker does not
need access to a caller's private checkout directory.
