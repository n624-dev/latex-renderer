#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo "install-host.sh must run as root" >&2; exit 77; fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl age apparmor apparmor-utils jq openssl rsync sqlite3 uidmap dbus-user-session slirp4netns fuse-overlayfs util-linux xz-utils
getent group latex-renderer >/dev/null || groupadd --system latex-renderer
id latex-renderer >/dev/null 2>&1 || useradd --system --gid latex-renderer --home-dir /var/lib/latex-renderer --shell /usr/sbin/nologin latex-renderer
id latex-renderer-web >/dev/null 2>&1 || useradd --system --gid latex-renderer --home-dir /nonexistent --shell /usr/sbin/nologin latex-renderer-web
id latex-render-worker >/dev/null 2>&1 || useradd --system --gid latex-renderer --create-home --home-dir /var/lib/latex-render-worker --shell /bin/bash latex-render-worker
# Debian does not allocate subordinate IDs for system users. Rootless Docker
# requires a dedicated, non-overlapping range; the regular ubuntu user owns
# 100000-165535 on this host, so reserve the next 65536 IDs for the worker.
grep -q '^latex-render-worker:' /etc/subuid || usermod --add-subuids 165536-231071 latex-render-worker
grep -q '^latex-render-worker:' /etc/subgid || usermod --add-subgids 165536-231071 latex-render-worker
id latex-renderer-backup >/dev/null 2>&1 || useradd --system --gid latex-renderer --home-dir /var/backups/latex-renderer --shell /usr/sbin/nologin latex-renderer-backup
id cloudflared >/dev/null 2>&1 || useradd --system --home-dir /var/lib/cloudflared --shell /usr/sbin/nologin cloudflared
install -d -o latex-renderer -g latex-renderer -m 2770 /var/lib/latex-renderer /var/lib/latex-renderer/storage
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/image-manager /var/lib/latex-renderer/image-manager/tmp /var/lib/latex-renderer/image-manager/operations
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/update-manager /var/lib/latex-renderer/update-manager/staging /var/lib/latex-renderer/update-manager/operations
install -d -o root -g latex-renderer -m 0750 /etc/latex-renderer /etc/latex-renderer/secrets
install -d -o root -g latex-renderer -m 0750 /etc/latex-renderer/ticket-keys
install -d -o latex-renderer-backup -g latex-renderer -m 0750 /var/lib/latex-renderer/backups
install -d -o root -g root -m 0755 /opt/latex-renderer/releases
install -d -o root -g cloudflared -m 0750 /etc/cloudflared
if [ ! -f /etc/latex-renderer/secrets/image-manager-token ]; then
  (umask 077; openssl rand -hex 32 > /etc/latex-renderer/secrets/image-manager-token)
fi
chown root:root /etc/latex-renderer/secrets/image-manager-token
chmod 0400 /etc/latex-renderer/secrets/image-manager-token
if [ ! -f /etc/latex-renderer/secrets/update-manager-token ]; then
  (umask 077; openssl rand -hex 32 > /etc/latex-renderer/secrets/update-manager-token)
fi
chown root:root /etc/latex-renderer/secrets/update-manager-token
chmod 0400 /etc/latex-renderer/secrets/update-manager-token
if [ ! -f /etc/latex-renderer/update-manager.env ]; then
  update_deploy_user=${UPDATE_DEPLOY_USER:-${SUDO_USER:-}}
  if [ "$update_deploy_user" = root ] || \
     ! printf '%s\n' "$update_deploy_user" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$'; then
    echo "Run install-host.sh through sudo from a valid non-root deployment user" >&2
    exit 64
  fi
  printf 'UPDATE_DEPLOY_USER=%s\n' "$update_deploy_user" > /etc/latex-renderer/update-manager.env
fi
chown root:root /etc/latex-renderer/update-manager.env
chmod 0600 /etc/latex-renderer/update-manager.env
# Keep operation diagnostics for 30 days without allowing unbounded growth.
cat > /etc/tmpfiles.d/latex-renderer-image-manager.conf <<'EOF'
d /var/lib/latex-renderer/image-manager/tmp 0750 root latex-renderer -
d /var/lib/latex-renderer/image-manager/operations 0750 root latex-renderer -
e /var/lib/latex-renderer/image-manager/tmp - - - 1d
e /var/lib/latex-renderer/image-manager/operations - - - 30d
d /var/lib/latex-renderer/update-manager/staging 0750 root latex-renderer -
d /var/lib/latex-renderer/update-manager/operations 0750 root latex-renderer -
e /var/lib/latex-renderer/update-manager/staging - - - 1d
e /var/lib/latex-renderer/update-manager/operations - - - 30d
EOF
systemd-tmpfiles --create /etc/tmpfiles.d/latex-renderer-image-manager.conf
systemd-tmpfiles --clean /etc/tmpfiles.d/latex-renderer-image-manager.conf || true
echo "Host users and directories created. Install Node.js 24, rootless Docker for latex-render-worker, and cloudflared before enabling services."
