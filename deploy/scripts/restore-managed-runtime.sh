#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "restore-managed-runtime.sh must run as root" >&2
  exit 77
fi

state_file=${IMAGE_MANAGER_STATE_FILE:-/var/lib/latex-renderer/image-manager/state.json}
renderer_env=${RENDERER_ENV_FILE:-/etc/latex-renderer/renderer.env}
environment_root=${RENDERER_ENVIRONMENT_ROOT:-/var/lib/latex-renderer/environment}
worker_user=${RENDERER_WORKER_USER:-latex-render-worker}
repo_root=${IMAGE_MANAGER_REPO_ROOT:-/opt/latex-renderer/current}
tmp_root=${TMPDIR:-/var/lib/latex-renderer/image-manager/tmp}
install -d -o root -g latex-renderer -m 0750 "$tmp_root"

[ -f "$state_file" ] || exit 0

state_values=$(/usr/local/bin/node - "$state_file" <<'NODE'
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const current = state.current;
if (!current || current.legacy === true || typeof current.runtimeImageId !== 'string') process.exit(0);
const languages = Array.isArray(current.languages) ? current.languages : [];
for (const value of [
  current.runtimeImageId,
  current.baseImageId ?? '',
  current.runtimeRef ?? '',
  current.snapshotDate ?? 'custom',
  languages.join(' '),
  state.previous?.runtimeImageId ?? '',
]) process.stdout.write(`${value}\n`);
NODE
) || {
  echo "Managed TeX image state is unreadable" >&2
  exit 78
}

runtime_image=$(printf '%s\n' "$state_values" | sed -n '1p')
base_image=$(printf '%s\n' "$state_values" | sed -n '2p')
runtime_ref=$(printf '%s\n' "$state_values" | sed -n '3p')
snapshot_date=$(printf '%s\n' "$state_values" | sed -n '4p')
languages=$(printf '%s\n' "$state_values" | sed -n '5p')
previous_runtime=$(printf '%s\n' "$state_values" | sed -n '6p')
[ -n "$runtime_image" ] || exit 0
[ -n "$base_image" ] || {
  echo "Managed TeX runtime has no clean base image recorded" >&2
  exit 78
}

worker_uid=$(id -u "$worker_user")
worker_home=$(getent passwd "$worker_user" | cut -d: -f6)
runtime_dir="/run/user/$worker_uid"
docker_host="unix://$runtime_dir/docker.sock"

rootless_docker() {
  runuser -u "$worker_user" -- env \
    HOME="$worker_home" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DOCKER_HOST="$docker_host" \
    docker "$@"
}

if ! rootless_docker image inspect "$runtime_image" >/dev/null 2>&1; then
  echo "Managed TeX runtime is configured but unavailable locally: $runtime_image" >&2
  echo "Refusing to fall back silently to the legacy renderer image." >&2
  exit 78
fi
if ! rootless_docker image inspect "$base_image" >/dev/null 2>&1; then
  echo "Managed TeX clean base is unavailable locally: $base_image" >&2
  echo "Refusing to replace the persisted runtime without its verified base." >&2
  exit 78
fi

runtime_files="texmf.cnf latexmkrc compile.sh svg-wrapper.tex export-svg.pl"
current_fingerprint=$(
  for file in $runtime_files; do
    [ -f "$repo_root/renderer/$file" ] || {
      echo "Missing current renderer runtime file: $repo_root/renderer/$file" >&2
      exit 66
    }
    digest=$(sha256sum "$repo_root/renderer/$file" | cut -d' ' -f1)
    printf '%s %s\n' "$file" "$digest"
  done | sha256sum | cut -d' ' -f1
)
image_fingerprint=$(rootless_docker image inspect "$runtime_image" \
  --format '{{index .Config.Labels "jp.n624.latex-renderer.renderer-runtime-fingerprint"}}' 2>/dev/null || true)

if [ "$image_fingerprint" != "$current_fingerprint" ]; then
  repository=$(rootless_docker image inspect "$base_image" \
    --format '{{index .Config.Labels "jp.n624.latex-renderer.texlive.repository"}}')
  case "$repository" in
    https://*/*/tlnet) ;;
    *) echo "Managed TeX base has an invalid repository label" >&2; exit 78 ;;
  esac

  hash=$(
    {
      printf '%s\n' "$base_image"
      for language in $languages; do printf '%s\n' "$language"; done
    } | sha256sum | cut -d' ' -f1 | cut -c1-16
  )
  new_runtime_ref="latex-renderer:runtime-${snapshot_date:-custom}-$hash"
  echo "Renderer code changed; rebuilding the managed runtime from its clean TeX base."
  env \
    TMPDIR="$tmp_root" \
    HOME="$worker_home" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DOCKER_HOST="$docker_host" \
    RENDERER_RUNTIME_SOURCE="$repo_root/renderer" \
    sh "$repo_root/deploy/scripts/build-language-runtime.sh" \
      "$base_image" "$repository" "$new_runtime_ref" $languages

  new_runtime_image=$(rootless_docker image inspect "$new_runtime_ref" --format '{{.Id}}')
  new_fingerprint=$(rootless_docker image inspect "$new_runtime_image" \
    --format '{{index .Config.Labels "jp.n624.latex-renderer.renderer-runtime-fingerprint"}}')
  if [ "$new_fingerprint" != "$current_fingerprint" ]; then
    echo "Rebuilt managed runtime does not contain the current renderer code" >&2
    exit 78
  fi

  env \
    TMPDIR="$tmp_root" \
    HOME="$worker_home" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DOCKER_HOST="$docker_host" \
    sh "$repo_root/deploy/scripts/smoke-test-renderer-basic.sh" "$new_runtime_image"

  effective_languages=$(rootless_docker run --rm --entrypoint /bin/sh "$new_runtime_image" -c \
    "tlmgr info --only-installed --data name 2>/dev/null | sed 's/^name: //' | grep '^collection-lang' || true")
  effective_csv=$(printf '%s\n' "$effective_languages" | sed '/^$/d' | paste -sd, -)

  old_runtime_image=$runtime_image
  runtime_image=$new_runtime_image
  runtime_ref=$new_runtime_ref
  /usr/local/bin/node - "$state_file" "$runtime_image" "$runtime_ref" "$current_fingerprint" "$effective_csv" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const runtimeImageId = process.argv[3];
const runtimeRef = process.argv[4];
const rendererRuntimeFingerprint = process.argv[5];
const effectiveLanguageCollections = process.argv[6]
  ? process.argv[6].split(',').filter(Boolean).sort()
  : [];
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!state.current || state.current.legacy === true) process.exit(78);
state.current.runtimeImageId = runtimeImageId;
state.current.runtimeRef = runtimeRef;
state.current.rendererRuntimeFingerprint = rendererRuntimeFingerprint;
state.current.effectiveLanguageCollections = effectiveLanguageCollections;
state.current.rendererUpdatedAt = new Date().toISOString();
state.updatedAt = new Date().toISOString();
const tmp = `${path}.part-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
fs.renameSync(tmp, path);
NODE

  if [ "$old_runtime_image" != "$runtime_image" ] && [ "$old_runtime_image" != "$previous_runtime" ]; then
    rootless_docker image rm "$old_runtime_image" >/dev/null 2>&1 || true
  fi
fi

old_image=$(sed -n 's/^RENDERER_IMAGE=//p' "$renderer_env" | tail -n 1)
if [ "$old_image" != "$runtime_image" ]; then
  tmp_env=$(mktemp /etc/latex-renderer/renderer.env.XXXXXX)
  trap 'rm -f -- "$tmp_env"' EXIT HUP INT TERM
  awk -v image="$runtime_image" '
    BEGIN { replaced=0 }
    /^RENDERER_IMAGE=/ { if (!replaced) { print "RENDERER_IMAGE=" image; replaced=1 } next }
    { print }
    END { if (!replaced) print "RENDERER_IMAGE=" image }
  ' "$renderer_env" > "$tmp_env"
  chown root:latex-renderer "$tmp_env"
  chmod 0640 "$tmp_env"
  mv -f "$tmp_env" "$renderer_env"
  trap - EXIT HUP INT TERM
fi

inventory_tmp=$(mktemp -d "$tmp_root/managed-environment.XXXXXX")
trap 'rm -rf -- "$inventory_tmp"' EXIT HUP INT TERM
rootless_docker run --rm --network none --read-only --entrypoint /bin/sh "$runtime_image" -c '
  { tlmgr info --only-installed --data name 2>/dev/null | sed "s/^name: //" | sed "/^$/d";
    find /opt/texlive/2026/texmf-dist/tex -type f \
      \( -name "*.sty" -o -name "*.cls" -o -name "*.tex" -o -name "*.lua" -o -name "*.bst" \) \
      -printf "%f\n" | sed "s/\.[^.]*$//"; } | LC_ALL=C sort -fu
' > "$inventory_tmp/packages.txt"
rootless_docker run --rm --network none --read-only --entrypoint /bin/sh "$runtime_image" -c '
  { fc-list --format "%{family}\n";
    find /opt/texlive/2026/texmf-dist/fonts -type f \
      \( -name "*.otf" -o -name "*.ttf" \) -print0 \
      | xargs -0 -r fc-scan --format "%{family}\n"; } \
    | tr "," "\n" | sed "/^[[:space:]]*$/d" | LC_ALL=C sort -fu
' > "$inventory_tmp/fonts.txt"

if [ ! -s "$inventory_tmp/packages.txt" ] || [ ! -s "$inventory_tmp/fonts.txt" ]; then
  echo "Managed TeX runtime inventory generation failed" >&2
  exit 76
fi
install -d -o root -g latex-renderer -m 0750 "$environment_root"
install -o root -g latex-renderer -m 0640 \
  "$inventory_tmp/packages.txt" "$inventory_tmp/fonts.txt" "$environment_root/"

echo "Restored managed TeX runtime: $runtime_image"
