#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "quiesce-image-manager.sh must run as root" >&2
  exit 77
fi

manager_unit=latex-renderer-image-manager.service
admin_unit=latex-renderer-admin-api.service
refresh_timer=latex-renderer-image-refresh.timer
watchdog_timer=latex-renderer-image-operation-watchdog.timer
token_file=${IMAGE_MANAGER_TOKEN_FILE:-/etc/latex-renderer/secrets/image-manager-token}
manager_url=${IMAGE_MANAGER_URL:-http://127.0.0.1:3110}

is_active() {
  systemctl is-active --quiet "$1"
}

admin_was_active=false
refresh_was_active=false
watchdog_was_active=false
is_active "$admin_unit" && admin_was_active=true
is_active "$refresh_timer" && refresh_was_active=true
is_active "$watchdog_timer" && watchdog_was_active=true

restore_preflight_services() {
  [ "$admin_was_active" = true ] && systemctl start "$admin_unit" >/dev/null 2>&1 || true
  [ "$refresh_was_active" = true ] && systemctl start "$refresh_timer" >/dev/null 2>&1 || true
  [ "$watchdog_was_active" = true ] && systemctl start "$watchdog_timer" >/dev/null 2>&1 || true
}

# Stop every normal caller that can start a new Image Manager mutation before
# checking the operation lock. This also makes the one-time upgrade from the
# pre-quiesce Image Manager safe.
systemctl stop "$refresh_timer" "$watchdog_timer" >/dev/null 2>&1 || true
systemctl stop "$admin_unit" >/dev/null 2>&1 || true

if ! is_active "$manager_unit"; then
  echo "Image Manager is not active; deployment preflight has nothing to quiesce."
  exit 0
fi
if [ ! -r "$token_file" ]; then
  restore_preflight_services
  echo "Image Manager token is unavailable: $token_file" >&2
  exit 78
fi

token=$(cat "$token_file")
request() {
  method=$1
  path=$2
  output=$3
  status=$(curl --silent --show-error \
    --connect-timeout 5 --max-time 30 \
    --output "$output" --write-out '%{http_code}' \
    --request "$method" \
    --header "Authorization: Bearer $token" \
    --header 'Accept: application/json' \
    --header 'Content-Type: application/json' \
    --data '{}' \
    "$manager_url$path") || return 1
  printf '%s\n' "$status"
}

tmp=$(mktemp /tmp/latex-renderer-image-quiesce.XXXXXX)
trap 'rm -f -- "$tmp"' EXIT HUP INT TERM
status=$(request POST /v1/quiesce "$tmp") || {
  restore_preflight_services
  echo "Could not contact Image Manager for deployment quiesce" >&2
  exit 75
}

if [ "$status" = 404 ]; then
  # Compatibility path for the release immediately preceding the quiesce API.
  # Admin mutations and refresh timers are already stopped, so a successful
  # activeOperationId check can be followed directly by stopping the manager.
  status=$(request GET /v1/state "$tmp") || {
    restore_preflight_services
    echo "Could not read legacy Image Manager state" >&2
    exit 75
  }
  if [ "$status" != 200 ] || ! jq -e '.activeOperationId == null' "$tmp" >/dev/null 2>&1; then
    restore_preflight_services
    echo "Refusing deployment while a TeX image operation is active" >&2
    cat "$tmp" >&2 || true
    exit 75
  fi
elif [ "$status" != 200 ] || ! jq -e '.quiescing == true' "$tmp" >/dev/null 2>&1; then
  restore_preflight_services
  echo "Refusing deployment because Image Manager could not enter quiescing state" >&2
  cat "$tmp" >&2 || true
  exit 75
fi

if ! systemctl stop "$manager_unit"; then
  systemctl restart "$manager_unit" >/dev/null 2>&1 || true
  restore_preflight_services
  echo "Could not stop Image Manager after quiescing" >&2
  exit 75
fi

trap - EXIT HUP INT TERM
rm -f -- "$tmp"
echo "Image Manager quiesced and stopped for production deployment."
