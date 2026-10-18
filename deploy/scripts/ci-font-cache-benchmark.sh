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
  1) modes='cold warm warm-repeat' ;;
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
  selected=$image; require_cache=1
  if [ "$mode" = cold ]; then selected=$cold_image; require_cache=0; fi
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
    --mount "type=bind,src=$bench_root/input,dst=/work/input,readonly" "$selected"
  status=$?
  set -e
  elapsed=$(($(date +%s)-started))
  printf 'FONT_CACHE_BENCHMARK mode=%s elapsed_seconds=%s exit=%s\n' "$mode" "$elapsed" "$status"
  if [ -f "$output/compile.log" ]; then
    awk '/^RENDERER_METRIC / {print}' "$output/compile.log"
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
