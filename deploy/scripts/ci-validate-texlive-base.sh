#!/bin/sh
set -eu
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 77
base=${1:?Base image required}
repository=${2:?snapshot repository required}
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
validation_runtime="latex-renderer:ci-validation-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
cleanup() {
  docker image rm "$validation_runtime" >/dev/null 2>&1 || true
  docker builder prune --all --force >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
# Remove any previous attempt's tag, not just its cached build layers.
docker image rm "$validation_runtime" >/dev/null 2>&1 || true
sh "$script_root/smoke-test-texlive-base.sh" "$base"
# The Base has been loaded. Its now-redundant BuildKit export state need not
# coexist with the language layer build. Only this job's builder is pruned.
if [ -n "${BUILDX_BUILDER:-}" ]; then
  docker buildx prune --builder "$BUILDX_BUILDER" --all --force
fi
docker builder prune --all --force
sh "$script_root/ci-renderer-disk.sh" before-language-validation 6
RUNTIME_NO_CACHE=true RUNTIME_BUILDX_BUILDER=default \
  sh "$script_root/build-language-runtime.sh" "$base" "$repository" "$validation_runtime" \
    collection-langenglish collection-langjapanese
[ "$(docker image inspect "$validation_runtime" --format '{{index .Config.Labels "jp.n624.latex-renderer.languages"}}')" = collection-langenglish,collection-langjapanese ]
[ "$(docker image inspect "$validation_runtime" --format '{{index .Config.Labels "jp.n624.latex-renderer.runtime-kind"}}')" = managed-local-v1 ]
sh "$script_root/smoke-test-renderer-basic.sh" "$validation_runtime"
sh "$script_root/smoke-test-renderer-en-jp.sh" "$validation_runtime"
sh "$script_root/smoke-test-renderer-svg.sh" "$validation_runtime"
# Success is the exit status of this complete sequence, never a cached marker.
cleanup
sh "$script_root/ci-renderer-disk.sh" after-language-validation 0
