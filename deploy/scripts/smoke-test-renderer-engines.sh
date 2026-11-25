#!/bin/sh
set -eu

image=${1:?Runtime image required}
case "${2:-japanese}" in
  standard) engines="lualatex pdflatex xelatex" ;;
  japanese) engines="lualatex pdflatex xelatex uplatex platex" ;;
  *) printf '%s\n' 'Unknown renderer validation profile' >&2; exit 64 ;;
esac
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$repo_root/deploy/scripts/smoke-container.sh"
smoke_root=$(mktemp -d)
trap 'rm -rf "$smoke_root"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
chmod 0755 "$smoke_root"
input="$smoke_root/input"
mkdir -m 0755 "$input"

samples=$engines
if [ "${RENDERER_SMOKE_GEOMETRY:-${CI_RENDERER_IO_BENCHMARK:-0}}" = 1 ]; then
  for engine in $engines; do
    samples="$samples $engine-rotated"
    case "$engine" in platex|uplatex) samples="$samples $engine-vertical" ;; esac
  done
fi

for sample in $samples; do
  engine=${sample%%-*}
  bibliography_style=plain
  author='Renderer Team'
  case "$engine" in
    uplatex) document_class='\documentclass[uplatex,dvipdfmx]{jsarticle}'; body='日本語の組版'; bibliography_style=jplain; author='日本語の著者' ;;
    platex) document_class='\documentclass[dvipdfmx]{jsarticle}'; body='日本語の組版'; bibliography_style=jplain; author='日本語の著者' ;;
    *) document_class='\documentclass{article}'; body='Engine validation' ;;
  esac
  geometry=false
  case "$sample" in
    *-rotated) geometry=true; object='\rotatebox{45}{$r^2+3$}' ;;
    uplatex-vertical) geometry=true; document_class='\documentclass[uplatex,dvipdfmx]{utarticle}'; object='縦組の数式 $v^2+3$.' ;;
    platex-vertical) geometry=true; document_class='\documentclass[dvipdfmx]{tarticle}'; object='縦組の数式 $v^2+3$.' ;;
  esac
  if [ "$geometry" = true ]; then
    printf '%s\n' "$document_class" '\usepackage{graphicx}' '\begin{document}' \
      'Independent baseline $a_1$.' "$object" '\end{document}' > "$input/main.tex"
  else
    printf '%s\n' "$document_class" '\usepackage{amsmath}' '\usepackage{tikz}' '\begin{document}' \
      "$body" '\begin{equation}' 'x^2+y^2=z^2\label{eq:example}' '\end{equation}' \
      'Equation~\ref{eq:example}.' '\begin{tikzpicture}' '\draw (0,0) circle (2mm);' \
      '\end{tikzpicture}' "Reference \\cite{smoke}." "\\bibliographystyle{$bibliography_style}" \
      '\bibliography{references}' '\end{document}' > "$input/main.tex"
  fi
  printf '@book{smoke, author={%s}, title={TeX}, publisher={Example}, year={2026}}\n' "$author" > "$input/references.bib"
  chmod 0644 "$input/main.tex" "$input/references.bib"
  output="$smoke_root/$sample"
  mkdir -m 0700 "$output"
  console="$smoke_root/$sample.log"

  if run_smoke_container "$image" "$output" \
    --network none --read-only --cap-drop ALL \
    --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
    --pids-limit 128 --memory 1g --cpus 1.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
    --entrypoint /bin/sh \
    --env "LATEX_ENGINE=$engine" --env LATEX_OUTPUTS=pdf,svg \
    --env "EXPECTED_TEXT=$body" --env "GEOMETRY_SAMPLE=$geometry" \
    --mount "type=bind,src=$input,dst=/work/input,readonly" \
    "$image" -ec '
      /opt/renderer/compile-with-engine.sh
      pdftotext -enc UTF-8 /work/output/result.pdf /tmp/smoke-text
      if [ "$GEOMETRY_SAMPLE" = false ]; then grep -F -- "$EXPECTED_TEXT" /tmp/smoke-text; fi
    ' > "$console" 2>&1; then
    if grep -E 'Missing language pack|Unknown font tag|No font in show/space' "$console"; then
      printf 'The PDF or PNG is missing usable font mapping for %s\n' "$engine" >&2
      exit 70
    fi
    [ -s "$output/result.pdf" ] && [ -s "$output/previews/page-1.png" ] || {
      printf 'PDF or PNG missing for %s\n' "$engine" >&2
      exit 70
    }
    grep -F "Running '$engine -no-shell-escape " "$output/compile.log" >/dev/null || {
      printf 'The selected engine was not observed for %s\n' "$engine" >&2
      exit 70
    }
    case "$sample" in
      uplatex) grep -F "Running 'dvipdfmx " "$output/compile.log" >/dev/null
        grep -F "Running 'upbibtex " "$output/compile.log" >/dev/null ;;
      platex) grep -F "Running 'dvipdfmx " "$output/compile.log" >/dev/null
        grep -F "Running 'pbibtex " "$output/compile.log" >/dev/null ;;
      xelatex) grep -F "Running 'xdvipdfmx " "$output/compile.log" >/dev/null ;;
    esac
    printf 'Renderer PDF and PNG smoke test passed for %s.\n' "$sample"
    node --input-type=module - "$output" "$sample" "$geometry" <<'NODE'
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const [output, sample, geometry] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(output, "svg", "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.objects))
  throw new Error(`${sample}: invalid SVG manifest`);
for (const kind of geometry === "true" ? ["math"] : ["math", "tikz"]) {
  if (!manifest.objects.some((item) => item.kind === kind))
    throw new Error(`${sample}: missing SVG for ${kind}`);
}
for (const object of manifest.objects) {
  if (!/^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(object.artifact))
    throw new Error(`${sample}: invalid SVG file path`);
  const svg = await readFile(join(output, object.artifact), "utf8");
  if (!/<svg\b/.test(svg)) throw new Error(`${sample}: invalid SVG document`);
  if (object.placementStatus === "unknown") {
    if ("page" in object || "x" in object || "y" in object)
      throw new Error(`${sample}: guessed PDF coordinates`);
  } else if (object.placementStatus !== "known" ||
             object.page !== 1 || !Number.isFinite(object.x) || !Number.isFinite(object.y))
    throw new Error(`${sample}: invalid PDF coordinates`);
}
console.log(`Renderer SVG smoke test passed for ${sample}.`);
if (geometry === "true") {
  if (!manifest.objects.some((object) => object.kind === "math" &&
      object.sourceLine === 5 && object.placementStatus === "unknown"))
    throw new Error(`${sample}: transformed formula is missing or its position was guessed`);
} else if (!manifest.objects.some((object) => object.placementStatus === "known")) {
  throw new Error(`${sample}: no PDF coordinates were verified`);
}
console.log(`Renderer SVG placement smoke test passed for ${sample}.`);
NODE
  else
    status=$?
    printf 'Renderer smoke test failed for %s with exit code %s.\n' "$sample" "$status" >&2
    tail -n 100 "$console" >&2
    if [ -s "$output/compile.log" ]; then tail -n 200 "$output/compile.log" >&2; fi
    exit "$status"
  fi
done
