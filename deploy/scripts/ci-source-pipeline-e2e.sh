#!/bin/sh
set -eu
# Consume ONLY the temporary validation Runtime already built by this job.
# No image pull/build/push, Actions cache, production DB, or host configuration.
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 77
runtime=${1:?temporary validation Runtime required}
node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw Error("Source E2E requires Node 24")'
image=$(docker image inspect "$runtime" --format '{{.Id}}')
printf '%s\n' "$image" | grep -Eq '^sha256:[0-9a-f]{64}$' || exit 65
sh deploy/scripts/ci-renderer-disk.sh before-source-pipeline-e2e 1
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @latex-renderer/internal-api... \
  --filter @latex-renderer/renderer-worker... \
  --filter @latex-renderer/remote-mcp-core... \
  --filter @latex-renderer/client-core... \
  --filter @latex-renderer/api-client... build
SOURCE_PIPELINE_RENDERER_IMAGE="$image" \
  corepack pnpm exec vitest run --config vitest.source-pipeline.config.ts
