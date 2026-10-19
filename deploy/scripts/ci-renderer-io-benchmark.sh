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
    chmod -R a+rX "$output"
    # Same immutable PDF, same Poppler and DPI. The legacy comparator generates
    # every page; it does not recompile the document or mutate the lazy result.
    eager="$bench_root/eager"; mkdir "$eager"
    eager_started=$(date +%s)
    run_smoke_container "$image" "$eager" \
      --network none --read-only --cap-drop ALL \
      --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
      --pids-limit 128 --memory 1g --memory-swap 1g --cpus 1.5 \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
      --mount "type=bind,src=$output,dst=/work/pdf,readonly" \
      --entrypoint /bin/sh "$image" -c '
        set -eu
        timeout -s TERM -k 2 60 pdftoppm -png -r 150 /work/pdf/result.pdf /work/output/page
        printf "RENDERER_EAGER_METRIC memory_peak_bytes=%s cpu_usage_usec=%s\n" \
          "$(cat /sys/fs/cgroup/memory.peak)" "$(awk '\''$1=="usage_usec" {print $2}'\'' /sys/fs/cgroup/cpu.stat)"
      '
    eager_first=$(find "$eager" -maxdepth 1 -name 'page-*.png' | sort | head -n 1)
    [ "$(find "$eager" -maxdepth 1 -name 'page-*.png' | wc -l)" -eq "$pages" ]
    cmp "$output/previews/page-1.png" "$eager_first"
    printf 'RENDERER_PREVIEW_COMPARISON pages=%s outputs=%s eager_elapsed_seconds=%s eager_png_bytes=%s eager_png_files=%s lazy_png_files=1 first_page_identical=true\n' \
      "$pages" "$outputs" "$(($(date +%s)-eager_started))" \
      "$(find "$eager" -name '*.png' -printf '%s\n' | awk '{n+=$1} END {printf "%.0f",n}')" \
      "$(find "$eager" -name '*.png' | wc -l)"
    # Exercise the new frozen six-file Runtime's isolated page mode as well.
    single="$bench_root/single"; mkdir "$single"
    run_smoke_container "$image" "$single" \
      --network none --read-only --cap-drop ALL \
      --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
      --pids-limit 128 --memory 256m --memory-swap 256m --cpus 1.5 \
      --ulimit fsize=10485760:10485760 \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
      --env LATEX_RENDER_STAGE=preview --env "LATEX_PREVIEW_PAGE=$pages" \
      --mount "type=bind,src=$input,dst=/work/input,readonly" \
      --mount "type=bind,src=$output,dst=/work/pdf,readonly" "$image"
    eager_last=$(find "$eager" -maxdepth 1 -name 'page-*.png' | sort | tail -n 1)
    cmp "$single/previews/page-$pages.png" "$eager_last"
    [ "$(find "$single/previews" -type f -name '*.png' | wc -l)" -eq 1 ]
    awk '/^RENDERER_METRIC / {print}' "$single/compile.log"
    printf 'RENDERER_LAZY_PAGE_CHECK pages=%s outputs=%s requested_page=%s bytes_identical=true\n' "$pages" "$outputs" "$pages"
    rm -rf -- "$eager" "$single"
    rm -rf -- "$output"
  done
  rm -rf -- "$input"
done
