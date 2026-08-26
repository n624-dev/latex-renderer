#!/bin/sh
set -eu

origin=${LATEX_RENDER_BASE_URL:?LATEX_RENDER_BASE_URL is required}

curl --fail --silent --show-error "$origin/" | grep -F 'LaTeX Renderer' >/dev/null
curl --fail --silent --show-error "$origin/downloads/client/manifest.json" >/dev/null
curl --fail --silent --show-error "$origin/downloads/client/install.mjs" >/dev/null
curl --fail --silent --show-error "$origin/downloads/windows/install.ps1" >/dev/null
curl --fail --silent --show-error "$origin/api/v1/health" | grep -F '"status":"ok"' >/dev/null

# API endpoints must not redirect. 401/411/400 prove that the expected
# application handled the request without forwarding credentials elsewhere.
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-redirs 0 -X POST "$origin/api/v1/render-tickets")
case "$status" in 400|401|411|413) ;; *) echo "unexpected gateway status: $status" >&2; exit 1 ;; esac
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-redirs 0 "$origin/api/v1/jobs/not-a-job")
[ "$status" = 400 ] || { echo "renderer API routing failed: $status" >&2; exit 1; }

echo "Unified public-origin smoke checks passed."
