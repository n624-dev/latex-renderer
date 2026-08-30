#!/bin/sh
set -eu

origin=${LATEX_RENDER_BASE_URL:?LATEX_RENDER_BASE_URL is required}
boundary_attempts=${LATEX_RENDER_BOUNDARY_ATTEMPTS:-24}
boundary_retry_delay=${LATEX_RENDER_BOUNDARY_RETRY_DELAY_SECONDS:-5}
remote_mcp_local_origin=${LATEX_RENDER_REMOTE_MCP_LOCAL_ORIGIN:-http://127.0.0.1:3104}
public_host=$(printf '%s' "$origin" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')
temporary_root=$(mktemp -d /tmp/latex-renderer-boundary.XXXXXX)
cleanup() { rm -rf -- "$temporary_root"; }
trap cleanup EXIT INT TERM HUP

request() {
  name=$1
  method=$2
  path=$3
  curl --silent --show-error --max-redirs 0 -X "$method" \
    -D "$temporary_root/$name.headers" -o "$temporary_root/$name.body" \
    --write-out '%{http_code}' "$origin$path"
}

request_with_origin() {
  name=$1
  method=$2
  path=$3
  request_origin=$4
  curl --silent --show-error --max-redirs 0 -X "$method" \
    -H "Origin: $request_origin" \
    -D "$temporary_root/$name.headers" -o "$temporary_root/$name.body" \
    --write-out '%{http_code}' "$origin$path"
}

assert_worker() {
  name=$1
  path=$2
  expected_status=$3
  attempt=1
  while [ "$attempt" -le "$boundary_attempts" ]; do
    status=$(request "$name" GET "$path")
    if [ "$status" = "$expected_status" ] && \
      grep -qi '^X-LaTeX-Renderer-Serving: workers-static' "$temporary_root/$name.headers"; then
      return
    fi
    [ "$attempt" -lt "$boundary_attempts" ] || break
    sleep "$boundary_retry_delay"
    attempt=$((attempt + 1))
  done
  echo "public Worker did not converge for $path after $boundary_attempts attempts (last status: $status)" >&2
  exit 1
}

assert_not_worker() {
  name=$1
  method=$2
  path=$3
  allowed_statuses=$4
  status=$(request "$name" "$method" "$path")
  case " $allowed_statuses " in
    *" $status "*) ;;
    *) echo "unexpected origin status for $path: $status" >&2; exit 1 ;;
  esac
  if grep -qi '^X-LaTeX-Renderer-Serving: workers-static' "$temporary_root/$name.headers"; then
    echo "private or dynamic path was swallowed by the public Worker: $path" >&2
    exit 1
  fi
}

assert_not_worker_with_origin() {
  name=$1
  method=$2
  path=$3
  request_origin=$4
  allowed_statuses=$5
  status=$(request_with_origin "$name" "$method" "$path" "$request_origin")
  case " $allowed_statuses " in
    *" $status "*) ;;
    *) echo "unexpected origin status for $path with Origin $request_origin: $status" >&2; exit 1 ;;
  esac
  if grep -qi '^X-LaTeX-Renderer-Serving: workers-static' "$temporary_root/$name.headers"; then
    echo "private or dynamic path was swallowed by the public Worker: $path" >&2
    exit 1
  fi
}

assert_oauth_consent_authentication() {
  name=$1
  public_status=$(curl --silent --show-error --max-redirs 0 -X POST \
    -H "Origin: $origin" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data 'csrf=invalid&decision=approve' \
    -D "$temporary_root/$name.headers" -o "$temporary_root/$name.body" \
    --write-out '%{http_code}' "$origin/oauth/authorize")
  case "$public_status" in
    302|403) ;;
    *) echo "unexpected public OAuth consent status: $public_status" >&2; exit 1 ;;
  esac
  if grep -qi '^X-LaTeX-Renderer-Serving: workers-static' "$temporary_root/$name.headers"; then
    echo "OAuth consent was swallowed by the public Worker" >&2
    exit 1
  fi

  # The public authorization route is protected by Cloudflare Access, which
  # redirects an unauthenticated smoke request before it reaches the app. Probe
  # the deployed loopback service as well: POST consent must authenticate the
  # browser before it reads the form or checks same-origin CSRF. Authenticated
  # cross-origin rejection is covered by the Remote MCP integration tests.
  local_status=$(curl --silent --show-error --max-redirs 0 -X POST \
    -H "Host: $public_host" \
    -H "Origin: $origin" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data 'csrf=invalid&decision=approve' \
    -o "$temporary_root/$name.local.body" \
    --write-out '%{http_code}' "$remote_mcp_local_origin/oauth/authorize")
  if [ "$local_status" != "401" ] ||
    ! grep -q 'A browser login is required' "$temporary_root/$name.local.body" ||
    grep -q 'Origin is not allowed' "$temporary_root/$name.local.body"; then
    echo "OAuth consent did not stop at browser authentication (local status: $local_status)" >&2
    exit 1
  fi
}

assert_worker root / 200
assert_worker docs /docs/ 200
assert_worker downloads /downloads/ 200
assert_worker mcpb /downloads/mcpb/latest.mcpb 200
assert_worker asset /assets/styles.css 200
assert_worker login-script /assets/login.js 200
assert_worker openapi /openapi/gateway.openapi.yaml 200
assert_worker missing-doc /docs/definitely-not-present 404

assert_worker legacy-client /client/install.ps1 308
grep -qi '^Location: /downloads/windows/install.ps1' "$temporary_root/legacy-client.headers" || {
  echo "legacy client redirect target is incorrect" >&2
  exit 1
}

# Cloudflare Access may answer the admin probes before the VPS does. Either way,
# these paths must never receive the public static Worker response.
assert_not_worker admin GET /admin/ "200 302 401 403"
assert_not_worker admin-api GET /admin/api/v1/me "200 302 401 403"
assert_not_worker app GET /app/ "200 302 401 403"
assert_not_worker app-api GET /app/api/v1/me "200 302 401 403"
assert_not_worker oauth-metadata GET /.well-known/oauth-protected-resource/mcp "200"
assert_not_worker remote-mcp POST /mcp "401"
# OAuth clients legitimately send their own Origin to the token-authenticated
# MCP endpoint. Browser consent itself is hosted here and remains same-origin.
assert_not_worker_with_origin remote-mcp-claude POST /mcp https://claude.ai "401"
assert_not_worker_with_origin remote-mcp-generic POST /mcp https://ai-client.example "401"
assert_oauth_consent_authentication oauth-consent
for name in admin admin-api app app-api; do
  grep -Eqi '^Cache-Control:.*no-store' "$temporary_root/$name.headers" || {
    echo "administrator response is missing no-store protection: $name" >&2
    exit 1
  }
done
assert_not_worker status GET /status/ "200"

# Invalid identifiers and missing credentials exercise every dynamic route class
# without creating jobs or uploads. A redirect or static 404 is always a failure.
assert_not_worker render-ticket POST /api/v1/render-tickets "400 401 411 413"
assert_not_worker source-ticket POST /api/v1/source-tickets "400 401 411 413"
assert_not_worker job-ticket POST /api/v1/job-tickets/not-a-job "400 401"
assert_not_worker job-status GET /api/v1/jobs/not-a-job "400 401"
assert_not_worker upload PUT /api/v1/jobs/not-a-job/source "400 401"
assert_not_worker source-upload PUT /api/v1/sources/not-a-source/content "400 401"
assert_not_worker artifact GET /api/v1/jobs/not-a-job/artifacts/result.pdf "400 401"
assert_not_worker unknown GET /definitely-not-a-public-route "404"

echo "Public Worker boundary smoke checks passed."
