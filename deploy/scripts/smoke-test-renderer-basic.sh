#!/bin/sh
set -eu

image=${1:-latex-renderer:ci}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
smoke_root=$(mktemp -d)
input="$smoke_root/input"
output="$smoke_root/output"
trap 'rm -rf "$smoke_root"' EXIT HUP INT TERM
chmod 00755 "$smoke_root"
mkdir "$input" "$output"
cp -R "$repo_root/tests/fixtures/runtime-basic/." "$input/"
chmod -R a+rX "$input"
chmod 0770 "$output"

set +e
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
  --pids-limit 128 \
  --memory 1g \
  --cpus 1.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --env LATEX_ENTRYPOINT=main.tex \
  --env LATEX_OUTPUTS=pdf,svg \
  --env MAX_SVG_OBJECTS=50 \
  --mount "type=bind,src=$input,dst=/work/input,readonly" \
  --mount "type=bind,src=$output,dst=/work/output" \
  "$image"
renderer_status=$?
set -e
if [ "$renderer_status" -ne 0 ]; then
  echo "Renderer language-neutral smoke fixture failed with exit code $renderer_status." >&2
  if [ -s "$output/compile.log" ]; then
    echo '--- renderer compile.log (last 200 lines) ---' >&2
    tail -n 200 "$output/compile.log" >&2
  else
    echo 'Renderer did not produce compile.log.' >&2
  fi
  exit "$renderer_status"
fi

[ -s "$output/result.pdf" ] || {
  echo "Renderer did not produce result.pdf" >&2
  exit 70
}
[ -s "$output/compile.log" ] || {
  echo "Renderer did not produce compile.log" >&2
  exit 70
}
[ -s "$output/svg/manifest.json" ] || {
  echo "Renderer did not produce the SVG manifest" >&2
  exit 70
}

node --input-type=module - "$output/svg/manifest.json" "$output" <<'NODE'
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = process.argv[2];
const outputRoot = process.argv[3];
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.objects) || manifest.objects.length < 2)
  throw new Error("language-neutral SVG manifest is incomplete");
if (!manifest.objects.some(({ kind }) => kind === "math"))
  throw new Error("language-neutral SVG math capture is missing");
if (!manifest.objects.some(({ kind }) => kind === "tikz"))
  throw new Error("language-neutral SVG TikZ capture is missing");
for (const object of manifest.objects) {
  if (!/^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(object.artifact))
    throw new Error("unexpected SVG artifact path");
  await access(resolve(outputRoot, object.artifact));
}
NODE

printf '%s\n' 'Renderer language-neutral PDF/SVG smoke test passed.'
