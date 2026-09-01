#!/bin/sh
set -eu

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
mkdir -p "$TEXMFVAR/luatex-cache/generic"
cp -R /opt/texlive/2026/texmf-var/luatex-cache/generic/names \
  "$TEXMFVAR/luatex-cache/generic/"

cd /work/input
: > /work/output/compile.log
entrypoint=${LATEX_ENTRYPOINT:-main.tex}
case "$entrypoint" in /*|*\\*) printf '%s\n' 'renderer: invalid entrypoint' >> /work/output/compile.log; exit 78 ;; esac
case "/$entrypoint/" in */../*|*/./*|*//*) printf '%s\n' 'renderer: invalid entrypoint' >> /work/output/compile.log; exit 78 ;; esac
case "$entrypoint" in *.tex) ;; *) printf '%s\n' 'renderer: invalid entrypoint' >> /work/output/compile.log; exit 78 ;; esac
output_name=${entrypoint##*/}
output_name=${output_name%.tex}.pdf
outputs=${LATEX_OUTPUTS:-pdf}
case "$outputs" in
  pdf) svg_requested=false ;;
  pdf,svg|svg,pdf) svg_requested=true ;;
  *) printf '%s\n' 'renderer: outputs must be pdf or pdf,svg' >> /work/output/compile.log; exit 78 ;;
esac

# Parse hostile image/PDF metadata inside this sandbox before TeX sees it.
if ! timeout -s TERM -k 2 30 sh -c "find /work/input -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) -print0 | xargs -0 -r identify -format '%w %h\\n' --" > /tmp/image-dimensions; then
  printf '%s\n' 'renderer: input image metadata validation failed' >> /work/output/compile.log
  exit 73
fi
if ! awk '{p=$1*$2; if ($1>20000 || $2>20000 || p>50000000) exit 1; total+=p} END {if(total>100000000) exit 1}' /tmp/image-dimensions; then
  printf '%s\n' 'renderer: input image pixel limit exceeded' >> /work/output/compile.log
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
  printf '%s\n' 'renderer: input PDF complexity limit exceeded' >> /work/output/compile.log
  exit 76
}
if ! awk '{total+=$1} END {if(total>100) exit 1}' /tmp/pdf-pages; then
  printf '%s\n' 'renderer: total input PDF page limit exceeded' >> /work/output/compile.log
  exit 76
fi

set +e
timeout -s TERM -k 2 300 latexmk -norc -r /opt/renderer/latexmkrc -lualatex -interaction=nonstopmode -halt-on-error \
  -file-line-error -recorder -synctex=1 -outdir=/work/output "/work/input/$entrypoint" \
  >> /work/output/compile.log 2>&1
compile_status=$?
set -e

if [ "$compile_status" -ne 0 ]; then
  exit "$compile_status"
fi

if [ ! -f "/work/output/$output_name" ]; then
  printf '%s\n' 'renderer: entrypoint PDF was not produced' >> /work/output/compile.log
  exit 70
fi

mv "/work/output/$output_name" /work/output/result.pdf
synctex_name=${output_name%.pdf}.synctex.gz
if [ "$svg_requested" = true ]; then
  if [ ! -f "/work/output/$synctex_name" ]; then
    printf '%s\n' 'renderer: SyncTeX map was not produced' >> /work/output/compile.log
    exit 79
  fi
  mv "/work/output/$synctex_name" /work/output/result.synctex.gz
fi
pages=$(timeout -s TERM -k 2 10 pdfinfo /work/output/result.pdf | awk '/^Pages:/ {print $2}')
case "$pages" in
  ''|*[!0-9]*) exit 71 ;;
esac
if [ "$pages" -gt 100 ]; then
  printf '%s\n' 'renderer: PDF page limit exceeded' >> /work/output/compile.log
  exit 72
fi

timeout -s TERM -k 2 60 pdftoppm -png -r 150 /work/output/result.pdf /work/output/previews/page

if [ "$svg_requested" = true ]; then
  capture=/tmp/svg-capture
  rm -rf "$capture"
  mkdir -p "$capture"
  export LATEX_ENTRYPOINT_ABSOLUTE="/work/input/$entrypoint"
  export TEXINPUTS="/work/input//:"
  set +e
  (cd "$capture" && timeout -s TERM -k 2 "${SVG_CONVERSION_TIMEOUT_SECONDS:-120}" \
    lualatex -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error \
      -jobname=objects -output-directory="$capture" /opt/renderer/svg-wrapper.tex) \
    >> /work/output/compile.log 2>&1
  capture_status=$?
  set -e
  if [ "$capture_status" -ne 0 ] || [ ! -f "$capture/objects.meta" ]; then
    printf '%s\n' 'renderer: SVG capture failed' >> /work/output/compile.log
    exit 79
  fi
  timeout -s TERM -k 2 "${SVG_CONVERSION_TIMEOUT_SECONDS:-120}" \
    /opt/renderer/export-svg.pl "$capture/objects.pdf" "$capture/objects.meta" \
      /work/output/result.pdf /work/output/svg \
    >> /work/output/compile.log 2>&1
fi
