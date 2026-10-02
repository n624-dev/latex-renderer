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

## Baseline and next stage

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

Future cold-build optimization requires a controlled builder/export comparison,
or an explicitly approved provenance-checked Base-reuse policy. This first stage
does not enable Base caching, skip cold Base/runtime validation, change canonical
fallback, weaken checksum/signature checks, change Base-only GHCR publication,
or skip real update/recovery host tests. No new performance gain is asserted
until the modified workflows have completed successfully.
