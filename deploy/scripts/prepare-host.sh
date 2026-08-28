#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "prepare-host.sh must run as root" >&2
  exit 77
fi

if [ "$#" -ne 1 ]; then
  echo "usage: prepare-host.sh RELEASE_ID" >&2
  echo "choose a new immutable release id whenever source files change" >&2
  exit 64
fi
release_id=$1
case "$release_id" in
  *[!A-Za-z0-9._-]*|'') echo "release id must use A-Z, a-z, 0-9, dot, underscore, or hyphen" >&2; exit 64 ;;
esac

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
release_root="/opt/latex-renderer/releases/$release_id"
release_marker="$release_root/.host-prepare-source-complete"
previous_release=
if [ -L /opt/latex-renderer/current ]; then
  current_target=$(readlink -f /opt/latex-renderer/current)
  case "$current_target" in
    /opt/latex-renderer/releases/*) previous_release=$current_target ;;
    *) echo "current release points outside the immutable release root" >&2; exit 78 ;;
  esac
fi
worker_user=latex-render-worker
worker_uid=$(id -u "$worker_user")
worker_home=/var/lib/latex-render-worker
runtime_dir="/run/user/$worker_uid"
user_bus="unix:path=$runtime_dir/bus"
rootless_socket="unix://$runtime_dir/docker.sock"

cloudflared_config=${CLOUDFLARED_CONFIG_FILE:-/etc/cloudflared/config.yml}
if [ -f "$cloudflared_config" ]; then
  cloudflared tunnel --config "$cloudflared_config" ingress validate
elif systemctl is-active --quiet cloudflared; then
  echo "No host-local Tunnel config found; using the active remotely managed connector."
else
  echo "neither a host-local Cloudflare Tunnel config nor an active connector was found" >&2
  exit 74
fi

grep -q "^$worker_user:" /etc/subuid || usermod --add-subuids 165536-231071 "$worker_user"
grep -q "^$worker_user:" /etc/subgid || usermod --add-subgids 165536-231071 "$worker_user"

if [ -e "$release_root" ] && [ "$(find "$release_root" -mindepth 1 -maxdepth 1 -print -quit)" ] && [ ! -f "$release_marker" ]; then
  echo "$release_root already exists and is not empty; choose a new immutable release id" >&2
  exit 73
fi
install -d -o root -g root -m 0755 "$release_root"
if [ ! -f "$release_marker" ]; then
  rsync -a --exclude=.git "$source_root/" "$release_root/"
  : > "$release_marker"
fi
chown -R root:latex-renderer "$release_root"
chmod -R g+rX,o-rwx "$release_root"
ln -sfn "$release_root" /opt/latex-renderer/current
if [ -n "$previous_release" ] && [ "$previous_release" != "$release_root" ]; then
  chmod o-rwx "$previous_release"
fi

install -d -o root -g latex-renderer -m 2770 /var/lib/latex-renderer
install -d -o latex-renderer -g latex-renderer -m 2770 /var/lib/latex-renderer/storage
if [ -d /var/lib/latex-renderer/storage/jobs ]; then
  find /var/lib/latex-renderer/storage/jobs -mindepth 2 -maxdepth 13 -type d -path '*/work*' -exec chmod g+rwx {} +
  find /var/lib/latex-renderer/storage/jobs -mindepth 2 -maxdepth 13 -type d \
    \( -path '*/output*' -o -path '*/staging*' \) -exec chmod a+rwx {} +
fi
install -d -o latex-renderer-backup -g latex-renderer -m 0750 /var/lib/latex-renderer/backups
install -d -o root -g latex-renderer -m 0750 /etc/latex-renderer /etc/latex-renderer/secrets /etc/latex-renderer/ticket-keys
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/image-manager /var/lib/latex-renderer/image-manager/operations /var/lib/latex-renderer/image-manager/tmp
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/update-manager /var/lib/latex-renderer/update-manager/operations
install -d -o root -g root -m 0711 /opt/latex-renderer/update-staging
if [ -d /var/lib/latex-renderer/update-manager/staging ]; then
  chown root:latex-renderer /var/lib/latex-renderer/update-manager/staging
  chmod 0750 /var/lib/latex-renderer/update-manager/staging
fi
if [ ! -f /etc/latex-renderer/update-manager.env ]; then
  update_deploy_user=${UPDATE_DEPLOY_USER:-${SUDO_USER:-$(stat -c '%U' "$source_root")}}
  if [ "$update_deploy_user" = root ] || \
     ! printf '%s\n' "$update_deploy_user" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$'; then
    echo "A valid non-root UPDATE_DEPLOY_USER is required for application updates" >&2
    exit 64
  fi
  printf 'UPDATE_DEPLOY_USER=%s\n' "$update_deploy_user" > /etc/latex-renderer/update-manager.env
fi
chown root:root /etc/latex-renderer/update-manager.env
chmod 0600 /etc/latex-renderer/update-manager.env
install -d -o "$worker_user" -g latex-renderer -m 0700 /var/lib/latex-renderer/image-manager/docker-config

renderer_env_preexisting=false
if [ -f /etc/latex-renderer/renderer.env ]; then
  renderer_env_preexisting=true
else
  install -o root -g latex-renderer -m 0640 "$source_root/.env.example" /etc/latex-renderer/renderer.env
fi
if [ "$renderer_env_preexisting" = true ] && [ ! -f /var/lib/latex-renderer/image-manager/state.json ]; then
  printf '%s\n' 'preserve-existing-legacy-languages' > /var/lib/latex-renderer/image-manager/migrate-legacy-languages
  chown root:latex-renderer /var/lib/latex-renderer/image-manager/migrate-legacy-languages
  chmod 0640 /var/lib/latex-renderer/image-manager/migrate-legacy-languages
fi
sed -i "s|REPLACE_WORKER_UID|$worker_uid|g" /etc/latex-renderer/renderer.env
if grep -Eq '^RENDERER_JOB_TIMEOUT_SECONDS=(180|300)$' /etc/latex-renderer/renderer.env; then
  sed -Ei 's/^RENDERER_JOB_TIMEOUT_SECONDS=(180|300)$/RENDERER_JOB_TIMEOUT_SECONDS=420/' /etc/latex-renderer/renderer.env
elif ! grep -q '^RENDERER_JOB_TIMEOUT_SECONDS=' /etc/latex-renderer/renderer.env; then
  printf '%s\n' 'RENDERER_JOB_TIMEOUT_SECONDS=420' >> /etc/latex-renderer/renderer.env
fi
sed -i '/^RENDERER_APPARMOR_PROFILE=/d' /etc/latex-renderer/renderer.env

if [ ! -f /etc/latex-renderer/secrets/api-key-pepper ]; then
  (umask 077; dd if=/dev/urandom of=/etc/latex-renderer/secrets/api-key-pepper bs=32 count=1 status=none)
fi
chown root:root /etc/latex-renderer/secrets/api-key-pepper
chmod 0400 /etc/latex-renderer/secrets/api-key-pepper

if [ ! -f /etc/latex-renderer/ticket-keys/v1.key ]; then
  (umask 027; dd if=/dev/urandom of=/etc/latex-renderer/ticket-keys/v1.key bs=32 count=1 status=none)
fi
chown root:latex-renderer /etc/latex-renderer/ticket-keys/v1.key
chmod 0440 /etc/latex-renderer/ticket-keys/v1.key

if [ ! -f /etc/latex-renderer/secrets/backup-age-identity ]; then
  (umask 077; age-keygen -o /etc/latex-renderer/secrets/backup-age-identity)
fi
if [ ! -f /etc/latex-renderer/secrets/backup-age-recipient ]; then
  age-keygen -y /etc/latex-renderer/secrets/backup-age-identity > /etc/latex-renderer/secrets/backup-age-recipient
fi
chown root:root /etc/latex-renderer/secrets/backup-age-identity
chmod 0400 /etc/latex-renderer/secrets/backup-age-identity
chown root:latex-renderer /etc/latex-renderer/secrets/backup-age-recipient
chmod 0440 /etc/latex-renderer/secrets/backup-age-recipient

if [ ! -f /etc/latex-renderer/backup.env ]; then
  (umask 027; printf '%s\n' \
    'DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3' \
    'BACKUP_DIRECTORY=/var/lib/latex-renderer/backups' \
    > /etc/latex-renderer/backup.env)
fi
if grep -q '^BACKUP_DIRECTORY=/var/backups/latex-renderer$' /etc/latex-renderer/backup.env; then
  if [ -d /var/backups/latex-renderer ]; then
    rsync -a --ignore-existing /var/backups/latex-renderer/ /var/lib/latex-renderer/backups/
  fi
  sed -i 's|^BACKUP_DIRECTORY=/var/backups/latex-renderer$|BACKUP_DIRECTORY=/var/lib/latex-renderer/backups|' /etc/latex-renderer/backup.env
fi
chown -R latex-renderer-backup:latex-renderer /var/lib/latex-renderer/backups
chmod 0750 /var/lib/latex-renderer/backups
chown root:latex-renderer /etc/latex-renderer/backup.env
chmod 0640 /etc/latex-renderer/backup.env

install -o root -g latex-renderer -m 0644 "$source_root/deploy/security/seccomp.json" /etc/latex-renderer/seccomp.json
install -o root -g root -m 0644 "$source_root/deploy/security/latex-renderer.apparmor" /etc/apparmor.d/latex-renderer
install -o root -g root -m 0644 "$source_root"/deploy/systemd/*.service "$source_root"/deploy/systemd/*.timer /etc/systemd/system/
apparmor_parser -r /etc/apparmor.d/latex-renderer
systemctl daemon-reload

loginctl enable-linger "$worker_user"
systemctl start "user@$worker_uid.service"

if [ ! -f "$worker_home/.config/systemd/user/docker.service" ]; then
  runuser -u "$worker_user" -- env \
    HOME="$worker_home" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DBUS_SESSION_BUS_ADDRESS="$user_bus" \
    dockerd-rootless-setuptool.sh install --force
fi
runuser -u "$worker_user" -- env \
  HOME="$worker_home" \
  XDG_RUNTIME_DIR="$runtime_dir" \
  DBUS_SESSION_BUS_ADDRESS="$user_bus" \
  systemctl --user enable --now docker

attempt=0
while [ ! -S "$runtime_dir/docker.sock" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "rootless Docker socket did not appear at $runtime_dir/docker.sock" >&2
    exit 75
  fi
  sleep 1
done

echo "Host preparation complete."
echo "Release: $release_root"
echo "Rootless Docker: $rootless_socket"
echo "Renderer image will be reconciled from saved Image Manager settings."
echo "Services were not started; configure Cloudflare Access and /etc/latex-renderer/renderer.env first."
