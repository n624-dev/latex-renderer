#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  echo "latex-renderer-update-helper does not accept command-line arguments" >&2
  exit 64
fi
# This starts the fixed helper outside the controller's ProtectSystem mount
# namespace. The controller can write only its state directory; systemd starts
# this short-lived root process with no caller-selected executable or args.
exec /usr/bin/systemd-run --pipe --wait --collect --quiet --service-type=exec \
  /usr/bin/flock --nonblock --exclusive /opt/latex-renderer/update-staging/update-helper.lock \
  /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/update-manager-helper.mjs
