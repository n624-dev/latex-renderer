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

require_configured_setting() {
  key=$1
  value=$(sed -n "s|^$key=||p" "$env_file" | tail -n 1)
  case "$value" in
    ''|REPLACE_*|*example.com*|*your-team*)
      echo "$key must be configured in $env_file before deployment" >&2
      exit 65
      ;;
  esac
}

upsert_setting() {
  key=$1
  value=$2
  if grep -q "^$key=" "$env_file"; then
    sed -i "s|^$key=.*|$key=$value|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

upsert_setting CLIENT_DIST_ROOT /opt/latex-renderer/current/client-dist
for key in PUBLIC_ORIGIN CLOUDFLARE_ACCESS_ISSUER CLOUDFLARE_ADMIN_AUDIENCE CLOUDFLARE_REMOTE_MCP_AUDIENCE ADMIN_ALLOWED_ORIGINS ADMIN_API_URL RENDERER_PUBLIC_URL; do
  require_configured_setting "$key"
done

# Secrets are supplied by systemd credentials and must not be present in the
# shared EnvironmentFile.
sed -i '/^API_KEY_PEPPER_FILE=/d' "$env_file"
sed -i '/^CLOUDFLARE_INTERNAL_AUDIENCE=/d;/^CLOUDFLARE_INTERNAL_SERVICE_TOKEN_ID=/d' "$env_file"

chown root:latex-renderer "$env_file"
chmod 0640 "$env_file"
echo "Unified Cloudflare Access host settings updated in $env_file"
