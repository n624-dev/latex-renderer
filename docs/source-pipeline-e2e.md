# Source pipeline integration verification

The regression suite in `tests/source-pipeline-e2e.test.ts` connects the real
client-core and API client to three independent loopback HTTP servers, the shared
gateway JSON proxy, Internal API and Renderer API. It uses a private on-disk
SQLite database, the shared ZIP validator, the real Worker claim/process/publish
code, authenticated artifact downloads and the client artifact transaction.
API keys and ticket signing secrets are generated solely for this fixture; no
production environment or saved credentials are read. HTTP bodies, DB state,
Source ZIPs and artifacts are not mocked.

The scenarios cover:

- Rendering twice to a project-local custom output directory without including
  that directory in the next Source; deduplication avoids a second upload.
- Rerendering a three-page document as one page and removing old previews while
  verifying downloaded bytes against Worker-generated size/SHA-256 metadata.
- `jobs download` waiting for a queued Job without modifying the old generation.
  The ordinary child fixture also holds a running Job and checks the entire old
  set before allowing publication.
- Rejecting a case-colliding MCP revision without creating a ready Source, then
  consuming a valid immutable revision through HTTP and the Worker using a
  second API key of the same owner. Another owner cannot queue that Source.

## Ordinary automated tests

```sh
pnpm install --frozen-lockfile
pnpm build:workspaces
pnpm exec vitest run tests/source-pipeline-e2e.test.ts
```

Without `SOURCE_PIPELINE_RENDERER_IMAGE`, only the Docker renderer child is
replaced by a small deterministic process. Its output is **not evidence of a
successful TeX compile or valid PDF document**. It exercises the HTTP/DB/Worker
integration and checksum/publication boundaries, not TeX compatibility. No
Docker daemon or TeX Live download is required.

## Real TeX container verification

`ci-validate-texlive-base.sh` runs the same scenarios against the exact temporary
English/Japanese Runtime after the existing PDF/PNG/SVG/compatibility checks and
before deleting that Runtime. `ci-source-pipeline-e2e.sh` resolves its immutable
local image ID, requires Node 24 and checks additional disk headroom before
installing fixed workspace dependencies. Both renderer-image workflows use
this path. Installation, build or integration-test failures propagate to the
validation step and therefore prevent publication. The cleanup trap still
removes the temporary Runtime on failure. No extra image is built/pulled/pushed,
no permanent download cache is created and no Actions build cache is added.

For an isolated Linux development host with an **already available** compatible
Runtime and Docker bind-mount permissions:

```sh
image=$(docker image inspect YOUR_LOCAL_RUNTIME --format '{{.Id}}')
SOURCE_PIPELINE_RENDERER_IMAGE="$image" \
  pnpm exec vitest run --config vitest.source-pipeline.config.ts
```

The fixture runs the production Docker argument builder: network disabled,
read-only image, non-root container UID/GID, dropped capabilities and the
repository seccomp profile. On the rootful ephemeral GitHub runner, the
container UID/GID is the non-root runner's UID/GID so the private fixture files
are accessible without broadening their permissions. A persistent rootless
host requires its own subordinate-ID/storage ACL mapping; do not relax service
security, make storage world-writable or change production directories just to
run this test. The CI wrapper refuses persistent/self-hosted hosts before doing
anything. The direct Vitest command creates only temporary data and must be
run with the necessary existing Docker/storage permissions.

An image ID is mandatory in this explicit integration mode. Invalid or missing
image configuration fails instead of silently reverting to the child fixture.
Listeners, private DB/files and child processes are cleaned up on completion.
This test does not certify Windows GUI behavior, real external MCP clients or
Cloudflare routing; those retain their separate validation requirements.
