#!/bin/sh
set -eu
batch=${CI_DATABASE_SAVE_BATCH:-1}
case "$batch" in 1|16|64) ;; *) echo 'CI_DATABASE_SAVE_BATCH must be 1, 16 or 64' >&2; exit 64 ;; esac
if [ "$batch" -ne 1 ]; then
  [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || {
    echo 'Database batching is only supported on disposable GitHub-hosted CI' >&2
    exit 77
  }
  [ "${PUBLISH_REQUESTED:-false}" = false ] || {
    echo 'Database batching comparison must not publish images' >&2
    exit 64
  }
fi
printf 'TEXLIVE_DATABASE_SAVE_BATCH=%s\n' "$batch"
