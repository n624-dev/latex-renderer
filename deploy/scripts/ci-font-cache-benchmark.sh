#!/bin/sh
set -eu
# Never run the cold-cache/OOM comparison on an operator's shared server.
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || {
  echo 'Font cache comparison requires a disposable GitHub-hosted runner' >&2; exit 77;
}
image=${1:?usage: ci-font-cache-benchmark.sh VERIFIED_RUNTIME_IMAGE}
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$repo_root/deploy/scripts/smoke-container.sh"
bench_root=$(mktemp -d)
cold_image=
cleanup_font_benchmark() {
  status=$?
  trap - EXIT
  if [ -n "$cold_image" ]; then docker image rm "$cold_image" >/dev/null || status=1; fi
  rm -rf -- "$bench_root"
  exit "$status"
}
trap cleanup_font_benchmark EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
chmod 00755 "$bench_root"
mkdir "$bench_root/input"
cp "$repo_root/tests/fixtures/font-cache/main.tex" "$bench_root/input/main.tex"
chmod -R a+rX "$bench_root/input"
case "${CI_FONT_CACHE_COMPARE:-0}" in
  1) modes='cold standard warm warm-repeat' ;;
  0) modes=warm ;;
  *) echo 'CI_FONT_CACHE_COMPARE must be 0 or 1' >&2; exit 64 ;;
esac
# A small local derivative removes ONLY precomputed font data. Neither image
# is published; the verified Base/Runtime identity and validation stay intact.
if [ "${CI_FONT_CACHE_COMPARE:-0}" = 1 ]; then
  printf 'ARG RUNTIME\nFROM ${RUNTIME}\nUSER root\nRUN rm -rf /opt/texlive/2026/texmf-var/luatex-cache/generic/fonts\nUSER 10000:10000\n' > "$bench_root/Dockerfile"
  docker build --builder default --build-arg "RUNTIME=$image" --iidfile "$bench_root/cold-id" "$bench_root" >/dev/null
  cold_candidate=$(cat "$bench_root/cold-id")
  printf '%s\n' "$cold_candidate" | grep -Eq '^sha256:[a-f0-9]{64}$' || exit 65
  cold_image=$cold_candidate
fi
for mode in $modes; do
  selected=$image; require_cache=1; gc_mode=balanced
  if [ "$mode" = cold ]; then selected=$cold_image; require_cache=0; fi
  if [ "$mode" = standard ]; then gc_mode=standard; fi
  output="$bench_root/$mode"; mkdir "$output"
  started=$(date +%s)
  status=0
  set +e
  run_smoke_container "$selected" "$output" \
    --network none --read-only --cap-drop ALL \
    --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
    --pids-limit 128 --memory 1g --memory-swap 1g --cpus 1.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
    --env REQUIRE_PREWARMED_FONTS="$require_cache" --env LATEX_OUTPUTS=pdf,svg \
    --env RENDERER_LUA_GC_MODE="$gc_mode" \
    --env SOURCE_DATE_EPOCH=946684800 --env FORCE_SOURCE_DATE=1 --env TZ=UTC \
    --mount "type=bind,src=$bench_root/input,dst=/work/input,readonly" "$selected"
  status=$?
  set -e
  elapsed=$(($(date +%s)-started))
  printf 'FONT_CACHE_BENCHMARK mode=%s gc=%s elapsed_seconds=%s exit=%s\n' "$mode" "$gc_mode" "$elapsed" "$status"
  if [ -f "$output/compile.log" ]; then
    awk '/^RENDERER_METRIC / {print}' "$output/compile.log"
    # These are cumulative cgroup counters, not a sum of per-stage peaks.
    peak=$(awk '/^RENDERER_METRIC / {for(i=1;i<=NF;i++){split($i,p,"=");if(p[1]=="memory_peak_bytes" && p[2]~/^[0-9]+$/ && p[2]>m)m=p[2]}} END {if(m>0)printf "%.0f",m;else printf "unknown"}' "$output/compile.log")
    cpu=$(awk '/^RENDERER_METRIC / {for(i=1;i<=NF;i++){split($i,p,"=");if(p[1]=="cpu_usage_usec" && p[2]~/^[0-9]+$/ && p[2]>m)m=p[2]}} END {if(m>0)printf "%.0f",m;else printf "unknown"}' "$output/compile.log")
    printf 'RENDERER_MEMORY_COMPARISON mode=%s gc=%s elapsed_seconds=%s peak_bytes=%s cpu_usage_usec=%s\n' "$mode" "$gc_mode" "$elapsed" "$peak" "$cpu"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      printf '\nMemory comparison: %s / %s, peak %s bytes, CPU %s us.\n' "$mode" "$gc_mode" "$peak" "$cpu" >> "$GITHUB_STEP_SUMMARY"
    fi
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '\nFont cache: %s, elapsed %ss, exit %s.\n' "$mode" "$elapsed" "$status" >> "$GITHUB_STEP_SUMMARY"
  fi
  if [ "$mode" = cold ] && [ "$status" -ne 0 ]; then
    # Do not relabel a broken fixture, Docker failure, or timeout as an OOM.
    [ "$status" -eq 84 ] && grep -q '^renderer: memory limit exceeded$' "$output/compile.log" || {
      echo 'Cold comparison failed without confirmed memory exhaustion' >&2; exit 65;
    }
  fi
  # A cold-cache OOM is evidence, not a reason to skip the warmed validation.
  if [ "$mode" != cold ]; then
    if [ "$status" -ne 0 ]; then
      if [ -f "$output/compile.log" ]; then tail -n 60 "$output/compile.log" >&2; fi
      exit 65
    fi
    test -s "$output/result.pdf"
    test -s "$output/previews/page-1.png"
    test -s "$output/svg/manifest.json"
    find "$output/svg/objects" -name '*.svg' -type f | awk 'END {exit NR==0}'
    grep -Eq 'memory_peak_bytes=[1-9][0-9]*' "$output/compile.log"
  fi
done
# Peak reduction is evidence to report, not a pass/fail requirement. A valid
# document can retain a large live font heap with either collector policy.
# Require unchanged rendered output instead of asserting a smaller heap.
same_preview() {
  if ! cmp -s "$1" "$2"; then
    echo 'Renderer memory comparison changed rendered PNG output' >&2
    exit 65
  fi
}
if [ -d "$bench_root/standard" ]; then
  same_preview "$bench_root/standard/previews/page-1.png" "$bench_root/warm/previews/page-1.png"
  same_preview "$bench_root/standard/previews/page-1.png" "$bench_root/warm-repeat/previews/page-1.png"
  # Explicitly request the other fixture page through the production preview
  # entrypoint. Do not reintroduce eager all-page PNG generation in rendering.
  for mode in standard warm warm-repeat; do
    page_output="$bench_root/$mode-page-2"; mkdir "$page_output"
    run_smoke_container "$image" "$page_output" \
      --network none --read-only --cap-drop ALL \
      --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
      --pids-limit 128 --memory 256m --memory-swap 256m --cpus 1.5 \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
      --env LATEX_RENDER_STAGE=preview --env LATEX_PREVIEW_PAGE=2 \
      --mount "type=bind,src=$bench_root/$mode,dst=/work/pdf,readonly" "$image"
    test -s "$page_output/previews/page-2.png"
  done
  same_preview "$bench_root/standard-page-2/previews/page-2.png" "$bench_root/warm-page-2/previews/page-2.png"
  same_preview "$bench_root/standard-page-2/previews/page-2.png" "$bench_root/warm-repeat-page-2/previews/page-2.png"
fi
