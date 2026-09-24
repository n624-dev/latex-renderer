#!/bin/sh
set -eu

image=${1:-latex-renderer:ci}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$repo_root/deploy/scripts/smoke-container.sh"
smoke_root=$(mktemp -d)
input="$smoke_root/input"
output="$smoke_root/output"
trap 'rm -rf "$smoke_root"' EXIT HUP INT TERM
chmod 00755 "$smoke_root"
mkdir -p "$input/chapters" "$output"
fixture="$repo_root/tests/fixtures/runtime-compat"
cp "$fixture/compile.tex" "$input/compile.tex"
cp "$fixture/ch1.tex" "$input/chapters/ch1.tex"
# Preserve the NFD spelling used by compile.tex, not the NFC-equivalent name.
unicode_name=$(printf 'cafe\314\201.tex')
cp "$fixture/unicode-body.tex" "$input/chapters/$unicode_name"
chmod -R a+rX "$input"
chmod 0770 "$output"

set +e
run_smoke_container "$image" "$output" \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
  --pids-limit 128 \
  --memory 1g \
  --cpus 1.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --env LATEX_ENTRYPOINT=compile.tex \
  --env LATEX_OUTPUTS=pdf,svg \
  --env MAX_SVG_OBJECTS=20 \
  --mount "type=bind,src=$input,dst=/work/input,readonly" \
  "$image"
renderer_status=$?
set -e
if [ "$renderer_status" -ne 0 ]; then
  echo "Renderer compatibility fixture failed with exit code $renderer_status." >&2
  if [ -s "$output/compile.log" ]; then
    echo '--- renderer compile.log (last 200 lines) ---' >&2
    tail -n 200 "$output/compile.log" >&2
  else
    echo 'Renderer did not produce compile.log.' >&2
  fi
  exit "$renderer_status"
fi

[ -s "$output/result.pdf" ]
[ -s "$output/compile.log" ]
[ -s "$output/chapters/ch1.aux" ]
[ -s "$output/svg/manifest.json" ]

node --input-type=module - "$output/compile.log" "$output/svg/manifest.json" <<'NODE'
import { readFile } from "node:fs/promises";

const log = await readFile(process.argv[2], "utf8");
const references = { compile: [], objects: [] };
for (const [, jobname, value] of log.matchAll(/LR-COMPAT-REF-(compile|objects)=([^\r\n]+)/g)) {
  references[jobname].push(value.trim());
}
const resolved = {};
for (const [jobname, values] of Object.entries(references)) {
  // \meaning includes the whole \newlabel record. Only the first group is the
  // reference number; PDF and preview pages are allowed to differ.
  const reference = /\{\{([^{}]+)\}/.exec(values.at(-1) ?? "")?.[1];
  if (values.length < 2 || values[0] !== "UNRESOLVED" || !reference)
    throw new Error(`${jobname} did not resolve the same equation reference after multiple passes: ${values.join(", ")}`);
  resolved[jobname] = reference;
}
if (resolved.compile !== "1" || resolved.objects !== resolved.compile)
  throw new Error(`PDF/SVG reference mismatch: ${JSON.stringify(resolved)}`);
const manifest = JSON.parse(await readFile(process.argv[3], "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.objects) || manifest.objects.length < 2)
  throw new Error("SVG capture is missing reference-dependent math objects");
NODE

printf '%s\n' 'Renderer include/Unicode/log/multi-pass compatibility smoke test passed.'
