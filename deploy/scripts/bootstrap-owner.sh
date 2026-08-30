#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-owner.sh must run as root" >&2
  exit 77
fi

database=/var/lib/latex-renderer/renderer.sqlite3
api_pepper=/etc/latex-renderer/secrets/api-key-pepper
password_pepper=/etc/latex-renderer/secrets/auth-password-pepper
admin_cli=/opt/latex-renderer/current/apps/admin-local/dist/index.js
env_file=/etc/latex-renderer/renderer.env
owner_name=${LATEX_RENDER_OWNER_NAME:-}
owner_email=${LATEX_RENDER_OWNER_EMAIL:-}
auth_mode=$(sed -n 's/^AUTH_MODE=//p' "$env_file" | tail -n 1)

if [ -z "$owner_name" ]; then
  echo "LATEX_RENDER_OWNER_NAME is required" >&2
  exit 64
fi
case "$owner_name$owner_email" in *"'"*|*"
"*) echo "owner attributes must not contain quotes or newlines" >&2; exit 64 ;; esac
case "$auth_mode" in cloudflare-access|oidc|password) ;; *) echo "AUTH_MODE is invalid" >&2; exit 64 ;; esac
if [ ! -f "$api_pepper" ] || [ ! -f "$admin_cli" ]; then
  echo "host preparation is incomplete" >&2
  exit 66
fi
/usr/local/bin/node \
  /opt/latex-renderer/current/deploy/scripts/validate-production-profile.mjs \
  "$env_file"

set -- bootstrap --auth-mode "$auth_mode" --display-name "$owner_name"
[ -z "$owner_email" ] || set -- "$@" --email "$owner_email"
case "$auth_mode" in
  password)
    owner_login=${LATEX_RENDER_OWNER_LOGIN_NAME:-}
    owner_password_file=${LATEX_RENDER_OWNER_PASSWORD_FILE:-}
    if ! printf '%s\n' "$owner_login" | grep -Eq '^[a-z0-9][a-z0-9._-]{2,63}$' || \
       [ -z "$owner_password_file" ] || [ "${owner_password_file#/}" = "$owner_password_file" ] || \
       [ -L "$owner_password_file" ] || [ ! -f "$owner_password_file" ]; then
      echo "Password bootstrap requires a valid LATEX_RENDER_OWNER_LOGIN_NAME and LATEX_RENDER_OWNER_PASSWORD_FILE" >&2
      exit 64
    fi
    password_file_mode=$(stat -c '%a' "$owner_password_file")
    password_file_owner=$(stat -c '%u' "$owner_password_file")
    password_file_size=$(stat -c '%s' "$owner_password_file")
    invoking_uid=${SUDO_UID:-0}
    if [ "$password_file_mode" != 600 ] || \
       { [ "$password_file_owner" != 0 ] && [ "$password_file_owner" != "$invoking_uid" ]; } || \
       [ "$password_file_size" -lt 12 ] || [ "$password_file_size" -gt 4097 ]; then
      echo "Owner password file must be private, bounded, and owned by root or the invoking user" >&2
      exit 78
    fi
    set -- "$@" --login-name "$owner_login" --password-file "$owner_password_file"
    ;;
  cloudflare-access)
    owner_subject=${LATEX_RENDER_OWNER_SUBJECT:-${LATEX_RENDER_OWNER_ACCESS_SUBJECT:-}}
    owner_issuer=$(sed -n 's/^CLOUDFLARE_ACCESS_ISSUER=//p' "$env_file" | tail -n 1)
    [ -n "$owner_subject" ] && [ -n "$owner_issuer" ] || { echo "Cloudflare bootstrap requires LATEX_RENDER_OWNER_SUBJECT and CLOUDFLARE_ACCESS_ISSUER" >&2; exit 64; }
    case "$owner_subject$owner_issuer" in *"'"*|*"
"*) echo "external identity must not contain quotes or newlines" >&2; exit 64 ;; esac
    set -- "$@" --subject "$owner_subject" --issuer "$owner_issuer"
    ;;
  oidc)
    owner_subject=${LATEX_RENDER_OWNER_SUBJECT:-}
    owner_issuer=$(sed -n 's/^OIDC_ISSUER=//p' "$env_file" | tail -n 1)
    [ -n "$owner_subject" ] && [ -n "$owner_issuer" ] || { echo "OIDC bootstrap requires LATEX_RENDER_OWNER_SUBJECT and OIDC_ISSUER" >&2; exit 64; }
    case "$owner_subject$owner_issuer" in *"'"*|*"
"*) echo "external identity must not contain quotes or newlines" >&2; exit 64 ;; esac
    set -- "$@" --subject "$owner_subject" --issuer "$owner_issuer"
    ;;
esac

owner_count=$(sqlite3 "$database" "SELECT COUNT(*) FROM users WHERE role='owner';" 2>/dev/null || printf '0')
if [ "$owner_count" = 0 ]; then
  env \
    DATABASE_PATH="$database" \
    API_KEY_PEPPER_ID=v1 \
    API_KEY_PEPPER_FILE="$api_pepper" \
    AUTH_PASSWORD_PEPPER_FILE="$password_pepper" \
    /usr/local/bin/node "$admin_cli" "$@"
elif [ "$owner_count" = 1 ]; then
  echo "An owner is already bootstrapped; no credentials were changed."
else
  echo "multiple owners already exist; refusing bootstrap automation" >&2
  exit 73
fi

find /var/lib/latex-renderer -maxdepth 1 -type f -name 'renderer.sqlite3*' \
  -exec chown latex-renderer:latex-renderer {} + \
  -exec chmod 0660 {} +
integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;')
[ "$integrity" = ok ] || { echo "database integrity check failed after owner bootstrap" >&2; exit 70; }
echo "Owner bootstrap verified."
