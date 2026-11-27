#!/bin/sh
set -eu

root=/opt/latex-renderer/host-runtime
if [ ! -d "$root" ]; then
  exit 0
fi

node=/usr/local/bin/node
if [ -L "$root/confirmed" ]; then
  node=$root/confirmed/bin/node
fi
exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  "$node" /opt/latex-renderer/current/deploy/scripts/refresh-host-runtime.mjs "$@"
