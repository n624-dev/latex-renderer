#!/bin/sh
set -eu

repository=n624-dev/latex-renderer
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
release=$(gh api "repos/$repository/releases/latest")
tag=$(printf '%s' "$release" | jq -er 'select(.immutable and (.draft == false) and (.prerelease == false)) | .tag_name')
if ! printf '%s\n' "$tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "A published immutable Stable release is required" >&2
  exit 65
fi
version=${tag#v}
commit=$(gh api "repos/$repository/commits/$tag" --jq .sha)
work=$(mktemp -d)
trap 'find "$work" -xdev -depth -delete' EXIT
archive="latex-renderer-client-$version.zip"
extension="latex-renderer-local-$version.mcpb"
gh release download "$tag" --repo "$repository" --dir "$work" \
  --pattern "$archive" --pattern "$extension" --pattern SHA256SUMS

for asset in "$archive" "$extension"; do
  checksum=$(sha256sum "$work/$asset" | cut -d' ' -f1)
  grep -Fxq "$checksum  $asset" "$work/SHA256SUMS"
  printf '%s' "$release" | jq -e --arg asset "$asset" --arg digest "sha256:$checksum" \
    'any(.assets[]; .name == $asset and .digest == $digest)' >/dev/null
  gh attestation verify "$work/$asset" --repo "$repository" \
    --signer-workflow "$repository/.github/workflows/server-release.yml" \
    --source-ref "refs/tags/$tag" --source-digest "$commit" \
    --predicate-type https://slsa.dev/provenance/v1 --deny-self-hosted-runners
done

for launcher in install.mjs uninstall.mjs install.ps1 uninstall.ps1; do
  unzip -p "$work/$archive" "latex-renderer-client/$launcher" >"$work/$launcher"
  test -s "$work/$launcher"
done
node --input-type=module - "$work" "$version" "$archive" "$extension" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, version, client, extension] = process.argv.slice(2);
for (const [archive, filename, fields] of [
  [client, "manifest.json", { minimumNodeVersion: "24.0.0" }],
  [extension, "mcpb.json", { signature: "pkcs7" }],
]) {
  const bytes = readFileSync(join(directory, archive));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(directory, filename), JSON.stringify({
    version, archive, size: bytes.length, sha256, ...fields,
  }, null, 2) + "\n");
}
NODE
mkdir -p "$root/client-dist"
for asset in "$archive" "$extension" manifest.json mcpb.json install.mjs uninstall.mjs install.ps1 uninstall.ps1; do
  cp "$work/$asset" "$root/client-dist/$asset"
done
printf 'Prepared verified Stable client distribution %s\n' "$tag"
