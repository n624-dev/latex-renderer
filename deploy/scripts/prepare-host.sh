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
worker_user=latex-render-worker
worker_uid=$(id -u "$worker_user")
worker_home=/var/lib/latex-render-worker
runtime_dir="/run/user/$worker_uid"
user_bus="unix:path=$runtime_dir/bus"
rootless_socket="unix://$runtime_dir/docker.sock"

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

install -d -o latex-renderer -g latex-renderer -m 2770 /var/lib/latex-renderer /var/lib/latex-renderer/storage
if [ -d /var/lib/latex-renderer/storage/jobs ]; then
  find /var/lib/latex-renderer/storage/jobs -mindepth 2 -maxdepth 13 -type d -path '*/work*' -exec chmod g+rwx {} +
  find /var/lib/latex-renderer/storage/jobs -mindepth 2 -maxdepth 13 -type d \
    \( -path '*/output*' -o -path '*/staging*' \) -exec chmod a+rwx {} +
fi
install -d -o latex-renderer-backup -g latex-renderer -m 0750 /var/lib/latex-renderer/backups
install -d -o root -g latex-renderer -m 0750 /etc/latex-renderer /etc/latex-renderer/secrets /etc/latex-renderer/ticket-keys
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/image-manager /var/lib/latex-renderer/image-manager/operations /var/lib/latex-renderer/image-manager/tmp

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
cloudflared_config=${CLOUDFLARED_CONFIG_FILE:-/etc/cloudflared/config.yml}
if [ ! -f "$cloudflared_config" ]; then
  echo "host-local Cloudflare Tunnel config not found: $cloudflared_config" >&2
  echo "copy deploy/cloudflared/config.example.yml outside the repository and configure credentials first" >&2
  exit 74
fi
cloudflared tunnel --config "$cloudflared_config" ingress validate
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

source_image=latex-renderer:texlive-2026
docker build --tag "$source_image" "$release_root/renderer"
source_image_id=$(docker image inspect "$source_image" --format '{{.Id}}')
environment_tmp=$(mktemp -d /tmp/latex-renderer-environment.XXXXXX)
trap 'rm -rf -- "$environment_tmp"' EXIT HUP INT TERM
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --entrypoint /bin/sh "$source_image" -c '
    { tlmgr info --only-installed --data name 2>/dev/null | sed "s/^name: //" | sed "/^$/d";
      find /opt/texlive/2026/texmf-dist/tex -type f \
        \( -name "*.sty" -o -name "*.cls" -o -name "*.tex" -o -name "*.lua" -o -name "*.bst" \) \
        -printf "%f\n" | sed "s/\.[^.]*$//"; } | LC_ALL=C sort -fu
  ' > "$environment_tmp/packages.txt"
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  --entrypoint /bin/sh "$source_image" -c '
    { fc-list --format "%{family}\n";
      find /opt/texlive/2026/texmf-dist/fonts -type f \
        \( -name "*.otf" -o -name "*.ttf" \) -print0 \
        | xargs -0 -r fc-scan --format "%{family}\n"; } \
      | tr "," "\n" | sed "/^[[:space:]]*$/d" | LC_ALL=C sort -fu
  ' > "$environment_tmp/fonts.txt"
if [ ! -s "$environment_tmp/packages.txt" ] || [ ! -s "$environment_tmp/fonts.txt" ]; then
  echo "renderer environment inventory generation failed" >&2
  exit 76
fi
install -d -o root -g latex-renderer -m 0750 /var/lib/latex-renderer/environment
install -o root -g latex-renderer -m 0640 \
  "$environment_tmp/packages.txt" "$environment_tmp/fonts.txt" \
  /var/lib/latex-renderer/environment/
source_image_marker=/etc/latex-renderer/renderer-source-image-id
installed_source_image_id=
if [ -f "$source_image_marker" ]; then
  installed_source_image_id=$(cat "$source_image_marker")
fi
if [ "$installed_source_image_id" != "$source_image_id" ] || \
   ! runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker image inspect "$source_image" >/dev/null 2>&1; then
  docker save "$source_image" | runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker load
fi
loaded_id=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker image inspect "$source_image" --format '{{.Id}}')
loaded_user=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker image inspect "$source_image" --format '{{.Config.User}}')
loaded_title=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker image inspect "$source_image" --format '{{index .Config.Labels "org.opencontainers.image.title"}}')
loaded_repository=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" docker image inspect "$source_image" --format '{{index .Config.Labels "jp.n624.latex-renderer.texlive.repository"}}')
if [ "$loaded_user" != "10000:10000" ] || [ "$loaded_title" != "latex-renderer-texlive" ]; then
  echo "rootless Docker image identity check failed" >&2
  exit 76
fi
source_runtime_fingerprint=$(docker run --rm --network none --read-only --entrypoint sha256sum "$source_image" \
  /opt/renderer/compile.sh /opt/renderer/latexmkrc /opt/renderer/texmf.cnf | sha256sum | cut -d' ' -f1)
loaded_runtime_fingerprint=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" \
  docker run --rm --network none --read-only --entrypoint sha256sum "$source_image" \
  /opt/renderer/compile.sh /opt/renderer/latexmkrc /opt/renderer/texmf.cnf | sha256sum | cut -d' ' -f1)
if [ "$loaded_runtime_fingerprint" != "$source_runtime_fingerprint" ]; then
  echo "rootless Docker image runtime fingerprint check failed" >&2
  exit 76
fi
printf '{"sourceImageId":"%s","runtimeFingerprint":"%s","generatedAt":"%s"}\n' \
  "$source_image_id" "$source_runtime_fingerprint" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$environment_tmp/manifest.json"
install -o root -g latex-renderer -m 0640 \
  "$environment_tmp/manifest.json" /var/lib/latex-renderer/environment/manifest.json
rm -rf -- "$environment_tmp"
trap - EXIT HUP INT TERM
printf '%s\n' "$source_image_id" > "$source_image_marker"
chown root:latex-renderer "$source_image_marker"
chmod 0640 "$source_image_marker"
sed -i "s|^RENDERER_IMAGE=.*|RENDERER_IMAGE=$loaded_id|" /etc/latex-renderer/renderer.env

image_manager_state=/var/lib/latex-renderer/image-manager/state.json
if [ -f "$image_manager_state" ]; then
  legacy_languages=$(runuser -u "$worker_user" -- env DOCKER_HOST="$rootless_socket" \
    docker run --rm --entrypoint /bin/sh "$loaded_id" -c \
    "tlmgr info --only-installed --data name 2>/dev/null | sed 's/^name: //' | grep '^collection-lang' || true")
  legacy_languages_csv=$(printf '%s\n' "$legacy_languages" | sed '/^$/d' | paste -sd, -)
  /usr/local/bin/node - "$image_manager_state" "$loaded_id" "$source_image" "$loaded_repository" "$legacy_languages_csv" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const runtimeImageId = process.argv[3];
const runtimeRef = process.argv[4];
const repository = process.argv[5] || null;
const languages = process.argv[6] ? process.argv[6].split(',').filter(Boolean).sort() : [];
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!state.current || state.current.legacy !== true) process.exit(0);
const match = /tlnet-archive\/(\d{4})\/(\d{2})\/(\d{2})\/tlnet/.exec(repository ?? '');
state.current = {
  ...state.current,
  selector: match ? { mode: 'date', value: `${match[1]}-${match[2]}-${match[3]}` } : null,
  baseRef: null,
  baseDigest: null,
  baseImageId: null,
  runtimeRef,
  runtimeImageId,
  rendererRuntimeFingerprint: null,
  snapshotDate: match ? `${match[1]}-${match[2]}-${match[3]}` : null,
  languages,
  effectiveLanguageCollections: languages,
  rendererUpdatedAt: new Date().toISOString(),
  legacy: true,
};
state.updatedAt = new Date().toISOString();
const tmp = `${path}.part-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
fs.renameSync(tmp, path);
NODE
  chown root:latex-renderer "$image_manager_state"
  chmod 0640 "$image_manager_state"
fi

if [ "$loaded_id" != "$source_image_id" ]; then
  echo "Note: rootless Docker registered a daemon-local image ID; renderer.env was pinned to $loaded_id"
fi

echo "Host preparation complete."
echo "Release: $release_root"
echo "Rootless Docker: $rootless_socket"
echo "Renderer image: $loaded_id"
echo "Services were not started; configure Cloudflare Access and /etc/latex-renderer/renderer.env first."
