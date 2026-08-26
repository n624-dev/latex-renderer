#!/bin/sh
set -eu

archive_root=${TEXLIVE_ARCHIVE_ROOT:-https://texlive.info/tlnet-archive}
requested=${1:-latest}
max_lookback=${TEXLIVE_SNAPSHOT_LOOKBACK_DAYS:-14}
curl_connect_timeout=${TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS:-10}
curl_max_time=${TEXLIVE_CURL_MAX_TIME_SECONDS:-60}
# The image layout, profile paths, and runtime inventory are intentionally tied
# to TeX Live 2026 in this release. Do not silently consume a future annual
# archive into /opt/texlive/2026; require an explicit annual migration instead.
supported_year=2026

for pair in "$max_lookback:TEXLIVE_SNAPSHOT_LOOKBACK_DAYS" "$curl_connect_timeout:TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS" "$curl_max_time:TEXLIVE_CURL_MAX_TIME_SECONDS"; do
  value=${pair%%:*}
  name=${pair#*:}
  case "$value" in ''|*[!0-9]*) echo "$name must be a positive integer" >&2; exit 64 ;; esac
done
if [ "$max_lookback" -lt 1 ] || [ "$max_lookback" -gt 90 ]; then
  echo "TEXLIVE_SNAPSHOT_LOOKBACK_DAYS must be between 1 and 90" >&2
  exit 64
fi
if [ "$curl_connect_timeout" -lt 1 ] || [ "$curl_connect_timeout" -gt 120 ] || [ "$curl_max_time" -lt 5 ] || [ "$curl_max_time" -gt 600 ]; then
  echo "TeX Live curl timeouts are outside the supported range" >&2
  exit 64
fi

curl_bounded() {
  curl --fail --location --retry 3 --retry-delay 1 \
    --connect-timeout "$curl_connect_timeout" --max-time "$curl_max_time" \
    --silent --show-error "$@"
}

emit() {
  date_value=$1
  repo=$2
  checksum_url="$repo/install-tl-unx.tar.gz.sha512"
  checksum=$(curl_bounded "$checksum_url" | awk 'NF {print $1; exit}')
  case "$checksum" in
    ''|*[!0-9A-Fa-f]*) echo "Invalid TeX Live installer checksum at $checksum_url" >&2; exit 65 ;;
  esac
  if [ "${#checksum}" -ne 128 ]; then
    echo "Unexpected SHA-512 length at $checksum_url" >&2
    exit 65
  fi
  checksum=$(printf '%s' "$checksum" | tr 'A-F' 'a-f')
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      printf 'date=%s\n' "$date_value"
      printf 'repository=%s\n' "$repo"
      printf 'installer_sha512=%s\n' "$checksum"
    } >> "$GITHUB_OUTPUT"
  fi
  printf 'date=%s\nrepository=%s\ninstaller_sha512=%s\n' "$date_value" "$repo" "$checksum"
}

repo_for_date() {
  value=$1
  case "$value" in
    ????-??-??) ;;
    *) return 1 ;;
  esac
  if ! date -u -d "$value" +%Y-%m-%d 2>/dev/null | grep -qx "$value"; then
    return 1
  fi
  year=$(printf '%s' "$value" | cut -d- -f1)
  month=$(printf '%s' "$value" | cut -d- -f2)
  day=$(printf '%s' "$value" | cut -d- -f3)
  printf '%s/%s/%s/%s/tlnet\n' "$archive_root" "$year" "$month" "$day"
}

assert_supported_year() {
  value=$1
  year=${value%%-*}
  if [ "$year" != "$supported_year" ]; then
    echo "TeX Live $year is not supported by this renderer image layout; complete the annual TeX Live migration before selecting this snapshot" >&2
    exit 78
  fi
}

if [ "$requested" != latest ]; then
  repo=$(repo_for_date "$requested") || {
    echo "Snapshot must be 'latest' or a valid YYYY-MM-DD date" >&2
    exit 64
  }
  assert_supported_year "$requested"
  if ! curl_bounded --output /dev/null "$repo/install-tl-unx.tar.gz.sha512"; then
    echo "TeX Live snapshot is unavailable: $requested" >&2
    exit 69
  fi
  emit "$requested" "$repo"
  exit 0
fi

current_year=$(date -u +%Y)
if [ "$current_year" != "$supported_year" ]; then
  echo "Automatic latest resolution is disabled in $current_year because this release is pinned to TeX Live $supported_year; perform the annual TeX Live migration first" >&2
  exit 78
fi

offset=0
while [ "$offset" -lt "$max_lookback" ]; do
  candidate=$(date -u -d "-$offset day" +%Y-%m-%d)
  assert_supported_year "$candidate"
  repo=$(repo_for_date "$candidate")
  if curl_bounded --output /dev/null "$repo/install-tl-unx.tar.gz.sha512"; then
    emit "$candidate" "$repo"
    exit 0
  fi
  offset=$((offset + 1))
done

echo "No usable TeX Live snapshot found in the last $max_lookback days" >&2
exit 69
