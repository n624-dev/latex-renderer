#!/bin/sh
set -eu

base_image=${1:?usage: build-language-runtime.sh BASE_IMAGE TEXLIVE_REPOSITORY OUTPUT_TAG [collection-lang...]}
repository=${2:?usage: build-language-runtime.sh BASE_IMAGE TEXLIVE_REPOSITORY OUTPUT_TAG [collection-lang...]}
output_tag=${3:?usage: build-language-runtime.sh BASE_IMAGE TEXLIVE_REPOSITORY OUTPUT_TAG [collection-lang...]}
shift 3

case "$repository" in
  https://*/*/tlnet) ;;
  *) echo "TeX Live repository must be an https tlnet URL" >&2; exit 64 ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
renderer_source=${RENDERER_RUNTIME_SOURCE:-$repo_root/renderer}
runtime_files="texmf.cnf latexmkrc compile.sh svg-wrapper.tex export-svg.pl"
for file in $runtime_files; do
  if [ ! -f "$renderer_source/$file" ]; then
    echo "Missing current renderer runtime file: $renderer_source/$file" >&2
    exit 66
  fi
done

base_image_id=$(docker image inspect "$base_image" --format '{{.Id}}')
case "$base_image_id" in
  sha256:[0-9a-f][0-9a-f]*) ;;
  *) echo "Could not resolve immutable base image ID: $base_image" >&2; exit 65 ;;
esac
base_lock_tag="latex-renderer:base-lock-$(printf '%s' "${base_image_id#sha256:}" | cut -c1-24)"
docker image tag "$base_image_id" "$base_lock_tag"

languages=
for language in "$@"; do
  case "$language" in
    collection-lang*) ;;
    *) echo "Invalid TeX Live language collection: $language" >&2; exit 64 ;;
  esac
  suffix=${language#collection-lang}
  case "$suffix" in
    ''|*[!A-Za-z0-9._-]*) echo "Invalid TeX Live language collection: $language" >&2; exit 64 ;;
  esac
  languages="$languages $language"
done
languages=$(printf '%s' "$languages" | sed 's/^ *//')

runtime_fingerprint=$(
  for file in $runtime_files; do
    digest=$(sha256sum "$renderer_source/$file" | cut -d' ' -f1)
    printf '%s %s\n' "$file" "$digest"
  done | sha256sum | cut -d' ' -f1
)
case "$runtime_fingerprint" in
  [0-9a-f][0-9a-f]*) ;;
  *) echo "Could not calculate renderer runtime fingerprint" >&2; exit 65 ;;
esac

tmp=$(mktemp -d)
cleanup() {
  rm -rf "$tmp"
  docker image rm "$base_lock_tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
# TMPDIR is setgid in production. GNU chmod preserves directory setgid bits
# unless an extra leading zero explicitly clears them; RestrictSUIDSGID then
# rejects the implicit 02755 chmod with EPERM.
chmod 00755 "$tmp"
mkdir "$tmp/runtime"
for file in $runtime_files; do
  cp "$renderer_source/$file" "$tmp/runtime/$file"
done
printf '%s\n' "$languages" | tr ' ' '\n' | sed '/^$/d' > "$tmp/languages.txt"
chmod -R a+rX "$tmp/runtime"
chmod 0644 "$tmp/languages.txt"

cat > "$tmp/Dockerfile" <<'DOCKERFILE'
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
ARG TEXLIVE_REPOSITORY
ARG TEXLIVE_LANGUAGES
ARG RENDERER_RUNTIME_FINGERPRINT
RUN if [ -n "${TEXLIVE_LANGUAGES}" ]; then \
      tlmgr option repository "${TEXLIVE_REPOSITORY}" \
      && for language in ${TEXLIVE_LANGUAGES}; do \
           tlmgr info --repository "${TEXLIVE_REPOSITORY}" --data name "$language" \
             | sed 's/^name: //' \
             | grep -qx "$language" \
             || { echo "Selected TeX Live language collection is unavailable in this snapshot: $language" >&2; exit 65; }; \
         done \
      && tlmgr install ${TEXLIVE_LANGUAGES} \
      && mktexlsr \
      && fmtutil-sys --all \
      && fc-cache -f \
      && TEXMFCACHE=/opt/texlive/2026/texmf-var luaotfload-tool --update --force --no-compress; \
    fi
COPY runtime/ /opt/renderer/
COPY languages.txt /opt/renderer/language-collections.txt
RUN chmod 0555 /opt/renderer/compile.sh /opt/renderer/export-svg.pl \
 && chmod 0444 /opt/renderer/texmf.cnf /opt/renderer/latexmkrc /opt/renderer/svg-wrapper.tex /opt/renderer/language-collections.txt
USER 10000:10000
WORKDIR /work/input
# Docker clears a base image CMD when a derived image sets a new ENTRYPOINT, so
# no inherited Base CMD arguments can reach compile.sh.
ENTRYPOINT ["/opt/renderer/compile.sh"]
DOCKERFILE
chmod 0644 "$tmp/Dockerfile"

docker build \
  --build-arg "BASE_IMAGE=$base_lock_tag" \
  --build-arg "TEXLIVE_REPOSITORY=$repository" \
  --build-arg "TEXLIVE_LANGUAGES=$languages" \
  --build-arg "RENDERER_RUNTIME_FINGERPRINT=$runtime_fingerprint" \
  --label "jp.n624.latex-renderer.languages=$(printf '%s' "$languages" | sed 's/ /,/g')" \
  --label "jp.n624.latex-renderer.base-image-id=$base_image_id" \
  --label "jp.n624.latex-renderer.renderer-runtime-fingerprint=$runtime_fingerprint" \
  --tag "$output_tag" \
  "$tmp"

printf 'Built %s from TeX base %s with current renderer %s and languages: %s\n' \
  "$output_tag" "$base_image_id" "$runtime_fingerprint" "${languages:-none}"
