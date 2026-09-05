#!/bin/sh
set -eu
# Never prune a production daemon or a persistent runner.
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || {
  echo 'This helper requires an ephemeral GitHub-hosted runner.' >&2; exit 77;
}
stage=${1:?stage required}
minimum_gib=${2:?minimum free GiB required}
case "$minimum_gib" in ''|*[!0-9]*) exit 64 ;; esac
echo "Renderer disk checkpoint: $stage"
df -h .
docker system df
available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
[ "$available_kib" -ge "$((minimum_gib * 1024 * 1024))" ] || {
  echo "Insufficient free disk before $stage (need ${minimum_gib} GiB); no validation/publication is authorized." >&2
  exit 70
}
