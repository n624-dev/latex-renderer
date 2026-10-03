# Actions efficiency without build caches

## Normal CI

The `validate` job runs all phases of `pnpm check` separately: typecheck,
recursive workspace build, documentation, regression/integration tests, lint.
The build includes both credential-free Worker dry-runs, the public Worker local
preview, and signed MCPB plus client/Windows archives. Browser tests use that
same job/checkout's freshly built Web output; MCPB verification uses the exact
distribution embedded in the public assets. There is no second workspace build,
second Web build, second client package generation, or second Gateway dry-run.
Developer-facing `pnpm check`, `pnpm build`, `pnpm test:browser`, and standalone
public Web build/deploy remain self-contained; only CI opts into output reuse.

The preview shutdown still sends SIGTERM, waits up to five seconds, then SIGKILL
and reaps an unresponsive process. On success the unused timeout is cancelled,
so it no longer adds five seconds of idle process lifetime.

Trivy's implicit binary/database Actions caching is disabled explicitly; all
existing scanners and blocking security checks remain. Disposable-cache cleanup
is a daily/manual safety net rather than a workflow after every CI completion.
This does not change registry retention, mirror snapshots, publication policy,
or production configuration. No GitHub cache, cross-job build artifact, or
persistent VPS cache is introduced.

## Measurement

`node deploy/ci/measure-phase.mjs <phase> -- <command> [args]` is Linux-only and
requires GNU `/usr/bin/time` (available on Ubuntu hosted runners). It preserves
the command's stdout/stderr and failure exit status, avoids a shell, and records
`CI_PHASE_METRICS` JSON plus a short GitHub step summary. It measures elapsed time,
user/system CPU including waited descendants, maximum process RSS, minimum
filesystem free bytes, and sampled filesystem growth. Maximum process RSS is
not total concurrent process-tree memory. The two filesystem samples refer to
the workspace and temporary filesystem, not directory sizes; they may be the
same filesystem and must not be added. One-second samples can miss short peaks
and include unrelated activity. They are not an exact temporary-directory peak.
Unavailable disk measurements are null, never zero. Signal termination can
leave CPU/RSS unavailable. Command arguments, credentials, and environment
contents are not copied into metrics. The tiny temporary time report is removed
in finally; no measurement artifact is uploaded or retained on the VPS.

## Hosted results

Completed hosted normal `validate` jobs before this change took 131–178 seconds;
run 37025890730 took 161 seconds, including check 80s, browser 13s, repeated build
17s and extra Gateway build 2s. These job durations exclude queue waiting.
CodeQL remains an independent required gate, so reducing validation time alone
does not guarantee the same reduction in merge-ready time. Compare successful
runs and their per-phase summaries before claiming a measured speedup.

Renderer run 36944269831 took 22m20s: Base build 785s, validation 270s,
Trivy 114s, SBOM 108s. Its install was 598s, package CPU 419.43s, download wait
72.198s, and Base export/load 150.9s. These are nested/overlapping measurements,
not additive phases. Daily 36936719406 took about 27m56s including source checks.
The bounded prefetch remains four workers, at most 20 objects and 256MiB; its
observed reservation peak in those runs was about 104MiB. More network workers
alone cannot remove the substantial installation/format and export costs.

The first-stage change passed all eleven PR checks and was merged as PR167.
Hosted normal validation [run 37031712380](https://github.com/n624-dev/latex-renderer/actions/runs/37031712380)
took 124 seconds, compared with the immediately preceding 176-second run.
This is a single observed comparison (about 30% shorter), not a controlled
benchmark or guaranteed improvement. Its measured phases were dependencies
5.189s, typecheck 2.882s, build 8.927s, docs 5.396s, tests 39.040s, lint
16.067s, browser installation 10.359s, browser tests 12.441s, and MCPB
verification 0.536s. Setup and other steps also contribute to job time.

The corresponding cold Renderer [run 37031712486](https://github.com/n624-dev/latex-renderer/actions/runs/37031712486)
took 19m37s: Base build 724s, Runtime validation 232s, Trivy 92s, SBOM 92s.
Installation took 539s; package-phase wall/CPU/download wait were
456.640s / 365.450s / 99.796s. Verified archive bytes were 1,444,813,408;
peak reserved prefetch bytes were 108,588,132. Base export/load took 120.7s
(including 63.8s exporting layers and 56.9s sending the tar; the 52.2s Docker
import overlaps those timings). Runtime's language/format/font RUN took 153.6s.
This still used the previous container builder and is not evidence about the
new native-driver candidate.

## Renderer builder comparison and Runtime layer boundaries

The next-stage candidate uses the GitHub-hosted runner's existing `default`
builder with driver `docker`. The [Docker driver](https://docs.docker.com/build/builders/drivers/docker/)
runs Engine's embedded BuildKit and loads images into the local image store;
the previous [container driver](https://docs.docker.com/build/builders/drivers/docker-container/)
uses a separate BuildKit container and export/load transfer. The candidate aims
to avoid that extra transfer, but the hosted cold build must establish the
actual duration and disk benefit. A completed candidate result is recorded below;
an overall native-driver speedup has not been established.
The helper checks the driver and bootstrap status without creating or removing
the default builder. A mismatch fails rather than silently choosing another.
Only ephemeral GitHub-hosted Actions runners may use the helper/cleanup.

Both Renderer workflows accept `builder_driver=docker-container` to retain the
previous path for comparison or rollback. For a non-publishing cold comparison,
dispatch **renderer-image**, setting the same explicit `texlive_date` and changing
only `builder_driver` between `docker` and `docker-container`. The snapshot must
still exist on the VPS and match the canonical installer/database; a missing
lease fails rather than switching snapshots. Compare complete successful runs
on the same commit/profile, and include install, export/load, validation and
disk logs. Do not dispatch Daily with publication enabled just to benchmark.
Engine/BuildKit versions differ between drivers and must be recorded when
interpreting the result; this is not an identical-BuildKit microbenchmark.

Runtime's language-install helper is copied before its expensive language,
format and font layer. Renderer sources and their fingerprint ARG enter scope
afterwards. Renderer-only changes can therefore reuse that layer during normal
managed host builds, while helper/Base/repository/language changes invalidate
it. The full Runtime identity still includes every existing source file and
the exact Base ID. **CI continues to disable layer-cache reuse**, so this
separation is not claimed as a cold-CI speedup or a replacement for validation.
No new persistent cache is added to the VPS.

`TEXLIVE_CI_STAGE` measures wall seconds and exit status for Base smoke,
language Runtime build, basic/English-Japanese/SVG/compatibility checks and
Source integration. The Runtime RUN separately emits
`RUNTIME_LANGUAGE_INSTALL_SECONDS`, `RUNTIME_FORMAT_SECONDS`, and
`RUNTIME_FONT_CACHE_SECONDS`. Metrics do not print command arguments or private
URLs, and failures remain fatal. These wall timings do not measure BuildKit's
daemon CPU or exact temporary-disk peak; prefetch metrics and disk observations
remain separate. No long-lived performance artifact is introduced.

Neither stage enables Base caching, skips cold Base/Runtime validation,
changes canonical fallback, weakens checksum/signature/provenance checks,
changes Base-only GHCR publication, or skips real update/recovery host tests.

PR168's initial native-driver run remained in the first Debian HTTP Packages
index acquisition for almost six hours; it never reached TeX installation or
export. It cannot support a claim about the native export speed. The shared
Debian helper now bounds inactivity, retries and total phase time and logs
each APT stage. Fixed snapshot and signature/checksum checks are unchanged;
failure stops the build rather than choosing a floating mirror. See
[Debian bootstrap limits and verification](renderer-image-ci.md#bounded-debian-bootstrap).

The bounded candidate [run 37102958662](https://github.com/n624-dev/latex-renderer/actions/runs/37102958662)
completed successfully in 23m09s. Debian phases took 4s / 4s / 1s / 76s
(bootstrap update / CA install / HTTPS update / packages). Base build took
821s, TeX install 688s, font cache 10s, and native Base layer export 26.3s;
there was no separate tar transfer/import stage. Runtime validation took 292s,
including language install 77s, format generation 123s and font cache 10s.
Base/basic/English-Japanese/SVG/compatibility/Source checks all passed.
Trivy and SBOM steps took 132s and 101s.
The TeX package phase measured 550.129s wall / 509.170s CPU / 65.952s
download wait, with 1,444,834,392 verified archive bytes and 108,588,132 peak
reserved prefetch bytes. CPU and wait can overlap and must not be summed.
These measurements justify investigating installation/format CPU work before
increasing prefetch workers solely on a network-bottleneck assumption.

The previous container run's export/load took 120.7s, but its whole job was
shorter at 19m37s. Different dates, runner performance and installation times
make these observations an uncontrolled comparison, not proof of an overall
speedup or disk reduction. Keep the explicit same-snapshot driver comparison
available. The successful bounded run demonstrates that the earlier APT stall
did not recur in that run; it does not establish its exact network cause.

The accompanying normal CI initially failed only its new Debian fixtures:
using a bare `timeout` executable in the private wrapper recursively invoked
that wrapper on a runner without `gnutimeout`. Fixtures now resolve the GNU
executable to an absolute path **before** prepending the private bin directory.
A timeout-only PATH regression checks successful execution and a real deadline,
including executable paths containing spaces and quotes. Non-GNU tools are not
accepted, and Node's watchdog expiry remains a test failure.
