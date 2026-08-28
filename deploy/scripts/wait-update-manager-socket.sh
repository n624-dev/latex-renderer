#!/bin/sh
set -eu

socket_path=${UPDATE_MANAGER_SOCKET:-/run/latex-renderer/update-manager.sock}
attempts=${UPDATE_MANAGER_READY_ATTEMPTS:-30}
retry_delay=${UPDATE_MANAGER_READY_RETRY_SECONDS:-1}

case "$socket_path" in
  /run/latex-renderer/*) ;;
  *) echo "Update Manager socket must remain below /run/latex-renderer" >&2; exit 64 ;;
esac
case "$attempts" in
  ''|*[!0-9]*|0) echo "UPDATE_MANAGER_READY_ATTEMPTS must be a positive integer" >&2; exit 64 ;;
esac
case "$retry_delay" in
  ''|*[!0-9]*|0) echo "UPDATE_MANAGER_READY_RETRY_SECONDS must be a positive integer" >&2; exit 64 ;;
esac

attempt=1
while [ "$attempt" -le "$attempts" ]; do
  systemctl is-active --quiet latex-renderer-update-manager.service || {
    echo "Update Manager service stopped before its socket became ready" >&2
    exit 1
  }
  if [ -S "$socket_path" ]; then
    echo "Update Manager socket is ready."
    exit 0
  fi
  [ "$attempt" -lt "$attempts" ] || break
  sleep "$retry_delay"
  attempt=$((attempt + 1))
done

echo "Update Manager socket did not become ready after $attempts attempts" >&2
exit 1
