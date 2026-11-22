#!/bin/sh
set -eu
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
command=/usr/local/bin/n624-latex
if [ -L "$command" ] || { [ -e "$command" ] &&
   ! grep -Fxq '# Managed LaTeX Renderer server launcher' "$command"; }; then
  exit 0
fi

# Export only the two self-contained client programs. The application slot
# retains its service-group permissions and contains the privileged scripts.
library=/usr/local/lib/n624-latex
install -d -o root -g root -m 0755 "$library"
test ! -L "$library"
stage=$(mktemp -d "$library/.install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
for entry in latex-render.cjs latex-render-admin.mjs; do
  install -o root -g root -m 0644 +    "$source_root/client-dist/latex-renderer-client/app/$entry" "$stage/$entry"
  mv -fT "$stage/$entry" "$library/$entry"
done
install -o root -g root -m 0755 "$source_root/deploy/scripts/n624-latex-launcher.sh" "$stage/launcher"
mv -fT "$stage/launcher" "$command"
