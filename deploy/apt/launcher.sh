#!/bin/sh
set -eu

root=/usr/lib/n624-latex
case "${0##*/}" in
  n624-latex)
    if [ "${1-}" = server ]; then
      shift
      # Node options inherited from a login session must not affect root.
      exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
        TERM="${TERM:-dumb}" SUDO_USER="${SUDO_USER:-}" \
        "$root/runtime/bin/node" "$root/server/deploy/scripts/n624-latex-server.mjs" "$@"
    fi
    export N624_LATEX_COMMAND=1
    entry=latex-render
    ;;
  latex-render|latex-renderer-mcp)
    entry="${0##*/}"
    ;;
  latex-render-admin)
    exec "$root/runtime/bin/node" "$root/client/app/latex-render-admin.mjs" "$@"
    ;;
  *) exit 64 ;;
esac
export N624_LATEX_PACKAGE=apt
exec "$root/runtime/bin/node" "$root/client/app/$entry.cjs" "$@"
