#!/bin/sh
set -eu
# Never configure or prune a persistent/production daemon from this CI helper.
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 77
requested=${1:-docker}
case "$requested" in
  docker) builder=default ;;
  docker-container)
    builder=${2:?Container builder from setup-buildx-action required}
    case "$builder" in default|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) exit 64 ;; esac
    ;;
  *) echo 'Unsupported renderer builder driver' >&2; exit 64 ;;
esac
inspection=$(docker buildx inspect "$builder")
actual=$(printf '%s\n' "$inspection" | awk '$1 == "Driver:" { print $2; exit }')
[ "$actual" = "$requested" ] || {
  echo 'Renderer builder driver does not match the requested driver' >&2
  exit 65
}
docker buildx inspect "$builder" --bootstrap >/dev/null
printf 'Renderer builder: %s (%s)\n' "$builder" "$actual"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'name=%s\ndriver=%s\n' "$builder" "$actual" >> "$GITHUB_OUTPUT"
fi
