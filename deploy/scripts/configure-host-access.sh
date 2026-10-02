#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "configure-host-access.sh must run as root" >&2
  exit 77
fi

env_file=/etc/latex-renderer/renderer.env
if [ ! -f "$env_file" ]; then
  echo "renderer environment file not found: $env_file" >&2
  exit 66
fi

upsert_setting() {
  key=$1
  value=$2
  escaped_value=$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')
  if grep -q "^$key=" "$env_file"; then
    sed -i "s|^$key=.*|$key=$escaped_value|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

profile_validator=/opt/latex-renderer/current/deploy/scripts/validate-production-profile.mjs
profile_plan=$(/usr/local/bin/node "$profile_validator" "$env_file" --plan)
profile_field() {
  /usr/local/bin/node "$profile_validator" --plan-field "$1" "$profile_plan"
}
deployment_mode=$(profile_field deploymentMode)
[ "$deployment_mode" = cloudflare ] || {
  echo "configure-host-access.sh requires DEPLOYMENT_MODE=cloudflare" >&2
  exit 65
}
public_origin=$(profile_field publicOrigin)

upsert_setting CLIENT_DIST_ROOT /opt/latex-renderer/current/client-dist
upsert_setting ADMIN_API_URL "$public_origin"
upsert_setting RENDERER_PUBLIC_URL "$public_origin"

# Secrets are supplied by systemd credentials and must not be present in the
# shared EnvironmentFile.
sed -i '/^API_KEY_PEPPER_FILE=/d' "$env_file"
sed -i '/^ADMIN_ALLOWED_ORIGINS=/d' "$env_file"
sed -i '/^CLOUDFLARE_INTERNAL_AUDIENCE=/d;/^CLOUDFLARE_INTERNAL_SERVICE_TOKEN_ID=/d' "$env_file"

chown root:latex-renderer "$env_file"
chmod 0640 "$env_file"
echo "Unified Cloudflare Access host settings updated in $env_file"
