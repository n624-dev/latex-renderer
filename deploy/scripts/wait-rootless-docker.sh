#!/bin/sh
set -eu

worker_user=${RENDERER_WORKER_USER:-latex-render-worker}
max_attempts=${ROOTLESS_DOCKER_WAIT_ATTEMPTS:-60}
sleep_seconds=${ROOTLESS_DOCKER_WAIT_SECONDS:-2}

case "$max_attempts" in ''|*[!0-9]*) echo "ROOTLESS_DOCKER_WAIT_ATTEMPTS must be an integer" >&2; exit 64 ;; esac
case "$sleep_seconds" in ''|*[!0-9]*) echo "ROOTLESS_DOCKER_WAIT_SECONDS must be an integer" >&2; exit 64 ;; esac
[ "$max_attempts" -ge 1 ] && [ "$max_attempts" -le 300 ] || { echo "ROOTLESS_DOCKER_WAIT_ATTEMPTS must be 1..300" >&2; exit 64; }
[ "$sleep_seconds" -ge 1 ] && [ "$sleep_seconds" -le 30 ] || { echo "ROOTLESS_DOCKER_WAIT_SECONDS must be 1..30" >&2; exit 64; }

worker_uid=$(id -u "$worker_user")
worker_home=$(getent passwd "$worker_user" | cut -d: -f6)
runtime_dir="/run/user/$worker_uid"
docker_host="unix://$runtime_dir/docker.sock"

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  if [ -S "$runtime_dir/docker.sock" ] && runuser -u "$worker_user" -- env \
      HOME="$worker_home" \
      XDG_RUNTIME_DIR="$runtime_dir" \
      DOCKER_HOST="$docker_host" \
      docker info >/dev/null 2>&1; then
    exit 0
  fi
  if [ "$attempt" -lt "$max_attempts" ]; then sleep "$sleep_seconds"; fi
  attempt=$((attempt + 1))
done

echo "rootless Docker for $worker_user did not become ready at $runtime_dir/docker.sock" >&2
exit 75
