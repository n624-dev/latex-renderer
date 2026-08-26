#!/bin/sh
set -eu

host=${IMAGE_MANAGER_HOST:-127.0.0.1}
case "$host" in
  127.0.0.1|::1) ;;
  *)
    echo "IMAGE_MANAGER_HOST must be a loopback address" >&2
    exit 78
    ;;
esac

exec /usr/local/bin/node deploy/scripts/image-manager.mjs
