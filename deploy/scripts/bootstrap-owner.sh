#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-owner.sh must run as root" >&2
  exit 77
fi

database=/var/lib/latex-renderer/renderer.sqlite3
pepper=/etc/latex-renderer/secrets/api-key-pepper
admin_cli=/opt/latex-renderer/current/apps/admin-local/dist/index.js
owner_email=${LATEX_RENDER_OWNER_EMAIL:-}
owner_name=${LATEX_RENDER_OWNER_NAME:-}
owner_subject=${LATEX_RENDER_OWNER_ACCESS_SUBJECT:-}

if [ -z "$owner_email" ] || [ -z "$owner_name" ] || [ -z "$owner_subject" ]; then
  echo "LATEX_RENDER_OWNER_EMAIL, LATEX_RENDER_OWNER_NAME, and LATEX_RENDER_OWNER_ACCESS_SUBJECT are required" >&2
  exit 64
fi
case "$owner_email$owner_name$owner_subject" in
  *"'"*|*"
"*) echo "owner identity values must not contain quotes or newlines" >&2; exit 64 ;;
esac

if [ ! -f "$pepper" ] || [ ! -f "$admin_cli" ]; then
  echo "host preparation is incomplete" >&2
  exit 66
fi

owner_count=$(sqlite3 "$database" "SELECT COUNT(*) FROM users WHERE role='owner';" 2>/dev/null || printf '0')
if [ "$owner_count" = 0 ]; then
  env \
    DATABASE_PATH="$database" \
    API_KEY_PEPPER_ID=v1 \
    API_KEY_PEPPER_FILE="$pepper" \
    /usr/local/bin/node "$admin_cli" bootstrap \
    --email "$owner_email" \
    --display-name "$owner_name" \
    --access-subject "$owner_subject"
elif [ "$owner_count" = 1 ]; then
  matching_count=$(sqlite3 "$database" "SELECT COUNT(*) FROM users WHERE role='owner' AND email='$owner_email' COLLATE NOCASE AND access_subject='$owner_subject' AND status='active';")
  if [ "$matching_count" != 1 ]; then
    echo "an owner already exists with a different identity" >&2
    exit 73
  fi
  echo "Owner is already bootstrapped with the expected Access identity"
else
  echo "multiple owners already exist; refusing bootstrap automation" >&2
  exit 73
fi

find /var/lib/latex-renderer -maxdepth 1 -type f -name 'renderer.sqlite3*' \
  -exec chown latex-renderer:latex-renderer {} + \
  -exec chmod 0660 {} +

integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;')
if [ "$integrity" != ok ]; then
  echo "database integrity check failed after owner bootstrap" >&2
  exit 70
fi
echo "Owner bootstrap verified for $owner_email"
