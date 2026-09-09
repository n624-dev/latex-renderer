#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 0 ]; then
  echo "Run configure-rootless-docker.sh as root without arguments" >&2
  exit 64
fi
worker_user=latex-render-worker
worker_uid=$(id -u "$worker_user")
worker_home=/var/lib/latex-render-worker
runtime_dir="/run/user/$worker_uid"
user_bus="unix:path=$runtime_dir/bus"

# runuser/PAM may retain the caller's XDG paths. HOME alone is insufficient.
# Set every per-user Docker/XDG directory after the identity transition.
run_worker() {
  runuser -u "$worker_user" -- env -u DOCKER_HOST -u DOCKER_CONTEXT \
    HOME="$worker_home" \
    XDG_CONFIG_HOME="$worker_home/.config" \
    XDG_DATA_HOME="$worker_home/.local/share" \
    XDG_CACHE_HOME="$worker_home/.cache" \
    DOCKER_CONFIG="$worker_home/.docker" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DBUS_SESSION_BUS_ADDRESS="$user_bus" \
    "$@"
}
loginctl enable-linger "$worker_user"
systemctl start "user@$worker_uid.service"
if [ ! -f "$worker_home/.config/systemd/user/docker.service" ]; then
  run_worker dockerd-rootless-setuptool.sh install --force
fi
run_worker systemctl --user enable --now docker
attempt=0
# A socket alone is not readiness, nor proof that the intended daemon is used.
until [ -S "$runtime_dir/docker.sock" ] && \
  run_worker env DOCKER_HOST="unix://$runtime_dir/docker.sock" \
    docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'name=rootless'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "rootless Docker did not become ready at $runtime_dir/docker.sock" >&2
    exit 75
  fi
  sleep 1
done
