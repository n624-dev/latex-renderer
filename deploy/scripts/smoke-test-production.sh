#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "smoke-test-production.sh must run as root" >&2
  exit 77
fi

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
database=/var/lib/latex-renderer/renderer.sqlite3
pepper=/etc/latex-renderer/secrets/api-key-pepper
admin_cli="$source_root/apps/admin-local/dist/index.js"
render_cli="$source_root/client-dist/latex-renderer-client/app/latex-render.cjs"
temporary_root=$(mktemp -d /tmp/latex-renderer-smoke.XXXXXX)
key_id=
service_account_id=
owner_email=${LATEX_RENDER_SMOKE_OWNER_EMAIL:-$(sqlite3 "$database" "SELECT email FROM users WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1;" 2>/dev/null || true)}

if [ -z "$owner_email" ]; then
  echo "an active owner or LATEX_RENDER_SMOKE_OWNER_EMAIL is required" >&2
  exit 64
fi
public_origin=$(sed -n 's/^PUBLIC_ORIGIN=//p' /etc/latex-renderer/renderer.env | tail -n 1)
if [ -z "$public_origin" ]; then
  echo "PUBLIC_ORIGIN is missing from /etc/latex-renderer/renderer.env" >&2
  exit 65
fi

cleanup() {
  if [ -n "$key_id" ] && [ -n "$service_account_id" ]; then
    env DATABASE_PATH="$database" API_KEY_PEPPER_ID=v1 API_KEY_PEPPER_FILE="$pepper" \
      /usr/local/bin/node "$admin_cli" smoke-key revoke \
      --key-id "$key_id" --service-account "$service_account_id" --yes >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT HUP INT TERM

env DATABASE_PATH="$database" API_KEY_PEPPER_ID=v1 API_KEY_PEPPER_FILE="$pepper" \
  /usr/local/bin/node "$admin_cli" smoke-key cleanup-jobs --yes >/dev/null

env DATABASE_PATH="$database" API_KEY_PEPPER_ID=v1 API_KEY_PEPPER_FILE="$pepper" \
  /usr/local/bin/node "$admin_cli" smoke-key create \
  --owner-email "$owner_email" --yes > "$temporary_root/key.json"

token=$(/usr/local/bin/node -e 'const x=require(process.argv[1]);process.stdout.write(x.token)' "$temporary_root/key.json")
key_id=$(/usr/local/bin/node -e 'const x=require(process.argv[1]);process.stdout.write(x.keyId)' "$temporary_root/key.json")
service_account_id=$(/usr/local/bin/node -e 'const x=require(process.argv[1]);process.stdout.write(x.serviceAccountId)' "$temporary_root/key.json")

install -d -m 0700 "$temporary_root/config" "$temporary_root/project"
printf '%s\n' \
  '\documentclass{ltjsarticle}' \
  '\usepackage{tikz}' \
  '\begin{document}' \
  '\section*{Production smoke test}' \
  '日本語とEnglishのLaTeXレンダリング確認。' \
  '\begin{tikzpicture}' \
  '\draw[blue,thick] (0,0) rectangle (4,1);' \
  '\node at (2,0.5) {日本語 / English};' \
  '\end{tikzpicture}' \
  '\end{document}' > "$temporary_root/project/main.tex"

printf '%s' "$token" | env XDG_CONFIG_HOME="$temporary_root/config" \
  /usr/local/bin/node "$render_cli" auth login --api-key-stdin >/dev/null
token=

env XDG_CONFIG_HOME="$temporary_root/config" \
  LATEX_RENDER_BASE_URL="$public_origin" \
  /usr/local/bin/node "$render_cli" render "$temporary_root/project" --json | tee "$temporary_root/render.json"

job_id=$(/usr/local/bin/node -e '
  const value=require(process.argv[1]);
  const serialized=JSON.stringify(value);
  if(value.success!==true||value.command!=="render"||value.result?.job?.status!=="succeeded")process.exit(1);
  if(/apiKey|uploadTicket|jobTicket/i.test(serialized))process.exit(1);
  process.stdout.write(value.result.job.id);
' "$temporary_root/render.json")
test -n "$job_id"
test -s "$temporary_root/project/.render/result.pdf"
test -s "$temporary_root/project/.render/previews/page-1.png"
/usr/local/bin/node -e 'const f=require("node:fs");const b=f.readFileSync(process.argv[1]);if(b.subarray(0,5).toString()!=="%PDF-")process.exit(1)' "$temporary_root/project/.render/result.pdf"
/usr/local/bin/node -e 'const f=require("node:fs");const b=f.readFileSync(process.argv[1]);if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))process.exit(1)' "$temporary_root/project/.render/previews/page-1.png"
/usr/local/bin/node -e 'const x=require(process.argv[1]);if(x.success!==true)process.exit(1)' "$temporary_root/project/.render/errors.json"

env XDG_CONFIG_HOME="$temporary_root/config" \
  LATEX_RENDER_BASE_URL="$public_origin" \
  /usr/local/bin/node "$render_cli" jobs delete "$job_id" --yes >/dev/null

echo "Production smoke test passed: Japanese/English PDF and PNG preview were rendered."
