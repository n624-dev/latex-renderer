#!/bin/sh
set -eu

# Preview conversion never initializes TeX/font caches or reads Source. Its
# read-only input is the already published PDF, selected by the Worker lease.
if [ "${LATEX_RENDER_STAGE:-all}" = preview ]; then
  umask 0007
  preview_started=$(date +%s)
  page=${LATEX_PREVIEW_PAGE:-}
  case "$page" in ''|*[!0-9]*|0*) exit 78 ;; esac
  [ "$page" -le 100 ] || exit 78
  mkdir -p /work/output/previews
  [ -f /work/pdf/result.pdf ] || exit 79
  timeout -s TERM -k 2 60 pdftoppm -f "$page" -l "$page" -singlefile -png -r 150 \
    /work/pdf/result.pdf "/work/output/previews/page-$page" > /work/output/compile.log 2>&1
  [ -s "/work/output/previews/page-$page.png" ] || exit 71
  printf 'RENDERER_METRIC stage=preview_page elapsed_seconds=%s memory_peak_bytes=%s cpu_usage_usec=%s\n' \
    "$(($(date +%s)-preview_started))" \
    "$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || printf unknown)" \
    "$(awk '$1=="usage_usec" {print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null || printf unknown)" >> /work/output/compile.log
  exit 0
fi

export HOME=/tmp/home
export TEXMFHOME=/tmp/texlive/texmf-home
export TEXMFCONFIG=/tmp/texlive/texmf-config
export TEXMFVAR=/tmp/texlive/texmf-var
export TEXMFCNF=/opt/renderer:
export TEXMFCACHE=/tmp/texlive/texmf-var:/opt/texlive/2026/texmf-var

# The host storage tree supplies a narrowly scoped default ACL for this
# rootless container's subordinate UID/GID. Keep generated files group-private
# and never widen the bind mount to every host user.
umask 0007
mkdir -p "$HOME" "$TEXMFHOME" "$TEXMFCONFIG" "$TEXMFVAR" /work/output/previews
prepare_output_dirs() {
  output_root=$1
  # TeX writes chapters/ch1.aux under -outdir for \include{chapters/ch1}.
  # Mirror directories from the validated, read-only input; find does not
  # follow symlinks, and -exec preserves spaces and Unicode in path names.
  find /work/input -mindepth 1 -type d -exec sh -c '
    output_root=$1
    shift
    for input_dir do
      relative=${input_dir#/work/input/}
      [ "$relative" != "$input_dir" ] || exit 78
      mkdir -p -- "$output_root/$relative"
    done
  ' sh "$output_root" {} +
}
prepare_output_dirs /work/output
mkdir -p "$TEXMFVAR/luatex-cache/generic"
cp -R /opt/texlive/2026/texmf-var/luatex-cache/generic/names \
  "$TEXMFVAR/luatex-cache/generic/"

# Lua's default collector waits for the live heap to double between cycles.
# A smaller pause can release transient font-loader tables earlier. It does
# not remove fonts, change TeX limits or force a full collection per page.
# Keep standard behavior by default: the disposable-runner comparison has not
# demonstrated a consistent memory or timing benefit from the tuned policy.
case "${RENDERER_LUA_GC_MODE:-standard}" in
  balanced)
    printf '%s\n' 'collectgarbage("setpause", 120)' 'collectgarbage("setstepmul", 200)' \
      > /tmp/renderer-memory.lua
    export RENDERER_LUA_GC_SCRIPT=/tmp/renderer-memory.lua
    ;;
  standard) unset RENDERER_LUA_GC_SCRIPT ;;
  *) printf '%s\n' 'renderer: invalid Lua GC mode' >&2; exit 78 ;;
esac

cd /work/input
renderer_log=/tmp/renderer-compile.log
: > "$renderer_log"
renderer_stage=setup
renderer_stage_started=$(date +%s)
renderer_oom_start=$(awk '$1=="oom_kill" {print $2}' /sys/fs/cgroup/memory.events 2>/dev/null || true)
record_stage() {
  renderer_now=$(date +%s)
  renderer_peak=$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || printf unknown)
  renderer_oom=$(awk '$1=="oom_kill" {print $2}' /sys/fs/cgroup/memory.events 2>/dev/null || true)
  renderer_cpu=$(awk '$1=="usage_usec" {print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null || true)
  renderer_io=unknown
  if [ -r /sys/fs/cgroup/io.stat ]; then
    renderer_io=$(awk '{for(i=2;i<=NF;i++){split($i,p,"=");if(p[1]=="rbytes")r+=p[2];if(p[1]=="wbytes")w+=p[2]}} END {printf "%.0f:%.0f",r,w}' /sys/fs/cgroup/io.stat 2>/dev/null || true)
    case "$renderer_io" in *:*) ;; *) renderer_io=unknown ;; esac
  fi
  renderer_temporary=$(du -sk /tmp /work/output 2>/dev/null | awk '{n+=$1} END {printf "%.0f",n*1024}')
  renderer_memory_parts=unknown
  if [ -r /sys/fs/cgroup/memory.stat ]; then
    renderer_memory_parts=$(awk '$1=="anon" {a=$2; na=1} $1=="file" {f=$2; nf=1} $1=="shmem" {s=$2; ns=1} END {if(na&&nf&&ns) printf "%.0f:%.0f:%.0f",a,f,s; else printf "unknown"}' /sys/fs/cgroup/memory.stat)
  fi
  case "$renderer_peak" in ''|*[!0-9]*) renderer_peak=unknown ;; esac
  case "$renderer_oom" in ''|*[!0-9]*) renderer_oom=unknown ;; esac
  case "$renderer_cpu" in ''|*[!0-9]*) renderer_cpu=unknown ;; esac
  printf 'RENDERER_METRIC stage=%s elapsed_seconds=%s memory_peak_bytes=%s oom_kill=%s cpu_usage_usec=%s io_read_write_bytes=%s sampled_temporary_bytes=%s sampled_memory_anon_file_shmem_bytes=%s\n' \
    "$renderer_stage" "$((renderer_now-renderer_stage_started))" "$renderer_peak" "$renderer_oom" "$renderer_cpu" "$renderer_io" "$renderer_temporary" "$renderer_memory_parts" >> "$renderer_log"
  renderer_stage_started=$renderer_now
}
# TeX may need /work/output/compile.log itself when the entrypoint is
# compile.tex. Keep renderer output private until every TeX pass has exited.
publish_renderer_log() {
  status=$?
  trap - EXIT
  record_stage || true
  case "$renderer_oom_start:$renderer_oom" in *unknown*|:*|*:) ;; *)
    if [ "$renderer_oom" -gt "$renderer_oom_start" ]; then
      printf '%s\n' 'renderer: memory limit exceeded' >> "$renderer_log"
      status=84
    fi ;;
  esac
  [ ! -d /work/output/compile.log ] || exit 80
  # A file moved from /tmp keeps its tmpfs ACL, so the host worker cannot read
  # it through a rootless Docker bind mount. Create the replacement inside the
  # output tree to inherit that tree's default ACL before publishing it.
  publish_log_tmp=$(mktemp /work/output/.renderer-compile.XXXXXXXX) || exit 80
  if ! cat "$renderer_log" > "$publish_log_tmp" ||
     ! chmod 0660 "$publish_log_tmp" ||
     ! mv -f -- "$publish_log_tmp" /work/output/compile.log; then
    rm -f -- "$publish_log_tmp"
    exit 80
  fi
  exit "$status"
}
trap publish_renderer_log EXIT
entrypoint=${LATEX_ENTRYPOINT:-main.tex}
case "$entrypoint" in /*|*\\*) printf '%s\n' 'renderer: invalid entrypoint' >> "$renderer_log"; exit 78 ;; esac
case "/$entrypoint/" in */../*|*/./*|*//*) printf '%s\n' 'renderer: invalid entrypoint' >> "$renderer_log"; exit 78 ;; esac
case "$entrypoint" in *.[tT][eE][xX]) ;; *) printf '%s\n' 'renderer: invalid entrypoint' >> "$renderer_log"; exit 78 ;; esac
output_name=${entrypoint##*/}
output_name=${output_name%.*}.pdf
outputs=${LATEX_OUTPUTS:-pdf}
render_stage=${LATEX_RENDER_STAGE:-all}
case "$render_stage" in all|pdf|svg) ;; *) exit 78 ;; esac
case "$outputs" in
  pdf) svg_requested=false ;;
  pdf,svg|svg,pdf) svg_requested=true ;;
  *) printf '%s\n' 'renderer: outputs must be pdf or pdf,svg' >> "$renderer_log"; exit 78 ;;
esac

canonical_pdf=/work/output/result.pdf
if [ "$render_stage" = svg ]; then
  [ "$svg_requested" = true ] || exit 78
  canonical_pdf=/work/pdf/result.pdf
  [ -f "$canonical_pdf" ] && [ -f /work/pdf/result.synctex.gz ] || exit 79
else

# Parse hostile image/PDF metadata inside this sandbox before TeX sees it.
if ! timeout -s TERM -k 2 30 sh -c "find /work/input -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) -print0 | xargs -0 -r identify -format '%w %h\\n' --" > /tmp/image-dimensions; then
  printf '%s\n' 'renderer: input image metadata validation failed' >> "$renderer_log"
  exit 73
fi
if ! awk '{p=$1*$2; if ($1>20000 || $2>20000 || p>50000000) exit 1; total+=p} END {if(total>100000000) exit 1}' /tmp/image-dimensions; then
  printf '%s\n' 'renderer: input image pixel limit exceeded' >> "$renderer_log"
  exit 74
fi

: > /tmp/pdf-pages
find /work/input -type f -iname '*.pdf' -print | while IFS= read -r input_pdf; do
  if ! timeout -s TERM -k 2 10 pdfinfo "$input_pdf" > /tmp/pdf-info; then exit 75; fi
  pages=$(awk '/^Pages:/ {print $2}' /tmp/pdf-info)
  case "$pages" in ''|*[!0-9]*) exit 75 ;; esac
  if [ "$pages" -gt 100 ] || ! awk '/^Page size:/ {if($3>20000 || $5>20000) exit 1}' /tmp/pdf-info; then exit 76; fi
  printf '%s\n' "$pages" >> /tmp/pdf-pages
  if ! timeout -s TERM -k 2 10 qpdf --show-xref "$input_pdf" > /tmp/pdf-xref || ! awk 'NR>100000 {exit 1}' /tmp/pdf-xref; then exit 77; fi
done || {
  printf '%s\n' 'renderer: input PDF complexity limit exceeded' >> "$renderer_log"
  exit 76
}
if ! awk '{total+=$1} END {if(total>100) exit 1}' /tmp/pdf-pages; then
  printf '%s\n' 'renderer: total input PDF page limit exceeded' >> "$renderer_log"
  exit 76
fi

set +e
record_stage
renderer_stage=compile
timeout -s TERM -k 2 300 latexmk -norc -r /opt/renderer/latexmkrc -lualatex -interaction=nonstopmode -halt-on-error \
  -file-line-error -recorder -synctex=1 -outdir=/work/output "/work/input/$entrypoint" \
  >> "$renderer_log" 2>&1
compile_status=$?
set -e

if [ "$compile_status" -ne 0 ]; then
  if [ "$compile_status" -eq 124 ] || [ "$compile_status" -eq 137 ]; then
    printf '%s\n' 'renderer: LaTeX compile timed out' >> "$renderer_log"
    exit 81
  fi
  exit "$compile_status"
fi

if [ ! -f "/work/output/$output_name" ]; then
  printf '%s\n' 'renderer: entrypoint PDF was not produced' >> "$renderer_log"
  exit 70
fi

# result.tex already produces the canonical name; mv would fail on itself.
if [ "$output_name" != result.pdf ]; then
  mv "/work/output/$output_name" /work/output/result.pdf
fi
synctex_name=${output_name%.pdf}.synctex.gz
if [ "$svg_requested" = true ]; then
  if [ ! -f "/work/output/$synctex_name" ]; then
    printf '%s\n' 'renderer: SyncTeX map was not produced' >> "$renderer_log"
    exit 79
  fi
  if [ "$synctex_name" != result.synctex.gz ]; then
    mv "/work/output/$synctex_name" /work/output/result.synctex.gz
  fi
fi
set +e
record_stage
renderer_stage=pdfinfo
timeout -s TERM -k 2 10 pdfinfo /work/output/result.pdf > /tmp/output-pdf-info
pdfinfo_status=$?
set -e
if [ "$pdfinfo_status" -eq 124 ] || [ "$pdfinfo_status" -eq 137 ]; then
  printf '%s\n' 'renderer: PDF preview inspection timed out' >> "$renderer_log"
  exit 82
fi
if [ "$pdfinfo_status" -ne 0 ]; then
  printf '%s\n' 'renderer: PDF preview inspection failed' >> "$renderer_log"
  exit 71
fi
pages=$(awk '/^Pages:/ {print $2}' /tmp/output-pdf-info)
case "$pages" in
  ''|*[!0-9]*) exit 71 ;;
esac
if [ "$pages" -gt 100 ]; then
  printf '%s\n' 'renderer: PDF page limit exceeded' >> "$renderer_log"
  exit 72
fi

set +e
record_stage
renderer_stage=preview
timeout -s TERM -k 2 60 pdftoppm -f 1 -l 1 -singlefile -png -r 150 /work/output/result.pdf /work/output/previews/page-1
preview_status=$?
set -e
if [ "$preview_status" -eq 124 ] || [ "$preview_status" -eq 137 ]; then
  printf '%s\n' 'renderer: PDF preview timed out' >> "$renderer_log"
  exit 82
fi
if [ "$preview_status" -ne 0 ]; then
  exit "$preview_status"
fi

# Poppler pads page numbers to the document's page-count width. Keep the
# public preview names independent of page count (page-1.png, not page-01.png).
for preview in /work/output/previews/page-*.png; do
  [ -f "$preview" ] || continue
  number=${preview##*/}
  number=${number#page-}
  number=${number%.png}
  number=$(printf '%s\n' "$number" | sed 's/^0*//')
  case "$number" in ''|*[!0-9]*) exit 72 ;; esac
  target="/work/output/previews/page-$number.png"
  if [ "$preview" != "$target" ]; then
    mv "$preview" "$target"
  fi
done
printf '{"schemaVersion":1,"pages":%s,"dpi":150}\n' "$pages" > /work/output/.preview-info.json

fi
[ "$render_stage" != pdf ] || exit 0

if [ "$svg_requested" = true ]; then
  capture=/tmp/svg-capture
  record_stage
  renderer_stage=svg_capture
  rm -rf "$capture"
  mkdir -p "$capture"
  prepare_output_dirs "$capture"
  export LATEX_ENTRYPOINT_ABSOLUTE="/work/input/$entrypoint"
  export TEXINPUTS="/work/input//:"
  set +e
  (cd "$capture" && timeout -s TERM -k 2 "${SVG_CONVERSION_TIMEOUT_SECONDS:-120}" \
    latexmk -norc -r /opt/renderer/latexmkrc -lualatex -interaction=nonstopmode \
      -halt-on-error -file-line-error -recorder -jobname=objects \
      -outdir="$capture" /opt/renderer/svg-wrapper.tex) \
    >> "$renderer_log" 2>&1
  capture_status=$?
  set -e
  if [ "$capture_status" -eq 124 ] || [ "$capture_status" -eq 137 ]; then
    printf '%s\n' 'renderer: SVG capture timed out' >> "$renderer_log"
    exit 83
  fi
  if [ "$capture_status" -ne 0 ] || [ ! -f "$capture/objects.meta" ]; then
    printf '%s\n' 'renderer: SVG capture failed' >> "$renderer_log"
    exit 79
  fi
  record_stage
  renderer_stage=svg_export
  set +e
  timeout -s TERM -k 2 "${SVG_CONVERSION_TIMEOUT_SECONDS:-120}" \
    /opt/renderer/export-svg.pl "$capture/objects.pdf" "$capture/objects.meta" \
      "$canonical_pdf" /work/output/svg \
    >> "$renderer_log" 2>&1
  export_status=$?
  set -e
  if [ "$export_status" -eq 124 ] || [ "$export_status" -eq 137 ]; then
    printf '%s\n' 'renderer: SVG conversion timed out' >> "$renderer_log"
    exit 83
  fi
  if [ "$export_status" -ne 0 ]; then
    exit "$export_status"
  fi
fi
