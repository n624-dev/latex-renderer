#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: build-server-release-assets.sh RELEASE_TAG OUTPUT_DIRECTORY" >&2
  exit 64
fi

release_tag=$1
output_directory=$2
if ! printf '%s\n' "$release_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "release tag must use vX.Y.Z" >&2
  exit 64
fi
case "$output_directory" in
  /*) ;;
  *) echo "output directory must be absolute" >&2; exit 64 ;;
esac

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
version=${release_tag#v}
commit=$(git -C "$repository_root" rev-list -n 1 "$release_tag")
if [ -z "$commit" ] || [ "$(git -C "$repository_root" rev-parse HEAD)" != "$commit" ]; then
  echo "$release_tag must point at the checked-out commit" >&2
  exit 65
fi
if [ "$(node -p "require('$repository_root/package.json').version")" != "$version" ]; then
  echo "package version does not match $release_tag" >&2
  exit 65
fi

work_directory=$(mktemp -d)
cleanup() { rm -rf -- "$work_directory"; }
trap cleanup EXIT INT TERM HUP

top="latex-renderer-server-$version"
stage="$work_directory/$top"
mkdir -p "$stage" "$output_directory"
if [ -n "$(find "$output_directory" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory must be empty" >&2
  exit 73
fi
git -C "$repository_root" archive "$release_tag" | tar -x -C "$stage"

# The repository uses one systemd alias symlink. Release bundles reject
# symlinks, so materialize that known alias as a regular file before applying
# the general no-symlink assertion.
admin_web_unit="$stage/deploy/systemd/latex-renderer-admin-web.service"
if [ "$(readlink "$admin_web_unit")" != "latex-renderer-web.service" ]; then
  echo "unexpected admin Web systemd alias" >&2
  exit 65
fi
cp --remove-destination \
  "$stage/deploy/systemd/latex-renderer-web.service" \
  "$admin_web_unit"
if [ -n "$(find "$stage" -type l -print -quit)" ]; then
  echo "release source bundle must not contain symbolic links" >&2
  exit 65
fi

renderer_fingerprint=$(node "$repository_root/deploy/scripts/runtime-image-identity.mjs" --renderer-fingerprint)
node - "$stage/.latex-renderer-release.json" "$stage/deploy/release-policy.json" "$stage/package.json" "$version" "$release_tag" "$commit" "$renderer_fingerprint" <<'NODE'
const fs = require("node:fs");
const policy = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const packageJson = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
fs.writeFileSync(process.argv[2], `${JSON.stringify({
  schemaVersion: 1,
  version: process.argv[5],
  tag: process.argv[6],
  commit: process.argv[7],
  repository: "n624-dev/latex-renderer",
  minimumSourceVersion: policy.minimumSourceVersion,
  rollbackCompatible: policy.rollbackCompatible,
  requiredNodeMajor: 24,
  packageManager: packageJson.packageManager,
  rendererRuntimeFingerprint: process.argv[8],
}, null, 2)}\n`, { mode: 0o644 });
NODE

tar \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 --group=0 --numeric-owner \
  -czf "$output_directory/$top.tar.gz" \
  -C "$work_directory" "$top"
cp "$repository_root/client-dist/latex-renderer-client-$version.zip" "$output_directory/"
cp "$repository_root/client-dist/latex-renderer-local-$version.mcpb" "$output_directory/"
(
  cd "$output_directory"
  sha256sum \
    "$top.tar.gz" \
    "latex-renderer-client-$version.zip" \
    "latex-renderer-local-$version.mcpb" \
    > SHA256SUMS
)
