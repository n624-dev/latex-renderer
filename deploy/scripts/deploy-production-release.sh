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
parent_mutation_lock=${LATEX_RENDERER_PARENT_MUTATION_LOCK:-}
# Compatibility for the updater release immediately before the explicit marker
# was introduced. Update Manager passes these fixed service variables to its
# deployment child; a normal sudo deployment has neither one.
if [ -z "$parent_mutation_lock" ] && \
   [ "${UPDATE_MANAGER_STATE_ROOT:-}" = /var/lib/latex-renderer/update-manager ] && \
   [ "${UPDATE_MANAGER_SOCKET:-}" = /run/latex-renderer/update-manager.sock ]; then
  parent_mutation_lock=application-update
fi
case "$parent_mutation_lock" in
  ''|application-update) ;;
  *) echo "LATEX_RENDERER_PARENT_MUTATION_LOCK is invalid" >&2; exit 64 ;;
esac
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$source_root"
build_root=${LATEX_RENDERER_BUILD_ROOT:-$source_root}
case "$build_root" in /*) ;; *) echo "LATEX_RENDERER_BUILD_ROOT must be an absolute path" >&2; exit 64 ;; esac
build_root=$(readlink -f -- "$build_root")
if [ ! -d "$build_root" ]; then
  echo "Deployment build root does not exist: $build_root" >&2
  exit 66
fi
if [ "$parent_mutation_lock" = application-update ]; then
  if [ "$build_root" = "$source_root" ]; then
    echo "Application Update Manager must use a separate non-root build tree" >&2
    exit 78
  fi
  if ! /usr/local/bin/node \
    "$source_root/deploy/scripts/release-assembly.mjs" \
    --assert-sealed-control-tree "$source_root"; then
    echo "Application Update Manager control tree is not sealed" >&2
    exit 78
  fi
fi
temporary_root=$(mktemp -d /tmp/latex-renderer-deploy.XXXXXX)
admin_local_root=
client_smoke_root=
mcpb_verify_root=
gateway_runtime_config=
deployment_quiesced=false
deployment_finished=false

restore_services_after_failure() {
  recovery_failed=false
  echo "Deployment did not finish; restoring local services on the active release." >&2
  systemctl start latex-renderer-update-manager.service >/dev/null 2>&1 || recovery_failed=true
  systemctl start latex-renderer-image-manager.service >/dev/null 2>&1 || recovery_failed=true
  systemctl restart \
    latex-renderer-api.service \
    latex-renderer-internal-api.service \
    latex-renderer-admin-api.service \
    latex-renderer-admin-web.service \
    latex-renderer-remote-mcp.service \
    latex-renderer-worker.service >/dev/null 2>&1 || recovery_failed=true
  systemctl start \
    latex-renderer-update-refresh.timer \
    latex-renderer-image-refresh.timer \
    latex-renderer-image-operation-watchdog.timer \
    latex-renderer-image-log-cleanup.timer >/dev/null 2>&1 || recovery_failed=true
  if [ "$recovery_failed" = true ]; then
    echo "One or more local services could not be restored; inspect systemd state before retrying." >&2
  else
    echo "Local services restored after deployment failure." >&2
  fi
}

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  [ -z "$gateway_runtime_config" ] || rm -f -- "$gateway_runtime_config"
  [ -z "$admin_local_root" ] || rm -rf -- "$admin_local_root"
  [ -z "$client_smoke_root" ] || rm -rf -- "$client_smoke_root"
  [ -z "$mcpb_verify_root" ] || rm -rf -- "$mcpb_verify_root"
  rm -rf -- "$temporary_root"
  if [ "$deployment_quiesced" = true ] && [ "$deployment_finished" != true ]; then
    restore_services_after_failure
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

environment_file=/etc/latex-renderer/renderer.env
if [ ! -f "$environment_file" ]; then
  echo "renderer environment file not found: $environment_file" >&2
  exit 66
fi
preflight_auth_mode=$(sed -n 's/^AUTH_MODE=//p' "$environment_file" | tail -n 1)
if [ "$preflight_auth_mode" = password ] && \
   [ ! -f /etc/latex-renderer/secrets/auth-password-pepper ]; then
  (umask 077; dd if=/dev/urandom \
    of=/etc/latex-renderer/secrets/auth-password-pepper \
    bs=32 count=1 status=none)
  chown root:latex-renderer \
    /etc/latex-renderer/secrets/auth-password-pepper
  chmod 0440 /etc/latex-renderer/secrets/auth-password-pepper
fi
/usr/local/bin/node "$source_root/deploy/scripts/validate-production-profile.mjs" \
  "$environment_file"
deployment_mode=$(sed -n 's/^DEPLOYMENT_MODE=//p' "$environment_file" | tail -n 1)
case "$deployment_mode" in cloudflare|standalone) ;; *) echo "DEPLOYMENT_MODE must be cloudflare or standalone" >&2; exit 65 ;; esac
if [ "$deployment_mode" = cloudflare ]; then
  deployment_environment_file=${LATEX_RENDERER_DEPLOYMENT_ENV_FILE:-/etc/latex-renderer/deployment.env}
  case "$deployment_environment_file" in /*) ;; *) echo "LATEX_RENDERER_DEPLOYMENT_ENV_FILE must be an absolute path" >&2; exit 64 ;; esac
  if [ ! -f "$deployment_environment_file" ]; then
    echo "deployment environment file not found: $deployment_environment_file" >&2
    exit 66
  fi
  deployment_environment_file=$(readlink -f -- "$deployment_environment_file")
  case "$deployment_environment_file" in "$source_root"/*) echo "Production deployment environment must be stored outside the Git worktree" >&2; exit 78 ;; esac
  if [ "$(stat -c '%u:%a' "$deployment_environment_file")" != "0:600" ]; then
    echo "Production deployment environment must be owned by root with mode 0600" >&2
    exit 78
  fi
  set -a
  # This is trusted root-owned shell syntax so values can be quoted safely.
  . "$deployment_environment_file"
  set +a
fi
auth_mode=$(sed -n 's/^AUTH_MODE=//p' "$environment_file" | tail -n 1)
case "$auth_mode" in cloudflare-access|oidc|password) ;; *) echo "AUTH_MODE must be cloudflare-access, oidc, or password" >&2; exit 65 ;; esac
if [ "$deployment_mode" = standalone ] && [ "$auth_mode" = cloudflare-access ]; then
  echo "AUTH_MODE=cloudflare-access requires DEPLOYMENT_MODE=cloudflare" >&2
  exit 65
fi
if [ "$deployment_mode" = cloudflare ]; then
  if ! printf '%s\n' "${CLOUDFLARE_ACCOUNT_ID:-}" | grep -Eq '^[0-9a-fA-F]{32}$'; then
    echo "CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID" >&2
    exit 65
  fi
  if ! printf '%s\n' "${CLOUDFLARE_TUNNEL_ID:-}" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
    echo "CLOUDFLARE_TUNNEL_ID must be a UUID" >&2
    exit 65
  fi
  case "${CLOUDFLARE_ZONE_NAME:-}" in *.*) ;; *) echo "CLOUDFLARE_ZONE_NAME must be a DNS zone name" >&2; exit 65 ;; esac
  gateway_worker_config=${GATEWAY_WORKER_CONFIG_FILE:-/etc/latex-renderer/gateway-worker.wrangler.jsonc}
  case "$gateway_worker_config" in /*) ;; *) echo "GATEWAY_WORKER_CONFIG_FILE must be an absolute path" >&2; exit 64 ;; esac
  if [ ! -f "$gateway_worker_config" ]; then
    echo "Gateway Worker configuration file not found: $gateway_worker_config" >&2
    exit 66
  fi
  gateway_worker_config=$(readlink -f -- "$gateway_worker_config")
  case "$gateway_worker_config" in "$source_root"/*) echo "Gateway Worker production configuration must be stored outside the Git worktree" >&2; exit 78 ;; esac
  if [ "$(stat -c '%u:%a' "$gateway_worker_config")" != "0:600" ]; then
    echo "Gateway Worker production configuration must be owned by root with mode 0600" >&2
    exit 78
  fi
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
if [ "$deployment_mode" = cloudflare ]; then
  gateway_runtime_config=$(mktemp "$build_root/apps/gateway-worker/.wrangler.production.XXXXXX.jsonc")
  install -o "$sync_user" -g "$sync_group" -m 0600 "$gateway_worker_config" "$gateway_runtime_config"
fi

if [ "$build_root" = "$source_root" ]; then
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    "$sync_pnpm_bin/pnpm" --dir "$build_root" build:production-services
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    "$sync_pnpm_bin/pnpm" --dir "$build_root" build:client
fi
[ -f "$build_root/client-dist/manifest.json" ] || {
  echo "production client distribution was not generated before release copy" >&2
  exit 70
}

# Freeze all TeX environment mutations before prepare-host changes the current
# release symlink, renderer.env, inventory, or persisted Image Manager state.
# The quiesce helper is backward-compatible with the release immediately before
# /v1/quiesce by stopping normal mutation callers before checking active state.
sh "$source_root/deploy/scripts/quiesce-image-manager.sh"
deployment_quiesced=true
"$source_root/deploy/scripts/prepare-host.sh" "$release_id"
if [ "$deployment_mode" = cloudflare ]; then
  /opt/latex-renderer/current/deploy/scripts/configure-host-access.sh
fi

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

admin_local_root=$(mktemp -d /tmp/latex-renderer-admin-local.XXXXXX)
chown latex-renderer:latex-renderer "$admin_local_root"
chmod 0700 "$admin_local_root"
install -o latex-renderer -g latex-renderer -m 0400 \
  /etc/latex-renderer/secrets/api-key-pepper \
  "$admin_local_root/api-key-pepper"
runuser -u latex-renderer -- env \
  DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
  API_KEY_PEPPER_ID=v1 \
  API_KEY_PEPPER_FILE="$admin_local_root/api-key-pepper" \
  LATEX_RENDERER_ADMIN_GID="$(id -g latex-renderer)" \
  /usr/local/bin/node /opt/latex-renderer/current/apps/admin-local/dist/index.js \
  web-principals ensure --yes

systemctl daemon-reload
systemctl enable --now latex-renderer-update-manager.service
/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh
systemctl restart latex-renderer-image-manager
systemctl is-active --quiet latex-renderer-image-manager
if [ "$parent_mutation_lock" = application-update ]; then
  echo "Application update owns the shared mutation lock; Image Manager startup restored the saved TeX Runtime."
else
  /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/reconcile-managed-runtime.mjs
fi
systemctl restart \
  latex-renderer-api \
  latex-renderer-internal-api \
  latex-renderer-admin-api \
  latex-renderer-admin-web \
  latex-renderer-remote-mcp \
  latex-renderer-worker
if [ "$deployment_mode" = standalone ]; then
  systemctl enable --now latex-renderer-standalone-gateway.service
else
  systemctl disable --now latex-renderer-standalone-gateway.service >/dev/null 2>&1 || true
fi
systemctl enable --now \
  latex-renderer-remote-mcp.service \
  latex-renderer-update-refresh.timer \
  latex-renderer-image-refresh.timer \
  latex-renderer-image-operation-watchdog.timer \
  latex-renderer-image-log-cleanup.timer

for unit in latex-renderer-update-manager latex-renderer-image-manager latex-renderer-api latex-renderer-internal-api latex-renderer-admin-api latex-renderer-admin-web latex-renderer-remote-mcp latex-renderer-worker; do
  systemctl is-active --quiet "$unit"
done
if [ "$deployment_mode" = standalone ]; then
  systemctl is-active --quiet latex-renderer-standalone-gateway
fi
for timer in latex-renderer-update-refresh.timer latex-renderer-image-refresh.timer latex-renderer-image-operation-watchdog.timer latex-renderer-image-log-cleanup.timer; do
  systemctl is-active --quiet "$timer"
done
/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh

if [ "$deployment_mode" = cloudflare ]; then
  systemctl is-active --quiet cloudflared
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    "$sync_pnpm_bin/pnpm" --dir "$build_root" --filter @latex-renderer/gateway-worker exec wrangler deploy --config "$gateway_runtime_config"
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    "$sync_pnpm_bin/pnpm" --dir "$build_root" --filter @latex-renderer/public-web run deploy
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    /usr/local/bin/node "$source_root/deploy/scripts/sync-public-worker-routes.mjs" --apply
fi

client_base="$public_origin/downloads/client"
mcpb_base="$public_origin/downloads/mcpb"
local_manifest_path="$build_root/apps/public-web/dist/downloads/client/manifest.json"
archive_path="$temporary_root/client-archive.zip"
actual_hash=$(/usr/local/bin/node "$source_root/deploy/scripts/verify-public-client-assets.mjs" \
  "$client_base" "$local_manifest_path" "$archive_path" "$release_id")
unzip -t "$archive_path" >/dev/null
mcpb_hash=$(/usr/local/bin/node "$source_root/deploy/scripts/verify-public-mcpb-assets.mjs" \
  "$mcpb_base" "$build_root/apps/public-web/dist/downloads/mcpb/mcpb.json" \
  "$temporary_root/latex-renderer-local.mcpb" "$release_id")
mcpb_verify_root=$(mktemp -d /tmp/latex-renderer-mcpb-verify.XXXXXX)
chown "$sync_user:$sync_group" "$mcpb_verify_root"
chmod 0700 "$mcpb_verify_root"
install -o "$sync_user" -g "$sync_group" -m 0600 \
  "$temporary_root/latex-renderer-local.mcpb" \
  "$mcpb_verify_root/latex-renderer-local.mcpb"
runuser -u "$sync_user" -- /usr/local/bin/node \
  "$source_root/client/verify-mcpb.mjs" \
  "$mcpb_verify_root/latex-renderer-local.mcpb"
cache_buster="release=$release_id&fresh=$(date +%s)"
curl --fail --silent --show-error "$client_base/install.mjs?$cache_buster" | grep -q 'installDistribution'
curl --fail --silent --show-error "$public_origin/downloads/?$cache_buster" | grep -q '最新版ZIP'

client_smoke_root=$(mktemp -d /tmp/latex-renderer-client-smoke.XXXXXX)
chown "$sync_user:$sync_group" "$client_smoke_root"
chmod 0700 "$client_smoke_root"
curl --fail --silent --show-error \
  "$client_base/install.mjs?$cache_buster" \
  --output "$client_smoke_root/client-install.mjs"
curl --fail --silent --show-error \
  "$client_base/uninstall.mjs?$cache_buster" \
  --output "$client_smoke_root/client-uninstall.mjs"
chown "$sync_user:$sync_group" \
  "$client_smoke_root/client-install.mjs" \
  "$client_smoke_root/client-uninstall.mjs"
runuser -u "$sync_user" -- /usr/local/bin/node "$client_smoke_root/client-install.mjs" \
  --base-uri "$client_base/" \
  --install-directory "$client_smoke_root/client" \
  --bin-directory "$client_smoke_root/bin" \
  --skill-target none \
  --mcp-target none \
  --json > "$client_smoke_root/setup.json"
runuser -u "$sync_user" -- env PATH="$client_smoke_root/bin:$PATH" \
  "$client_smoke_root/bin/latex-render" doctor --json > "$client_smoke_root/doctor.json"
/usr/local/bin/node -e '
  const fs=require("node:fs");
  for(const file of process.argv.slice(1)){
    const value=JSON.parse(fs.readFileSync(file,"utf8"));
    const serialized=JSON.stringify(value);
    if(value.success!==true||/apiKey|uploadTicket|jobTicket|lrk_/i.test(serialized))process.exit(1);
  }
' "$client_smoke_root/setup.json" "$client_smoke_root/doctor.json"
runuser -u "$sync_user" -- /usr/local/bin/node "$client_smoke_root/client-uninstall.mjs" \
  --install-directory "$client_smoke_root/client" \
  --bin-directory "$client_smoke_root/bin" \
  --keep-credential \
  --keep-skills \
  --json > "$client_smoke_root/remove.json"
/usr/local/bin/node -e '
  const value=require(process.argv[1]);
  if(value.success!==true||value.command!=="setup.remove"||value.result?.removed!==true)process.exit(1);
' "$client_smoke_root/remove.json"
test ! -e "$client_smoke_root/client"
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

active_owner_count=$(sqlite3 /var/lib/latex-renderer/renderer.sqlite3 \
  "SELECT COUNT(*) FROM users WHERE role='owner' AND status='active';")
if [ "$active_owner_count" -gt 0 ]; then
  LATEX_RENDER_BASE_URL="$public_origin" \
    /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
else
  echo "No active owner exists yet; authenticated render smoke is deferred until owner bootstrap."
fi
if [ "$deployment_mode" = cloudflare ]; then
  runuser -u "$sync_user" -- env HOME="$sync_home" USER="$sync_user" LOGNAME="$sync_user" PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path" \
    /usr/local/bin/node "$source_root/deploy/scripts/sync-cloudflare-tunnel-config.mjs" --apply
  LATEX_RENDER_BASE_URL="$public_origin" \
    "$source_root/deploy/scripts/smoke-test-public-worker-boundary.sh"
fi

/opt/latex-renderer/current/deploy/scripts/prune-production-artifacts.sh "$release_id"

deployment_finished=true
echo "Production release deployed and verified: $release_id"
echo "Cross-platform installer: $client_base/install.mjs"
echo "Windows PowerShell installer: $public_origin/downloads/windows/install.ps1"
echo "Client archive SHA-256: $actual_hash"
echo "Claude Desktop MCPB: $mcpb_base/latest.mcpb"
echo "MCPB SHA-256: $mcpb_hash"
