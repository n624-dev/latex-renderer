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
cp -R "$repo_root/tests/fixtures/smoke/." "$input/"
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
  --env LATEX_OUTPUTS=pdf \
  --mount "type=bind,src=$input,dst=/work/input,readonly" \
  --mount "type=bind,src=$output,dst=/work/output" \
  "$image"
renderer_status=$?
set -e
if [ "$renderer_status" -ne 0 ]; then
  echo "Renderer English/Japanese smoke fixture failed with exit code $renderer_status." >&2
  if [ -s "$output/compile.log" ]; then
    tail -n 200 "$output/compile.log" >&2
  fi
  exit "$renderer_status"
fi

[ -s "$output/result.pdf" ] || {
  echo "Renderer English/Japanese smoke test did not produce result.pdf" >&2
  exit 70
}
[ -s "$output/previews/page-1.png" ] || {
  echo "Renderer English/Japanese smoke test did not produce a PNG preview" >&2
  exit 70
}

printf '%s\n' 'Renderer English/Japanese PDF and PNG smoke test passed.'
