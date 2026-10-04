#!/bin/sh
set -eu
batch=${CI_DATABASE_SAVE_BATCH:-1}
case "$batch" in 1|16|64) ;; *) echo 'CI_DATABASE_SAVE_BATCH must be 1, 16 or 64' >&2; exit 64 ;; esac
publish=${PUBLISH_REQUESTED:-false}
case "$publish" in true|false) ;; *) echo 'PUBLISH_REQUESTED must be true or false' >&2; exit 64 ;; esac
if [ "$batch" -ne 1 ]; then
  [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || {
    echo 'Database batching is only supported on disposable GitHub-hosted CI' >&2
    exit 77
  }
  # The matched hosted 1/16/64 trials validated 64 for normal CI builds.
  # Keep 16 as a non-publishing experiment and 1 as the rollback path.
  [ "$publish" = false ] || [ "$batch" = 64 ] || {
    echo 'Only standard 1 or validated 64 database saves may publish images' >&2
    exit 64
  }
fi
printf 'TEXLIVE_DATABASE_SAVE_BATCH=%s\n' "$batch"
