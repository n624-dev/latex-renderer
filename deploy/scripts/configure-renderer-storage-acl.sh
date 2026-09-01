#!/bin/sh
set -eu

# Rootless Docker maps the configured container UID/GID into the worker's
# subordinate ranges.  Grant only those mapped identities (and the existing
# renderer cleanup group) access to the storage tree.  This keeps the bind
# mounts usable without making staging/output world-writable.
if [ "$(id -u)" -ne 0 ]; then
  echo "configure-renderer-storage-acl.sh must run as root" >&2
  exit 77
fi

storage_root=${1:-/var/lib/latex-renderer/storage}
renderer_env=${2:-/etc/latex-renderer/renderer.env}
worker_user=${RENDERER_WORKER_USER:-latex-render-worker}
cleanup_group=${RENDERER_CLEANUP_GROUP:-latex-renderer}

if ! command -v setfacl >/dev/null 2>&1; then
  echo "setfacl is required; install the acl package before configuring renderer storage" >&2
  exit 69
fi
if ! id "$worker_user" >/dev/null 2>&1; then
  echo "renderer worker user does not exist: $worker_user" >&2
  exit 69
fi
if [ ! -d "$storage_root" ]; then
  echo "renderer storage directory does not exist: $storage_root" >&2
  exit 66
fi

container_uid=${RENDERER_CONTAINER_UID:-10000}
container_gid=${RENDERER_CONTAINER_GID:-10000}
if [ -f "$renderer_env" ]; then
  configured_uid=$(sed -n 's/^RENDERER_CONTAINER_UID=//p' "$renderer_env" | tail -n 1)
  configured_gid=$(sed -n 's/^RENDERER_CONTAINER_GID=//p' "$renderer_env" | tail -n 1)
  [ -n "$configured_uid" ] && container_uid=$configured_uid
  [ -n "$configured_gid" ] && container_gid=$configured_gid
fi
case "$container_uid:$container_gid" in
  *[!0-9:]*|0:*|*:0) echo "renderer container UID/GID must be positive decimal integers" >&2; exit 64 ;;
esac

subuid_base=$(awk -F: -v user="$worker_user" '$1==user {print $2; exit}' /etc/subuid)
subuid_count=$(awk -F: -v user="$worker_user" '$1==user {print $3; exit}' /etc/subuid)
subgid_base=$(awk -F: -v user="$worker_user" '$1==user {print $2; exit}' /etc/subgid)
subgid_count=$(awk -F: -v user="$worker_user" '$1==user {print $3; exit}' /etc/subgid)
case "$subuid_base:$subuid_count:$subgid_base:$subgid_count" in
  *[!0-9:]*|:*|*::*) echo "valid subordinate UID/GID ranges are required for rootless Docker" >&2; exit 69 ;;
esac
if [ "$container_uid" -gt "$subuid_count" ] || [ "$container_gid" -gt "$subgid_count" ]; then
  echo "renderer container UID/GID exceeds the worker subordinate range" >&2
  exit 64
fi

# In a rootless user namespace, container ID 0 maps to the daemon user and
# subordinate mappings begin at container ID 1. The renderer runs as 10000,
# so its host mapping is base + 10000 - 1 (not base + 10000).
mapped_uid=$((subuid_base + container_uid - 1))
mapped_gid=$((subgid_base + container_gid - 1))
cleanup_gid=$(getent group "$cleanup_group" | cut -d: -f3)
case "$cleanup_gid" in
  ''|*[!0-9]*) echo "renderer cleanup group does not have a numeric GID: $cleanup_group" >&2; exit 69 ;;
esac

setfacl -m "u:${mapped_uid}:rwx,g:${mapped_gid}:rwx,g:${cleanup_gid}:rwx,m::rwx,o::---" "$storage_root"
setfacl -m "d:u:${mapped_uid}:rwx,d:g:${mapped_gid}:rwx,d:g:${cleanup_gid}:rwx,d:m::rwx,d:o::---" "$storage_root"
find "$storage_root" -type d -exec setfacl -m "u:${mapped_uid}:rwx,g:${mapped_gid}:rwx,g:${cleanup_gid}:rwx,m::rwx,o::---" {} +
find "$storage_root" -type f -exec setfacl -m "u:${mapped_uid}:rw-,g:${mapped_gid}:rw-,g:${cleanup_gid}:rw-,m::rw-,o::---" {} +

echo "Renderer storage ACL configured for mapped UID/GID ${mapped_uid}:${mapped_gid}."
