#!/bin/sh
set -eu

endpoint=${IMAGE_MANAGER_URL:-http://127.0.0.1:3110}
attempts=${IMAGE_MANAGER_READY_ATTEMPTS:-60}

case "$endpoint" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL" >&2; exit 78 ;;
esac
case "$attempts" in
  ''|*[!0-9]*) echo "IMAGE_MANAGER_READY_ATTEMPTS must be a positive integer" >&2; exit 64 ;;
esac
[ "$attempts" -gt 0 ] || { echo "IMAGE_MANAGER_READY_ATTEMPTS must be positive" >&2; exit 64; }

attempt=0
while [ "$attempt" -lt "$attempts" ]; do
  # An unauthenticated 401 proves that the loopback HTTP server and its token
  # authentication are ready without exposing the credential in curl argv.
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 1 --max-time 2 \
    "$endpoint/v1/state" 2>/dev/null || true)
  if [ "$status" = "401" ]; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

echo "Image Manager HTTP endpoint did not become ready" >&2
exit 75
