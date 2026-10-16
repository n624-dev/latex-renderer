#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "prune-production-artifacts.sh must run as root" >&2
  exit 77
fi

if [ "$#" -ne 1 ]; then
  echo "usage: prune-production-artifacts.sh RELEASE_ID" >&2
  exit 64
fi

release_id=$1
case "$release_id" in
  *[!A-Za-z0-9._-]*|'') echo "release id must use A-Z, a-z, 0-9, dot, underscore, or hyphen" >&2; exit 64 ;;
esac

releases_root=/opt/latex-renderer/releases
current_link=/opt/latex-renderer/current
worker_user=latex-render-worker
worker_home=/var/lib/latex-render-worker
worker_uid=$(id -u "$worker_user")
runtime_dir="/run/user/$worker_uid"
rootless_socket="unix://$runtime_dir/docker.sock"
renderer_env=/etc/latex-renderer/renderer.env
source_image=latex-renderer:texlive-2026
image_manager_state=/var/lib/latex-renderer/image-manager/state.json

active_release=$(readlink -f "$current_link")
expected_release="$releases_root/$release_id"
if [ "$active_release" != "$expected_release" ] || [ ! -d "$active_release" ]; then
  echo "refusing cleanup: active release is not $expected_release" >&2
  exit 78
fi

configured_image=$(sed -n 's/^RENDERER_IMAGE=//p' "$renderer_env" | tail -n 1)
case "$configured_image" in
  sha256:*) ;;
  *) echo "refusing cleanup: RENDERER_IMAGE is not an immutable image ID" >&2; exit 78 ;;
esac

rootless_docker() {
  runuser -u "$worker_user" -- env \
    HOME="$worker_home" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DOCKER_HOST="$rootless_socket" \
    docker "$@"
}

rootless_docker image inspect "$configured_image" >/dev/null

managed_current=
managed_previous=
managed_current_base=
managed_previous_base=
if [ -f "$image_manager_state" ]; then
  managed_values=$(/usr/local/bin/node - "$image_manager_state" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
try {
  const state = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid state');
  // Initial prepared runtimes can have any tag; preserve recorded immutable IDs.
  const currentManaged = state.current ?? null;
  const previousManaged = state.previous ?? null;
  for (const target of [currentManaged, previousManaged]) {
    if (target !== null && (
      typeof target !== 'object' || Array.isArray(target) ||
      !/^sha256:[a-f0-9]{64}$/.test(target.runtimeImageId ?? '') ||
      (target.baseImageId != null && !/^sha256:[a-f0-9]{64}$/.test(target.baseImageId))
    )) throw new Error('Invalid protected image identity');
  }
  for (const value of [
    currentManaged?.runtimeImageId,
    previousManaged?.runtimeImageId,
    currentManaged?.baseImageId,
    previousManaged?.baseImageId,
  ]) process.stdout.write(`${typeof value === 'string' ? value : ''}\n`);
} catch {
  process.exit(2);
}
NODE
  ) || {
    echo "refusing cleanup: image manager state is unreadable" >&2
    exit 78
  }
  managed_current=$(printf '%s\n' "$managed_values" | sed -n '1p')
  managed_previous=$(printf '%s\n' "$managed_values" | sed -n '2p')
  managed_current_base=$(printf '%s\n' "$managed_values" | sed -n '3p')
  managed_previous_base=$(printf '%s\n' "$managed_values" | sed -n '4p')
fi

managed_active=false
managed_protected=false
if [ -n "$managed_current" ]; then
  if [ "$configured_image" != "$managed_current" ]; then
    echo "refusing cleanup: managed runtime state does not match RENDERER_IMAGE" >&2
    exit 78
  fi
  managed_active=true
else
  tagged_image=$(rootless_docker image inspect "$source_image" --format '{{.Id}}')
  if [ "$tagged_image" != "$configured_image" ]; then
    echo "refusing cleanup: neither managed state nor legacy source image matches RENDERER_IMAGE" >&2
    exit 78
  fi
fi
for protected in "$managed_current" "$managed_previous" "$managed_current_base" "$managed_previous_base"; do
  [ -z "$protected" ] && continue
  managed_protected=true
  if ! rootless_docker image inspect "$protected" >/dev/null 2>&1; then
    echo "refusing cleanup: protected managed image is missing: $protected" >&2
    exit 78
  fi
done

# Caller still owns the deployment mutation/quiescence boundary. This reads
# root-owned successful history, the pre-switch release and recovery references
# before selecting any deletion; failed candidate mtimes cannot displace them.
tools_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
/usr/local/bin/node "$tools_root/deploy/scripts/release-retention.mjs" collect "$release_id"
if [ "$managed_active" = true ] || [ "$managed_protected" = true ]; then
  # Managed-image cleanup is intentionally delegated to the Image Manager,
  # which protects both current and previous runtime/base IDs. This remains
  # true even when the currently active runtime is the legacy bootstrap image:
  # a managed previous target must stay available for the next rollback.
  echo "Skipped generic Docker prune: managed TeX runtime or rollback image is protected"
else
  rootless_docker image prune --force
fi
rootless_docker image inspect "$configured_image" >/dev/null
echo "Retained production release: $release_id"
echo "Retained rootless renderer image: $configured_image"
