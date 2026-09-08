#!/bin/sh
set -eu
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 77
base=${1:?Base image required}
repository=${2:?download repository required}
canonical_repository=${3:-$repository}
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
if [ "$repository" != "$canonical_repository" ]; then
  if docker history --no-trunc "$base" | grep -F -- "$repository" >/dev/null; then
    echo "CI mirror URL remains in image history" >&2
    exit 65
  fi
  docker run --rm --network none --read-only \
    --env "PRIVATE_TEXLIVE_REPOSITORY=$repository" \
    --entrypoint /bin/sh "$base" -c '
      if grep -R -l -F -- "${PRIVATE_TEXLIVE_REPOSITORY}" /opt/texlive /opt/renderer; then
        echo "CI mirror URL remains in image filesystem" >&2
        exit 65
      fi
    '
fi
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --env "EXPECTED_TEXLIVE_REPOSITORY=$canonical_repository" \
  --entrypoint /bin/sh "$base" -c '
    grep -F "\"texliveRepository\":\"${EXPECTED_TEXLIVE_REPOSITORY}\"" /opt/renderer/build-provenance.json >/dev/null
    tlmgr option repository | grep -F -- "${EXPECTED_TEXLIVE_REPOSITORY}" >/dev/null
  '
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
