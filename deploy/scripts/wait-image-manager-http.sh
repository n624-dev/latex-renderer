#!/bin/sh
set -eu

endpoint=${IMAGE_MANAGER_URL:-http://127.0.0.1:3110}
token_file=${IMAGE_MANAGER_TOKEN_FILE:-/etc/latex-renderer/secrets/image-manager-token}
attempts=${IMAGE_MANAGER_READY_ATTEMPTS:-60}

case "$endpoint" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL" >&2; exit 78 ;;
esac
case "$attempts" in
  ''|*[!0-9]*) echo "IMAGE_MANAGER_READY_ATTEMPTS must be a positive integer" >&2; exit 64 ;;
esac
[ "$attempts" -gt 0 ] || { echo "IMAGE_MANAGER_READY_ATTEMPTS must be positive" >&2; exit 64; }
[ -f "$token_file" ] || { echo "Image Manager token file not found" >&2; exit 66; }

attempt=0
while [ "$attempt" -lt "$attempts" ]; do
  if curl --fail --silent --show-error \
    --connect-timeout 1 --max-time 2 \
    --header "Authorization: Bearer $(cat "$token_file")" \
    "$endpoint/v1/state" >/dev/null 2>&1; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

echo "Image Manager HTTP endpoint did not become ready" >&2
exit 75
