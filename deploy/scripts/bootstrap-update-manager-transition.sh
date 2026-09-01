#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-update-manager-transition.sh must run through sudo" >&2
  exit 77
fi
if [ "$#" -gt 1 ]; then
  echo "usage: sudo sh deploy/scripts/bootstrap-update-manager-transition.sh [VERSION]" >&2
  exit 64
fi

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
version=${1:-$(/usr/local/bin/node -p "require('$source_root/package.json').version")}
if ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "bootstrap version must use X.Y.Z" >&2
  exit 64
fi
package_version=$(/usr/local/bin/node -p "require('$source_root/package.json').version")
if [ "$package_version" != "$version" ]; then
  echo "checked-out source version does not match v$version" >&2
  exit 65
fi
case "${SUDO_USER:-}" in
  ''|root|*[!a-z0-9_-]*)
    echo "run this command with sudo from a non-root deployment account" >&2
    exit 77
    ;;
esac

printf '{"verb":"bootstrap","version":"%s"}\n' "$version" |
  /usr/bin/flock --nonblock --exclusive \
    /opt/latex-renderer/update-staging/update-helper.lock \
    /usr/bin/env LATEX_RENDERER_LEGACY_BOOTSTRAP=1 \
    /usr/local/bin/node "$source_root/deploy/scripts/update-manager-helper.mjs"
