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
[ -s "$output/compile.fls" ]
[ -s "$output/chapters/ch1.aux" ]
[ -s "$output/svg/manifest.json" ]

node "$repo_root/deploy/scripts/verify-renderer-compat.mjs" \
  "$output/compile.log" "$output/svg/manifest.json"

printf '%s\n' 'Renderer include/Unicode/log/multi-pass compatibility smoke test passed.'
