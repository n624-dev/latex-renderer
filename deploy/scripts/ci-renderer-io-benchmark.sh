#!/bin/sh
set -eu
# Large comparisons must never be launched against the shared production VPS.
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 77
image=${1:?temporary validated Runtime required}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$repo_root/deploy/scripts/smoke-container.sh"
bench_root=$(mktemp -d)
cleanup_io_benchmark() {
  status=$?
  trap - EXIT
  rm -rf -- "$bench_root"
  exit "$status"
}
trap cleanup_io_benchmark EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
chmod 0755 "$bench_root"
node "$repo_root/deploy/ci/renderer-io-benchmark.mjs"
for pages in 1 10 50 100; do
  input="$bench_root/input-$pages"; mkdir "$input"
  {
    printf '%s\n' '\documentclass{article}' '\usepackage{tikz}' '\begin{document}'
    page=1
    while [ "$page" -le "$pages" ]; do
      [ "$page" -eq 1 ] || printf '%s\n' '\newpage'
      printf 'Benchmark page %s. $x^2+y^2=z^2$.\n' "$page"
      [ "$page" -ne 1 ] || printf '%s\n' '\begin{tikzpicture}\draw(0,0)--(1,1);\end{tikzpicture}'
      page=$((page+1))
    done
    printf '%s\n' '\end{document}'
  } > "$input/main.tex"
  chmod -R a+rX "$input"
  for outputs in pdf pdf,svg; do
    output="$bench_root/output"; mkdir "$output"
    started=$(date +%s)
    run_smoke_container "$image" "$output" \
      --network none --read-only --cap-drop ALL \
      --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
      --pids-limit 128 --memory 1g --memory-swap 1g --cpus 1.5 \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
      --env REQUIRE_PREWARMED_FONTS=1 --env "LATEX_OUTPUTS=$outputs" \
      --mount "type=bind,src=$input,dst=/work/input,readonly" "$image"
    printf 'RENDERER_DOCUMENT_BENCHMARK pages=%s outputs=%s elapsed_seconds=%s png_bytes=%s png_files=%s\n' \
      "$pages" "$outputs" "$(($(date +%s)-started))" \
      "$(find "$output/previews" -type f -name '*.png' -printf '%s\n' | awk '{n+=$1} END {printf "%.0f",n}')" \
      "$(find "$output/previews" -type f -name '*.png' | wc -l)"
    awk '/^RENDERER_METRIC / {print}' "$output/compile.log"
    node "$repo_root/deploy/ci/renderer-io-benchmark.mjs" "$output"
    rm -rf -- "$output"
  done
  rm -rf -- "$input"
done
