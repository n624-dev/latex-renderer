#!/bin/sh
set -eu

config=${1:-deploy/cloudflared/config.example.yml}
origin=${LATEX_RENDER_BASE_URL:-https://latex.example.com}
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required to validate ingress rules" >&2
  exit 69
fi

cloudflared tunnel --config "$config" ingress validate

assert_rule() {
  url=$1
  expected=$2
  output=$(cloudflared tunnel --config "$config" ingress rule "$url")
  printf '%s\n' "$output"
  printf '%s' "$output" | grep -F "$expected" >/dev/null || {
    echo "unexpected route for $url; expected $expected" >&2
    exit 65
  }
}

assert_rule "$origin/admin/api/v1/me" 127.0.0.1:3102
assert_rule "$origin/.well-known/oauth-protected-resource/mcp" 127.0.0.1:3104
assert_rule "$origin/oauth/authorize" 127.0.0.1:3104
assert_rule "$origin/mcp" 127.0.0.1:3104
assert_rule "$origin/admin/" 127.0.0.1:3101
assert_rule "$origin/app/api/v1/me" 127.0.0.1:3102
assert_rule "$origin/app/" 127.0.0.1:3101
assert_rule "$origin/api/v1/jobs/job_00000000000000000000000000000000" 127.0.0.1:3100
assert_rule "$origin/downloads/" 127.0.0.1:3101

echo "Unified routing reference is valid."
