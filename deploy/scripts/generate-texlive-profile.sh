#!/bin/sh
set -eu

repository=${1:?usage: generate-texlive-profile.sh REPOSITORY OUTPUT}
output=${2:?usage: generate-texlive-profile.sh REPOSITORY OUTPUT}
curl_connect_timeout=${TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS:-10}
curl_max_time=${TEXLIVE_PROFILE_CURL_MAX_TIME_SECONDS:-180}
case "$curl_connect_timeout:$curl_max_time" in
  *[!0-9:]*) echo "TeX Live curl timeouts must be integers" >&2; exit 64 ;;
esac
if [ "$curl_connect_timeout" -lt 1 ] || [ "$curl_connect_timeout" -gt 120 ] || [ "$curl_max_time" -lt 10 ] || [ "$curl_max_time" -gt 1800 ]; then
  echo "TeX Live profile curl timeouts are outside the supported range" >&2
  exit 64
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

curl --fail --location --retry 4 --retry-delay 1 --silent --show-error \
  --connect-timeout "$curl_connect_timeout" --max-time "$curl_max_time" \
  --output "$tmp/texlive.tlpdb.xz" "$repository/tlpkg/texlive.tlpdb.xz"
xz -dc "$tmp/texlive.tlpdb.xz" > "$tmp/texlive.tlpdb"

awk '
  /^name scheme-full$/ { in_scheme=1; next }
  in_scheme && /^$/ { exit }
  in_scheme && /^depend collection-/ {
    name=$2
    if (name !~ /^collection-lang/) print name
  }
' "$tmp/texlive.tlpdb" | LC_ALL=C sort -u > "$tmp/collections"

if [ ! -s "$tmp/collections" ]; then
  echo "Could not resolve scheme-full collections from $repository" >&2
  exit 65
fi
if grep -q '^collection-lang' "$tmp/collections"; then
  echo "Language collection leaked into generated base profile" >&2
  exit 65
fi

cat > "$output" <<'PROFILE'
selected_scheme scheme-custom
TEXDIR /opt/texlive/2026
TEXMFCONFIG /tmp/texlive/texmf-config
TEXMFHOME /tmp/texlive/texmf-home
TEXMFLOCAL /opt/texlive/texmf-local
TEXMFSYSCONFIG /opt/texlive/2026/texmf-config
TEXMFSYSVAR /opt/texlive/2026/texmf-var
TEXMFVAR /tmp/texlive/texmf-var
binary_x86_64-linux 1
instopt_adjustpath 0
instopt_adjustrepo 1
instopt_letter 0
instopt_portable 0
instopt_write18_restricted 0
tlpdbopt_autobackup 0
tlpdbopt_create_formats 1
tlpdbopt_desktop_integration 0
tlpdbopt_file_assocs 0
tlpdbopt_generate_updmap 1
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_post_code 1
tlpdbopt_sys_bin /usr/local/bin
tlpdbopt_sys_info /usr/local/share/info
tlpdbopt_sys_man /usr/local/share/man
PROFILE
while IFS= read -r collection; do
  printf '%s 1\n' "$collection" >> "$output"
done < "$tmp/collections"

printf 'Generated %s with %s non-language scheme-full collections.\n' \
  "$output" "$(wc -l < "$tmp/collections" | tr -d ' ')"
