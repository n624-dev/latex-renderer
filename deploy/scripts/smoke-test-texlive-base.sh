#!/bin/sh
set -eu

image=${1:-latex-renderer:base-ci}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$repo_root/deploy/scripts/smoke-container.sh"
smoke_root=$(mktemp -d)
input="$smoke_root/input"
output="$smoke_root/output"
trap 'rm -rf "$smoke_root"' EXIT HUP INT TERM
chmod 0755 "$smoke_root"
mkdir "$input" "$output"
cp -R "$repo_root/tests/fixtures/runtime-basic/." "$input/"
chmod -R a+rX "$input"
chmod 0770 "$output"

# The published base must remain renderer-code-free. It is a TeX Live substrate,
# not an executable latex-renderer runtime.
docker run --rm --network none --read-only --entrypoint /bin/sh "$image" -c '
  test ! -e /opt/renderer/compile.sh
  test ! -e /opt/renderer/latexmkrc
  command -v lualatex >/dev/null
  command -v tlmgr >/dev/null
  kpsewhich tikz.sty >/dev/null
  kpsewhich pgfplots.sty >/dev/null
'

run_smoke_container "$image" "$output" \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
  --pids-limit 128 \
  --memory 1g \
  --cpus 1.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --mount "type=bind,src=$input,dst=/work/input,readonly" \
  --entrypoint /bin/sh \
  "$image" -c \
  'lualatex -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error -output-directory=/work/output /work/input/main.tex'

[ -s "$output/main.pdf" ] || {
  echo "TeX Live base smoke test did not produce main.pdf" >&2
  exit 70
}

printf '%s\n' 'Language-neutral TeX Live base smoke test passed.'
