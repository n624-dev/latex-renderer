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
# Keep a registry image on its immutable digest-qualified reference. Docker's
# containerd image store may resolve lazy GHCR layers during export; replacing
# the reference with a docker.io local tag loses the original pull scope. A
# locally rebuilt dated Base has no RepoDigest and uses an ID-locked local tag.
base_repo_digest=$(docker image inspect "$base_image" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}')
base_lock_tag=
case "$base_repo_digest" in
  *@sha256:[0-9a-f][0-9a-f]*) base_lock_ref=$base_repo_digest ;;
  *)
    base_lock_tag="latex-renderer:base-lock-$(printf '%s' "${base_image_id#sha256:}" | cut -c1-24)"
    docker image tag "$base_image_id" "$base_lock_tag"
    base_lock_ref=$base_lock_tag
    ;;
esac

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
languages=$(printf '%s' "$languages" | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/ *$//')

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
runtime_identity=$(
  {
    printf 'runtime-v1\n%s\n%s\n' "$base_image_id" "$runtime_fingerprint"
    for language in $languages; do printf '%s\n' "$language"; done
  } | sha256sum | cut -d' ' -f1
)
case "$runtime_identity" in
  [0-9a-f][0-9a-f]*) ;;
  *) echo "Could not calculate Runtime identity" >&2; exit 65 ;;
esac

tmp=$(mktemp -d)
cleanup() {
  rm -rf "$tmp"
  if [ -n "$base_lock_tag" ]; then
    docker image rm "$base_lock_tag" >/dev/null 2>&1 || true
  fi
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

set -- docker build
if [ -n "${RUNTIME_BUILDX_BUILDER:-}" ]; then
  case "$RUNTIME_BUILDX_BUILDER" in
    [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) echo "RUNTIME_BUILDX_BUILDER is invalid" >&2; exit 64 ;;
  esac
  set -- docker buildx build --builder "$RUNTIME_BUILDX_BUILDER"
fi

case "${RUNTIME_NO_CACHE:-false}" in
  true) set -- "$@" --no-cache ;;
  false) ;;
  *) echo "RUNTIME_NO_CACHE must be true or false" >&2; exit 64 ;;
esac

"$@" \
  --load \
  --build-arg "BASE_IMAGE=$base_lock_ref" \
  --build-arg "TEXLIVE_REPOSITORY=$repository" \
  --build-arg "TEXLIVE_LANGUAGES=$languages" \
  --build-arg "RENDERER_RUNTIME_FINGERPRINT=$runtime_fingerprint" \
  --label "jp.n624.latex-renderer.languages=$(printf '%s' "$languages" | sed 's/ /,/g')" \
  --label "jp.n624.latex-renderer.base-image-id=$base_image_id" \
  --label "jp.n624.latex-renderer.renderer-runtime-fingerprint=$runtime_fingerprint" \
  --label "jp.n624.latex-renderer.runtime-kind=managed-local-v1" \
  --label "jp.n624.latex-renderer.runtime-identity=$runtime_identity" \
  --label "org.opencontainers.image.source=https://github.com/n624-dev/latex-renderer" \
  --tag "$output_tag" \
  "$tmp"

printf 'Built %s from TeX base %s with current renderer %s and languages: %s\n' \
  "$output_tag" "$base_image_id" "$runtime_fingerprint" "${languages:-none}"
