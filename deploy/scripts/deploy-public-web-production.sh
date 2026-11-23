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
    pnpm --filter @latex-renderer/public-web exec wrangler rollback "$version_id" \
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

pnpm --filter @latex-renderer/public-web exec wrangler deployments list --json \
  >"$temporary_root/deployments-before.json"
previous_version=$(node deploy/scripts/read-active-worker-version.mjs \
  "$temporary_root/deployments-before.json")

# Validation and the local Workers runtime preview complete before any remote
# Worker version or production route can change.
pnpm check
sh deploy/scripts/prepare-public-release-client.sh
node apps/public-web/build.mjs
pnpm --filter @latex-renderer/public-web check:preview

pnpm --filter @latex-renderer/public-web exec wrangler versions upload \
  --message "Public guides $(git rev-parse --short HEAD)" >"$temporary_root/upload.log"
version_id=$(sed -n 's/^Worker Version ID: //p' "$temporary_root/upload.log")
preview_url=$(sed -n 's/^Version Preview URL: //p' "$temporary_root/upload.log")
printf '%s\n' "$version_id" | grep -Eq '^[0-9a-f-]{36}$'
printf '%s\n' "$preview_url" | grep -Eq '^https://[a-z0-9.-]+\.workers\.dev/?$'
node apps/public-web/check-live-content.mjs "$preview_url"

node deploy/scripts/sync-public-worker-routes.mjs
pnpm --filter @latex-renderer/public-web exec wrangler deployments list --json \
  >"$temporary_root/deployments-current.json"
[ "$(node deploy/scripts/read-active-worker-version.mjs "$temporary_root/deployments-current.json")" = "$previous_version" ] || {
  echo "The active Worker changed during preview. Repeat the deployment against its new baseline." >&2
  exit 1
}
pnpm --filter @latex-renderer/public-web exec wrangler versions deploy "$version_id@100" --yes
if ! node apps/public-web/check-live-content.mjs "$public_origin" ||
  ! deploy/scripts/smoke-test-public-worker-boundary.sh ||
  ! deploy/scripts/smoke-test-unified-origin.sh; then
  echo "Public verification failed. Restoring the previous Worker version." >&2
  pnpm --filter @latex-renderer/public-web exec wrangler rollback "$previous_version" \
    --message "Restore previous public site after verification failure"
  exit 1
fi

pnpm --filter @latex-renderer/public-web exec wrangler deployments list --json \
  >"$temporary_root/deployments-after.json"
current_version=$(node deploy/scripts/read-active-worker-version.mjs \
  "$temporary_root/deployments-after.json")

echo "Production public Web deployed and verified: $current_version"
echo "Previous version: $previous_version"
echo "Version rollback: deploy/scripts/deploy-public-web-production.sh --rollback-version $previous_version"
echo "VPS rollback: deploy/scripts/deploy-public-web-production.sh --rollback-vps"
