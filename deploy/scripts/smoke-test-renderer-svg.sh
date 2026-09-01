#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image=${1:-latex-renderer:ci}
smoke_root=$(mktemp -d)
input="$smoke_root/input"
output="$smoke_root/output"
trap 'rm -rf "$smoke_root"' EXIT
chmod 00755 "$smoke_root"
mkdir "$input" "$output"
cp -R "$repo_root/tests/fixtures/svg/." "$input/"
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
  echo "Renderer SVG smoke fixture failed with exit code $renderer_status." >&2
  if [ -s "$output/compile.log" ]; then
    echo '--- renderer compile.log (last 200 lines) ---' >&2
    tail -n 200 "$output/compile.log" >&2
  else
    echo 'Renderer did not produce compile.log.' >&2
  fi
  exit "$renderer_status"
fi

node --input-type=module - "$output/svg/manifest.json" <<'NODE'
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
if (manifest.schemaVersion !== 1 || manifest.objects.length !== 10)
  throw new Error("unexpected SVG manifest object count");
if (manifest.objects.filter(({ kind }) => kind === "tikz").length !== 2)
  throw new Error("TikZ/PGF outermost capture is invalid");
const mainMath = manifest.objects.filter(
  ({ kind, sourceFile }) => kind === "math" && sourceFile === "main.tex",
);
if (mainMath.length !== 7)
  throw new Error("inline/display math capture regressed around TikZ");
if (!manifest.objects.some(({ sourceFile }) => sourceFile === "section.tex"))
  throw new Error("included-file attribution is missing");
const repeated = manifest.objects.filter(
  ({ sourceFile, sourceLine }) => sourceFile === "main.tex" && sourceLine === 37,
);
if (
  repeated.length !== 3 ||
  new Set(repeated.map(({ x }) => x)).size !== 3
)
  throw new Error("repeated inline math placements are not distinct");
for (const [index, object] of manifest.objects.entries()) {
  if (object.id !== index + 1)
    throw new Error("SVG IDs are not in execution order");
  if (!/^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(object.artifact))
    throw new Error("unexpected SVG artifact path");
  for (const key of ["page", "x", "y", "width", "height"])
    if (!Number.isFinite(object[key]))
      throw new Error(`invalid SVG placement ${key}`);
}
NODE

printf '%s\n' 'Renderer SVG smoke test passed.'
