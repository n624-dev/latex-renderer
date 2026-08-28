#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-production-release.sh must run as root" >&2
  exit 77
fi
if [ "$#" -ne 1 ]; then
  echo "usage: deploy-production-release.sh RELEASE_ID" >&2
  exit 64
fi

release_id=$1
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$source_root"
temporary_root=$(mktemp -d /tmp/latex-renderer-deploy.XXXXXX)
gateway_runtime_config=
cleanup() {
  [ -z "$gateway_runtime_config" ] || rm -f -- "$gateway_runtime_config"
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT INT TERM HUP

environment_file=/etc/latex-renderer/renderer.env
if [ ! -f "$environment_file" ]; then
  echo "renderer environment file not found: $environment_file" >&2
  exit 66
fi
deployment_environment_file=${LATEX_RENDERER_DEPLOYMENT_ENV_FILE:-/etc/latex-renderer/deployment.env}
case "$deployment_environment_file" in
  /*) ;;
  *) echo "LATEX_RENDERER_DEPLOYMENT_ENV_FILE must be an absolute path" >&2; exit 64 ;;
esac
if [ ! -f "$deployment_environment_file" ]; then
  echo "deployment environment file not found: $deployment_environment_file" >&2
  exit 66
fi
deployment_environment_file=$(readlink -f -- "$deployment_environment_file")
case "$deployment_environment_file" in
  "$source_root"/*) echo "Production deployment environment must be stored outside the Git worktree" >&2; exit 78 ;;
esac
if [ "$(stat -c '%u:%a' "$deployment_environment_file")" != "0:600" ]; then
  echo "Production deployment environment must be owned by root with mode 0600" >&2
  exit 78
fi
set -a
# This is trusted root-owned shell syntax so values can be quoted safely.
. "$deployment_environment_file"
set +a
if ! printf '%s\n' "${CLOUDFLARE_ACCOUNT_ID:-}" | grep -Eq '^[0-9a-fA-F]{32}$'; then
  echo "CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID" >&2
  exit 65
fi
if ! printf '%s\n' "${CLOUDFLARE_TUNNEL_ID:-}" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
  echo "CLOUDFLARE_TUNNEL_ID must be a UUID" >&2
  exit 65
fi
case "${CLOUDFLARE_ZONE_NAME:-}" in
  *.*) ;;
  *) echo "CLOUDFLARE_ZONE_NAME must be a DNS zone name" >&2; exit 65 ;;
esac
gateway_worker_config=${GATEWAY_WORKER_CONFIG_FILE:-/etc/latex-renderer/gateway-worker.wrangler.jsonc}
case "$gateway_worker_config" in
  /*) ;;
  *) echo "GATEWAY_WORKER_CONFIG_FILE must be an absolute path" >&2; exit 64 ;;
esac
if [ ! -f "$gateway_worker_config" ]; then
  echo "Gateway Worker configuration file not found: $gateway_worker_config" >&2
  exit 66
fi
gateway_worker_config=$(readlink -f -- "$gateway_worker_config")
case "$gateway_worker_config" in
  "$source_root"/*) echo "Gateway Worker production configuration must be stored outside the Git worktree" >&2; exit 78 ;;
esac
if [ "$(stat -c '%u:%a' "$gateway_worker_config")" != "0:600" ]; then
  echo "Gateway Worker production configuration must be owned by root with mode 0600" >&2
  exit 78
fi
public_origin=$(sed -n 's/^PUBLIC_ORIGIN=//p' "$environment_file" | tail -n 1)
case "$public_origin" in
  https://*) ;;
  *) echo "PUBLIC_ORIGIN must be configured as an HTTPS origin in $environment_file" >&2; exit 65 ;;
esac
export PUBLIC_ORIGIN="$public_origin"

sync_user=${SUDO_USER:-$(stat -c '%U' "$source_root")}
sync_home=$(getent passwd "$sync_user" | cut -d: -f6)
sync_pnpm_bin="$sync_home/.local/share/pnpm/bin"
if [ ! -x "$sync_pnpm_bin/pnpm" ]; then
  echo "pnpm executable not found for deployment user: $sync_pnpm_bin/pnpm" >&2
  exit 69
fi
sync_path="$sync_pnpm_bin:/usr/local/bin:/usr/bin:/bin"
sync_group=$(id -gn "$sync_user")
gateway_runtime_config=$(mktemp "$source_root/apps/gateway-worker/.wrangler.production.XXXXXX.jsonc")
install -o "$sync_user" -g "$sync_group" -m 0600 "$gateway_worker_config" "$gateway_runtime_config"

runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  "$sync_pnpm_bin/pnpm" --dir "$source_root" build:production-services
runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  "$sync_pnpm_bin/pnpm" --dir "$source_root" build:client
[ -f "$source_root/client-dist/manifest.json" ] || {
  echo "production client distribution was not generated before release copy" >&2
  exit 70
}

# Freeze all TeX environment mutations before prepare-host changes the current
# release symlink, renderer.env, inventory, or persisted Image Manager state.
# The quiesce helper is backward-compatible with the release immediately before
# /v1/quiesce by stopping normal mutation callers before checking active state.
sh "$source_root/deploy/scripts/quiesce-image-manager.sh"
"$source_root/deploy/scripts/prepare-host.sh" "$release_id"
/opt/latex-renderer/current/deploy/scripts/configure-host-access.sh

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

env \
  DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
  API_KEY_PEPPER_ID=v1 \
  API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
  /usr/local/bin/node /opt/latex-renderer/current/apps/admin-local/dist/index.js \
  web-principals ensure --yes

systemctl daemon-reload
systemctl enable --now latex-renderer-update-manager.service
/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh
systemctl restart latex-renderer-image-manager
systemctl is-active --quiet latex-renderer-image-manager
/usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/reconcile-managed-runtime.mjs
systemctl restart \
  latex-renderer-api \
  latex-renderer-internal-api \
  latex-renderer-admin-api \
  latex-renderer-admin-web \
  latex-renderer-remote-mcp \
  latex-renderer-worker
systemctl enable --now \
  latex-renderer-remote-mcp.service \
  latex-renderer-update-refresh.timer \
  latex-renderer-image-refresh.timer \
  latex-renderer-image-operation-watchdog.timer \
  latex-renderer-image-log-cleanup.timer

for unit in latex-renderer-update-manager latex-renderer-image-manager latex-renderer-api latex-renderer-internal-api latex-renderer-admin-api latex-renderer-admin-web latex-renderer-remote-mcp latex-renderer-worker; do
  systemctl is-active --quiet "$unit"
done
for timer in latex-renderer-update-refresh.timer latex-renderer-image-refresh.timer latex-renderer-image-operation-watchdog.timer latex-renderer-image-log-cleanup.timer; do
  systemctl is-active --quiet "$timer"
done
/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh

systemctl is-active --quiet cloudflared

runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  "$sync_pnpm_bin/pnpm" --dir "$source_root" --filter @latex-renderer/gateway-worker exec wrangler deploy --config "$gateway_runtime_config"
runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  "$sync_pnpm_bin/pnpm" --dir "$source_root" --filter @latex-renderer/public-web run deploy
runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  /usr/local/bin/node "$source_root/deploy/scripts/sync-public-worker-routes.mjs" --apply

client_base="$public_origin/downloads/client"
mcpb_base="$public_origin/downloads/mcpb"
local_manifest_path="$source_root/apps/public-web/dist/downloads/client/manifest.json"
archive_path="$temporary_root/client-archive.zip"
actual_hash=$(/usr/local/bin/node "$source_root/deploy/scripts/verify-public-client-assets.mjs" \
  "$client_base" "$local_manifest_path" "$archive_path" "$release_id")
unzip -t "$archive_path" >/dev/null
mcpb_hash=$(/usr/local/bin/node "$source_root/deploy/scripts/verify-public-mcpb-assets.mjs" \
  "$mcpb_base" "$source_root/apps/public-web/dist/downloads/mcpb/mcpb.json" \
  "$temporary_root/latex-renderer-local.mcpb" "$release_id")
/usr/local/bin/node "$source_root/client/verify-mcpb.mjs" \
  "$temporary_root/latex-renderer-local.mcpb"
cache_buster="release=$release_id&fresh=$(date +%s)"
curl --fail --silent --show-error "$client_base/install.mjs?$cache_buster" | grep -q 'installDistribution'
curl --fail --silent --show-error "$public_origin/downloads/?$cache_buster" | grep -q '最新版ZIP'

curl --fail --silent --show-error \
  "$client_base/install.mjs?$cache_buster" \
  --output "$temporary_root/client-install.mjs"
curl --fail --silent --show-error \
  "$client_base/uninstall.mjs?$cache_buster" \
  --output "$temporary_root/client-uninstall.mjs"
/usr/local/bin/node "$temporary_root/client-install.mjs" \
  --base-uri "$client_base/" \
  --install-directory "$temporary_root/client" \
  --bin-directory "$temporary_root/bin" \
  --skill-target none \
  --mcp-target none \
  --json > "$temporary_root/setup.json"
env PATH="$temporary_root/bin:$PATH" \
  "$temporary_root/bin/latex-render" doctor --json > "$temporary_root/doctor.json"
/usr/local/bin/node -e '
  const fs=require("node:fs");
  for(const file of process.argv.slice(1)){
    const value=JSON.parse(fs.readFileSync(file,"utf8"));
    const serialized=JSON.stringify(value);
    if(value.success!==true||/apiKey|uploadTicket|jobTicket|lrk_/i.test(serialized))process.exit(1);
  }
' "$temporary_root/setup.json" "$temporary_root/doctor.json"
/usr/local/bin/node "$temporary_root/client-uninstall.mjs" \
  --install-directory "$temporary_root/client" \
  --bin-directory "$temporary_root/bin" \
  --keep-credential \
  --keep-skills \
  --json > "$temporary_root/remove.json"
/usr/local/bin/node -e '
  const value=require(process.argv[1]);
  if(value.success!==true||value.command!=="setup.remove"||value.result?.removed!==true)process.exit(1);
' "$temporary_root/remove.json"
test ! -e "$temporary_root/client"
curl --fail --silent --show-error http://127.0.0.1:3101/ | grep -q 'LaTeXをPDFに変換'
curl --fail --silent --show-error http://127.0.0.1:3101/admin/ | grep -q 'data-page="dashboard"'
curl --fail --silent --show-error http://127.0.0.1:3101/admin/tex-environment/ | grep -q 'data-page="tex"'
curl --fail --silent --show-error http://127.0.0.1:3104/health | grep -q '"status":"ok"'
attempt=0
until curl --fail --silent --show-error "$public_origin/status/?$cache_buster&attempt=$attempt" | grep -q 'レンダリング処理：応答中'; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 10 ] || { echo "Public rendering status did not become healthy" >&2; exit 1; }
  sleep 2
done

LATEX_RENDER_BASE_URL="$public_origin" /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
  /usr/local/bin/node "$source_root/deploy/scripts/sync-cloudflare-tunnel-config.mjs" --apply
LATEX_RENDER_BASE_URL="$public_origin" "$source_root/deploy/scripts/smoke-test-public-worker-boundary.sh"

/opt/latex-renderer/current/deploy/scripts/prune-production-artifacts.sh "$release_id"

echo "Production release deployed and verified: $release_id"
echo "Cross-platform installer: $client_base/install.mjs"
echo "Windows PowerShell installer: $public_origin/downloads/windows/install.ps1"
echo "Client archive SHA-256: $actual_hash"
echo "Claude Desktop MCPB: $mcpb_base/latest.mcpb"
echo "MCPB SHA-256: $mcpb_hash"
