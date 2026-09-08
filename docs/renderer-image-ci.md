# Base-only renderer image CI

This is the workflow policy for issue #62. It targets native amd64 on the
ephemeral GitHub-hosted Ubuntu runner. ARM64 and multi-platform indexes are
deferred. The server setup features in #50–#53 are a separate change.

Both `renderer-image` and `renderer-image-daily` use
`deploy/scripts/ci-validate-texlive-base.sh`:

1. Validate the language-neutral Base.
2. Discard the Base builder's redundant local build cache after loading Base.
3. Build one temporary English/Japanese Runtime from that exact Base using the
   application's language-runtime builder, with layer-cache reuse disabled.
4. Run basic rendering, English/Japanese PDF + PNG, and SVG smoke tests.
5. Remove the temporary Runtime and unused default-builder cache, even on failure.

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

### Bounded archive prefetch

`TeXLivePrefetch.pm` is mounted only during the Base install RUN. It wraps the
standard installer's resolved `install_packages` list and `download_file`
entry point; it does not edit upstream Perl sources or metadata. The standard
installer continues installing one package at a time. Four persistent LWP
HTTPS workers fetch later archives while the installer verifies and extracts
the current one. Workers verify the exact size and SHA-512 from the already
verified TLPDB; standard `unpack` then checks them again before extraction.
Database, installer, signatures, and unexpected URLs use the original path.

The default compressed lookahead budget is 256MiB, with at most 16 objects
ahead. Reservations count incomplete downloads at their full expected size.
Each response is capped while streaming, retries are limited to two, and each
attempt has a 120s deadline. Unknown sizes, objects larger than the budget,
non-HTTPS repositories, and profiles requesting sources/docs use the standard
downloader. Prefetch rejects redirects to keep each request at its fixed
snapshot origin; the standard path remains available for non-prefetched files.
Workers prioritize the currently requested object before scheduling later
ones. Workers and their private temporary directory are removed at the end of
each install phase, including normal failures. Abrupt parent termination closes
worker sockets; in-flight requests are bounded by the attempt deadlines.

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

## Failed builds, retries and cache

A cached layer or existing local tag is never evidence of passing validation.
Both Base cold builds and CI Runtime builds disable layer-cache reuse; neither
workflow imports or exports an Actions build cache. Runtime tags include the run
ID and attempt, are removed before use, and are discarded after testing.
Runtime cache policy on end-user servers is unchanged.

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
pnpm exec vitest run tests/renderer-ci-validation.test.ts tests/application-update-contract.test.ts tests/tex-environment-contract.test.ts tests/supply-chain-contract.test.ts
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
