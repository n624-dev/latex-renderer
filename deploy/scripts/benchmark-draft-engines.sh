#!/bin/sh
set -eu

image=${1:?temporary validated Runtime required}
if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
  [ "${RENDERER_DISPOSABLE_BENCHMARK:-}" = 1 ] || {
    printf '%s\n' 'Run this comparison on a disposable host, with RENDERER_DISPOSABLE_BENCHMARK=1.' >&2
    exit 77
  }
fi
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$repo_root/deploy/scripts/smoke-container.sh"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
chmod 0755 "$work"

render() {
  render_output=$1
  render_case=$2
  shift 2
  started=$(date +%s%3N)
  if ! run_smoke_container "$image" "$render_output" \
    --network none --read-only --cap-drop ALL \
    --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
    --pids-limit 128 --memory 1g --memory-swap 1g --cpus 1.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
    --entrypoint /opt/renderer/compile-with-engine.sh --env "LATEX_ENGINE=$engine" \
    --env LATEX_RENDER_STAGE=pdf --env LATEX_FIRST_PREVIEW=deferred \
    --mount "type=bind,src=$input,dst=/work/input,readonly" "$@" "$image"; then
    tail -n 100 "$render_output/compile.log" >&2
    return 1
  fi
  printf 'DRAFT_ENGINE_BENCHMARK engine=%s pages=%s scenario=%s elapsed_ms=%s disk_bytes=%s\n' \
    "$engine" "$pages" "$render_case" "$(($(date +%s%3N)-started))" \
    "$(du -sb "$render_output" | cut -f1)"
  sed -n '/^RENDERER_METRIC /p' "$render_output/compile.log"
}

for engine in lualatex pdflatex xelatex uplatex platex; do
  cls='\documentclass{article}'
  sample='Benchmark document'
  style=plain
  case "$engine" in
    uplatex) cls='\documentclass[uplatex,dvipdfmx]{jsarticle}' ;;
    platex) cls='\documentclass[dvipdfmx]{jsarticle}' ;;
  esac
  case "$engine" in uplatex|platex) sample='日本語の組版'; style=jplain ;; esac
  for pages in ${RENDERER_BENCHMARK_PAGES:-1 10 50 100}; do
    case "$pages" in 1|10|50|100) ;; *) exit 64 ;; esac
    trial="$work/$engine-$pages"
    input="$trial/input"
    baseline="$trial/baseline"
    seed="$trial/seed"
    cold="$trial/cold"
    warm="$trial/warm"
    mkdir -p "$input" "$baseline" "$seed" "$cold" "$warm"
    printf '%s\n' '@book{key, author={Ada Example}, title={Typesetting}, publisher={Example}, year={2026}}' > "$input/refs.bib"
    {
      printf '%s\n' "$cls" '\usepackage{tikz}' '\begin{document}' '\tableofcontents' \
        '\section{Introduction}' "$sample" 'Compare Equation~\ref{eq:1}.' \
        '\begin{equation} x^2=1\label{eq:1}\end{equation}' '\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}' \
        'Reference~\cite{key}.' "\\bibliographystyle{$style}" '\bibliography{refs}'
      i=1
      while [ "$i" -lt "$pages" ]; do
        i=$((i+1))
        printf '\\newpage\nBenchmark page %s.\n' "$i"
      done
      printf '%s\n' '\end{document}'
    } > "$input/main.tex"
    chmod -R a+rX "$input"
    render "$baseline" baseline
    for extension in aux toc out bbl fdb_latexmk; do
      if [ -s "$baseline/main.$extension" ]; then
        cp "$baseline/main.$extension" "$seed/"
      fi
    done
    chmod -R a+rX "$seed"
    seed_bytes=$(find "$seed" -maxdepth 1 -type f -printf '%s\n' | awk '{n+=$1} END {print n+0}')
    [ "$seed_bytes" -gt 0 ] && [ "$seed_bytes" -le 1048576 ]
    sed 's/Compare Equation/Refer to Equation/' "$input/main.tex" > "$input/edited.tex"
    mv -- "$input/edited.tex" "$input/main.tex"
    render "$cold" edited-cold
    render "$warm" edited-warm --mount "type=bind,src=$seed,dst=/work/seed,readonly"
    warm_used=false
    if grep -Fxq 'renderer: work cache used' "$warm/compile.log"; then warm_used=true; fi
    for mode in "$cold" "$warm"; do
      pdfinfo "$mode/result.pdf" | awk '/^Pages:/ {print $2}' > "$mode/pages"
      pdftotext -layout "$mode/result.pdf" "$mode/text"
      pdftoppm -r 45 -png "$mode/result.pdf" "$mode/page"
    done
    cmp "$cold/pages" "$warm/pages"
    cmp "$cold/text" "$warm/text"
    for page in "$cold"/page-*.png; do
      cmp "$page" "$warm/${page##*/}"
    done
    printf 'DRAFT_ENGINE_COMPARISON engine=%s target_pages=%s actual_pages=%s seed_bytes=%s warm_used=%s text_and_page_images_identical=true\n' \
      "$engine" "$pages" "$(cat "$cold/pages")" "$seed_bytes" "$warm_used"
    rm -rf -- "$trial"
  done
done
