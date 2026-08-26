#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
public_origin=${PUBLIC_ORIGIN:-${LATEX_RENDER_BASE_URL:-}}
if [ -z "$public_origin" ]; then
  echo "PUBLIC_ORIGIN or LATEX_RENDER_BASE_URL is required" >&2
  exit 64
fi
export PUBLIC_ORIGIN="$public_origin"
export LATEX_RENDER_BASE_URL="$public_origin"
preview_url=${LATEX_RENDER_PUBLIC_PREVIEW_URL:-}
cd "$repository_root"

case "${1:-deploy}" in
  --rollback-vps)
    node deploy/scripts/sync-public-worker-routes.mjs --disable
    deploy/scripts/smoke-test-unified-origin.sh
    echo "Public routes returned to the VPS origin."
    exit 0
    ;;
  --rollback-version)
    [ "$#" -eq 2 ] || {
      echo "usage: deploy-public-web-production.sh --rollback-version VERSION_ID" >&2
      exit 64
    }
    version_id=$2
    corepack pnpm --filter @latex-renderer/public-web exec wrangler rollback "$version_id" \
      --message "latex-renderer public Web rollback"
    deploy/scripts/smoke-test-public-worker-boundary.sh
    echo "Public Worker rolled back and verified: $version_id"
    exit 0
    ;;
  deploy)
    [ "$#" -le 1 ] || {
      echo "usage: deploy-public-web-production.sh [--rollback-vps|--rollback-version VERSION_ID]" >&2
      exit 64
    }
    if [ -z "$preview_url" ]; then
      echo "LATEX_RENDER_PUBLIC_PREVIEW_URL is required for deployment verification" >&2
      exit 64
    fi
    ;;
  *)
    echo "unknown operation: $1" >&2
    exit 64
    ;;
esac

[ "$(git symbolic-ref --quiet --short HEAD)" = "main" ] || {
  echo "production public Web deploys must run from the main branch" >&2
  exit 65
}
[ -z "$(git status --porcelain)" ] || {
  echo "production public Web deploys require a clean worktree" >&2
  exit 65
}
git fetch origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || {
  echo "local main must exactly match origin/main before production deploy" >&2
  exit 65
}

temporary_root=$(mktemp -d /tmp/latex-renderer-public-deploy.XXXXXX)
cleanup() { rm -rf -- "$temporary_root"; }
trap cleanup EXIT INT TERM HUP

corepack pnpm --filter @latex-renderer/public-web exec wrangler deployments list --json \
  >"$temporary_root/deployments-before.json"
previous_version=$(node deploy/scripts/read-active-worker-version.mjs \
  "$temporary_root/deployments-before.json")

# Validation and the local Workers runtime preview complete before any remote
# Worker version or production route can change.
corepack pnpm check
corepack pnpm --filter @latex-renderer/public-web run deploy

preview_attempt=1
while [ "$preview_attempt" -le 12 ]; do
  if curl --fail --silent --show-error --max-redirs 0 \
    -D "$temporary_root/preview.headers" -o "$temporary_root/preview.html" "$preview_url/" && \
    grep -qi '^X-LaTeX-Renderer-Serving: workers-static' "$temporary_root/preview.headers" && \
    grep -Fq 'LaTeXをPDFに変換' "$temporary_root/preview.html"; then
    break
  fi
  [ "$preview_attempt" -lt 12 ] || {
    echo "deployed workers.dev preview did not pass; production routes remain unchanged" >&2
    exit 1
  }
  sleep 2
  preview_attempt=$((preview_attempt + 1))
done

node deploy/scripts/sync-public-worker-routes.mjs --apply
if ! deploy/scripts/smoke-test-public-worker-boundary.sh; then
  echo "public boundary verification failed; returning public paths to the VPS" >&2
  node deploy/scripts/sync-public-worker-routes.mjs --disable
  deploy/scripts/smoke-test-unified-origin.sh
  exit 1
fi
deploy/scripts/smoke-test-unified-origin.sh

corepack pnpm --filter @latex-renderer/public-web exec wrangler deployments list --json \
  >"$temporary_root/deployments-after.json"
current_version=$(node deploy/scripts/read-active-worker-version.mjs \
  "$temporary_root/deployments-after.json")

echo "Production public Web deployed and verified: $current_version"
echo "Previous version: $previous_version"
echo "Version rollback: deploy/scripts/deploy-public-web-production.sh --rollback-version $previous_version"
echo "VPS rollback: deploy/scripts/deploy-public-web-production.sh --rollback-vps"
