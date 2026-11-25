#!/bin/sh
set -eu

image=${1:?Installed immutable Runtime image ID required}
mode=${2:-templates}
case "$image" in
  sha256:*) ;;
  *) printf '%s\n' 'Use the immutable image ID reported by Docker' >&2; exit 64 ;;
esac
[ "$(docker image inspect --format '{{.Id}}' "$image")" = "$image" ]
case "$mode" in
  templates) samples='japanese-math japanese-report tikz-figure' ;;
  tagged-ja) samples='japanese-tagged' ;;
  date-profile) samples='date-a date-b' ;;
  *) printf '%s\n' 'Unknown authoring fixture set' >&2; exit 64 ;;
esac
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$repo_root/deploy/scripts/smoke-container.sh"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
chmod 0755 "$root"
mkdir -m 0755 "$root/input"
for sample in $samples; do
  set --
  case "$sample" in
    date-a|date-b)
      case "$sample" in
        date-a) epoch=1714998840; expected='2024-5-6 / 754' ;;
        date-b) epoch=1715072700; expected='2024-5-7 / 545' ;;
      esac
      cat > "$root/input/main.tex" <<'TEX'
\documentclass{article}
\begin{document}
\noindent\texttt{\number\year-\number\month-\number\day\ / \number\time}
\end{document}
TEX
      set -- --env "SOURCE_DATE_EPOCH=$epoch" --env FORCE_SOURCE_DATE=1 \
        --env TZ=UTC --env "EXPECTED_DATE_TEXT=$expected"
      ;;
    *)
      cp "$repo_root/integrations/latex-renderer/assets/$sample.tex" "$root/input/main.tex"
      ;;
  esac
  output="$root/$sample"
  mkdir -m 0700 "$output"
  run_smoke_container "$image" "$output" \
    --network none --read-only --cap-drop ALL \
    --security-opt "seccomp=$repo_root/deploy/security/seccomp.json" \
    --pids-limit 128 --memory 1g --cpus 1.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
    --entrypoint /bin/sh --env LATEX_OUTPUTS=pdf --env "SAMPLE=$sample" "$@" \
    --mount "type=bind,src=$root/input,dst=/work/input,readonly" "$image" -ec '
      /opt/renderer/compile.sh
      qpdf --check /work/output/result.pdf
      pdftotext -enc UTF-8 /work/output/result.pdf /tmp/smoke-text
      [ -s /tmp/smoke-text ]
      if [ -n "${EXPECTED_DATE_TEXT:-}" ]; then
        grep -Fx "$EXPECTED_DATE_TEXT" /tmp/smoke-text
      fi
      if [ "$SAMPLE" = japanese-tagged ]; then
        grep -F "長方形" /tmp/smoke-text
        pdfinfo /work/output/result.pdf > /tmp/smoke-info
        grep -E "^Tagged: +yes$" /tmp/smoke-info
      fi
    ' > "$root/$sample.log" 2>&1 || {
      cat "$root/$sample.log" >&2
      if [ -r "$output/compile.log" ]; then tail -100 "$output/compile.log" >&2; fi
      exit 70
    }
  [ -s "$output/result.pdf" ] && [ -s "$output/previews/page-1.png" ]
  printf 'Authoring fixture %s passed with %s.\n' "$sample" "$image" >&2
done
if [ "$mode" = tagged-ja ]; then
  fixture_sha=$(sha256sum "$repo_root/integrations/latex-renderer/assets/japanese-tagged.tex" | cut -d ' ' -f 1)
  printf '{"schemaVersion":1,"runtimeImage":"%s","fixtureSha256":"%s","profile":"tagged-ja-v1","machineChecks":["pdf-structure","tagged","japanese-text"],"readingOrder":"not_checked","pdfUa":"not_checked"}\n' "$image" "$fixture_sha"
fi
