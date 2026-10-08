#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || {
  echo "cloudflared-update must run as root" >&2
  exit 77
}
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
source_file=/etc/apt/sources.list.d/cloudflared.list
key_file=/usr/share/keyrings/cloudflare-main.gpg
for file in "$source_file" "$key_file"; do
  [ -f "$file" ] && [ ! -L "$file" ] &&
    [ "$(stat -c %u "$file")" = 0 ] &&
    [ "$((0$(stat -c %a "$file") & 022))" = 0 ] || {
      echo "Cloudflare APT source/key must be regular root-controlled files" >&2
      exit 78
    }
done
# Accept exactly the documented signed Stable source, plus comments/blank lines.
# Never accept trusted=yes, extra sources or next.pkg.cloudflare.com (Nightly).
awk '
  /^[[:space:]]*(#|$)/ { next }
  NF == 5 && $1 == "deb" &&
    $2 == "[signed-by=/usr/share/keyrings/cloudflare-main.gpg]" &&
    $3 == "https://pkg.cloudflare.com/cloudflared" &&
    $4 == "any" && $5 == "main" { count++; next }
  { bad = 1 }
  END { exit (bad || count != 1) }
' "$source_file" || {
  echo "Only the official signed Cloudflare Stable APT source is allowed" >&2
  exit 78
}

# Apply isolation to policy, simulation AND install, not just index refresh.
# Do not reuse a binary cache containing another repository's candidates.
stable_apt() {
  command=$1
  shift
  "$command" \
    -o Dir::Etc::sourcelist=sources.list.d/cloudflared.list \
    -o Dir::Etc::sourceparts=- \
    -o Dir::Cache::pkgcache= -o Dir::Cache::srcpkgcache= \
    -o APT::Get::List-Cleanup=0 \
    -o APT::Get::AllowUnauthenticated=false \
    -o Acquire::AllowInsecureRepositories=false \
    -o Acquire::AllowDowngradeToInsecureRepositories=false \
    -o DPkg::Lock::Timeout=300 \
    -o Acquire::Retries=3 -o Acquire::http::Timeout=60 \
    -o Acquire::https::Timeout=60 "$@"
}

before=$(dpkg-query -W -f='${Version}' cloudflared)
stable_apt apt-get update --error-on=any
policy=$(stable_apt apt-cache policy cloudflared)
candidate=$(printf '%s\n' "$policy" | awk '
  $1 == "Candidate:" { count++; version = $2; if (NF != 2) bad = 1 }
  END { if (count != 1 || bad) exit 1; print version }
') || {
  echo "Cloudflare Stable candidate is missing or ambiguous" >&2
  exit 78
}
printf '%s\n' "$candidate" | grep -Eq '^[0-9]{4}\.[0-9]+\.[0-9]+$' || {
  echo "No stable calendar-version cloudflared candidate is available" >&2
  exit 78
}
if dpkg --compare-versions "$candidate" lt "$before"; then
  echo "Refusing a cloudflared downgrade" >&2
  exit 78
fi
if [ "$before" != "$candidate" ]; then
  plan=$(stable_apt apt-get --simulate install --only-upgrade \
    --no-install-recommends --no-remove "cloudflared=$candidate")
  printf '%s\n' "$plan" | awk '
    /^(Inst|Conf|Remv) / {
      if ($1 == "Remv" || $2 != "cloudflared") bad = 1
    }
    END { exit bad }
  ' || {
    echo "Refusing changes to packages other than cloudflared" >&2
    exit 78
  }
  stable_apt apt-get install --only-upgrade --no-install-recommends \
    --no-remove --yes "cloudflared=$candidate"
fi
after=$(dpkg-query -W -f='${Version}' cloudflared)
[ "$after" = "$candidate" ] || {
  echo "Installed cloudflared does not match the verified Stable candidate" >&2
  exit 1
}

if [ "$before" != "$after" ]; then
  systemctl restart cloudflared.service
fi
systemctl is-active --quiet cloudflared.service
cloudflared --version
