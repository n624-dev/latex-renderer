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
