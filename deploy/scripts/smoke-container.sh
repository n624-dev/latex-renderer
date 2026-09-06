#!/bin/sh

# Sourced by smoke fixtures. Docker-managed output avoids assumptions about
# host/container UID mappings (rootful, rootless, and userns-remap).
run_smoke_container() (
  set -eu
  smoke_image=$1
  smoke_output=$2
  shift 2
  smoke_volume=$(docker volume create --label jp.n624.latex-renderer.smoke-test=true)
  case "$smoke_volume" in ''|*[!a-f0-9]*) echo "Unexpected Docker volume identity" >&2; exit 65 ;; esac
  [ "${#smoke_volume}" -eq 64 ] || exit 65
  smoke_name="latex-renderer-smoke-$smoke_volume"
  cleanup_smoke_container() {
    smoke_status=$?
    trap - EXIT HUP INT TERM
    for smoke_container in "$smoke_name" "$smoke_name-init"; do
      if docker container inspect "$smoke_container" >/dev/null 2>&1; then
        docker container rm --force "$smoke_container" >/dev/null || smoke_status=1
      fi
    done
    docker volume rm "$smoke_volume" >/dev/null || smoke_status=1
    exit "$smoke_status"
  }
  trap cleanup_smoke_container EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # The only root process initializes a new, empty, dedicated output volume.
  # It cannot access fixture input or host bind mounts. Rendering remains non-root.
  docker run --rm --name "$smoke_name-init" --network none --read-only --user 0:0 \
    --cap-drop ALL --cap-add CHOWN --cap-add FOWNER \
    --security-opt no-new-privileges --pids-limit 32 --memory 128m \
    --mount "type=volume,src=$smoke_volume,dst=/work/output,volume-nocopy" \
    --entrypoint /bin/sh "$smoke_image" -c \
    'chown 10000:10000 /work/output && chmod 0700 /work/output'
  docker create --name "$smoke_name" --user 10000:10000 \
    --security-opt no-new-privileges \
    --mount "type=volume,src=$smoke_volume,dst=/work/output,volume-nocopy" \
    "$@" >/dev/null
  smoke_result=0
  docker start --attach "$smoke_name" || smoke_result=$?
  # Copy even on failure so callers can inspect compile.log. Without --archive,
  # Docker assigns copied artifacts to the calling host user.
  docker cp "$smoke_name:/work/output/." "$smoke_output" || {
    [ "$smoke_result" -ne 0 ] || smoke_result=1
  }
  exit "$smoke_result"
)
