#!/bin/sh
set -eu

image=${1:-latex-renderer:base-ci}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT HUP INT TERM
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
  --mount "type=bind,src=$repo_root/tests/fixtures/runtime-basic,dst=/work/input,readonly" \
  --mount "type=bind,src=$output,dst=/work/output" \
  --entrypoint /bin/sh \
  "$image" -c \
  'lualatex -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error -output-directory=/work/output /work/input/main.tex'

[ -s "$output/main.pdf" ] || {
  echo "TeX Live base smoke test did not produce main.pdf" >&2
  exit 70
}

printf '%s\n' 'Language-neutral TeX Live base smoke test passed.'
