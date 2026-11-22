#!/bin/sh
# Managed LaTeX Renderer server launcher
set -eu

if [ "${1-}" = server ]; then
  shift
  if [ "$(id -u)" -ne 0 ]; then
    echo 'Use sudo for n624-latex server commands.' >&2
    exit 77
  fi
  if [ ! -f /opt/latex-renderer/current/deploy/scripts/n624-latex-server.mjs ]; then
    if [ -x /usr/bin/n624-latex ]; then exec /usr/bin/n624-latex server "$@"; fi
    if [ "$*" = 'recovery status' ]; then
      exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin +        /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status
    fi
    echo 'This application release uses the legacy server setup guide.' >&2
    exit 69
  fi
  exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
    TERM="${TERM:-dumb}" SUDO_USER="${SUDO_USER:-}" \
    /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/n624-latex-server.mjs "$@"
fi
if [ -x /usr/bin/n624-latex ]; then
  exec /usr/bin/n624-latex "$@"
fi
export N624_LATEX_COMMAND=1
exec /usr/local/bin/node /usr/local/lib/n624-latex/latex-render.cjs "$@"
