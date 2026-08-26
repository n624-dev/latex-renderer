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

release_retention_count=3
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
  const currentManaged = state.current && state.current.legacy !== true ? state.current : null;
  const previousManaged = state.previous && state.previous.legacy !== true ? state.previous : null;
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

keep_file=$(mktemp /tmp/latex-renderer-release-keep.XXXXXX)
all_file=$(mktemp /tmp/latex-renderer-release-all.XXXXXX)
ranked_file=$(mktemp /tmp/latex-renderer-release-ranked.XXXXXX)
cleanup() { rm -f -- "$keep_file" "$all_file" "$ranked_file"; }
trap cleanup EXIT INT TERM HUP

find "$releases_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@\t%p\n' > "$ranked_file"
LC_ALL=C sort -nr -o "$ranked_file" "$ranked_file"
awk -F '\t' -v keep="$release_retention_count" 'NR <= keep { print $2 }' \
  "$ranked_file" > "$keep_file"
grep -Fxq "$active_release" "$keep_file" || printf '%s\n' "$active_release" >> "$keep_file"
find "$releases_root" -mindepth 1 -maxdepth 1 -type d -print > "$all_file"
LC_ALL=C sort -o "$all_file" "$all_file"

removed_releases=0
while IFS= read -r release; do
  grep -Fxq "$release" "$keep_file" && continue
  release_name=${release##*/}
  case "$release_name" in
    *[!A-Za-z0-9._-]*|'') echo "refusing to remove unexpected release path: $release" >&2; exit 78 ;;
  esac
  if mountpoint -q "$release"; then
    echo "refusing to remove mounted release path: $release" >&2
    exit 78
  fi
  rm -rf -- "$release"
  removed_releases=$((removed_releases + 1))
done < "$all_file"

echo "Removed old production releases: $removed_releases"
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
