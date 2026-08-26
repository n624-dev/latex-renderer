#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$repository_root"

node deploy/scripts/sync-public-worker-routes.mjs
deploy/scripts/smoke-test-public-worker-boundary.sh
deploy/scripts/smoke-test-unified-origin.sh

echo "Public Worker, Access boundary, Gateway, and VPS health checks passed."
