#!/bin/sh
set -eu
snapshot=${1:?Debian snapshot required}
shift
[ "$#" -gt 0 ] || exit 64
case "$snapshot" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
  *) echo 'Invalid Debian snapshot' >&2; exit 64 ;;
esac
total=${DEBIAN_INSTALL_TIMEOUT_SECONDS:-1200}
transfer=${DEBIAN_ACQUIRE_TIMEOUT_SECONDS:-30}
retries=${DEBIAN_ACQUIRE_RETRIES:-3}
stage_timeout=${DEBIAN_ACQUIRE_STAGE_TIMEOUT_SECONDS:-180}
for value in "$total" "$transfer" "$retries" "$stage_timeout"; do
  case "$value" in ''|*[!0-9]*|??????????*) echo 'Invalid Debian acquisition limit' >&2; exit 64 ;; esac
done
[ "$total" -ge 1 ] && [ "$total" -le 3600 ] &&
  [ "$transfer" -ge 1 ] && [ "$transfer" -le 120 ] &&
  [ "$retries" -le 5 ] &&
  [ "$stage_timeout" -ge 1 ] && [ "$stage_timeout" -le 600 ] || { echo 'Debian acquisition limit out of range' >&2; exit 64; }
# An inactivity timeout alone does not bound slow responses or server retry
# delays. GNU timeout also bounds the entire signed acquisition/install phase
# and terminates its process group (forcefully after a 15-second grace).
exec timeout --signal=TERM --kill-after=15s "${total}s" \
  sh -eu -s -- "$snapshot" "$transfer" "$retries" "$stage_timeout" "$@" <<'APT_INSTALL'
snapshot=$1
transfer=$2
retries=$3
stage_timeout=$4
shift 4
LC_ALL=C
export LC_ALL
apt_log=$(mktemp)
trap 'rm -f -- "$apt_log"' EXIT
# Keep the supervising shell alive while a request ignores TERM, otherwise
# GNU timeout can exit before its force-kill timer reaches that request.
stopping=no
trap 'stopping=yes' TERM
apt_get() {
  exec apt-get -o "Acquire::http::Timeout=$transfer" \
    -o "Acquire::https::Timeout=$transfer" \
    -o "Acquire::Retries=$retries" \
    -o Acquire::http::Pipeline-Depth=0 \
    -o Acquire::https::Pipeline-Depth=0 \
    -o Acquire::Languages=none "$@"
}
run_apt() {
  apt_phase=$1
  apt_bounded=$2
  shift 2
  printf 'DEBIAN_INSTALL_PHASE=%s\n' "$apt_phase"
  started=$(date +%s)
  if [ "$apt_bounded" = yes ]; then
    # Stay in the outer timeout's process group so its final KILL also reaches
    # APT methods. Only acquisition is retried; dpkg installation is separate.
    timeout --foreground --signal=TERM --kill-after=5s "${stage_timeout}s" \
      apt-get -o "Acquire::http::Timeout=$transfer" \
        -o "Acquire::https::Timeout=$transfer" -o "Acquire::Retries=$retries" \
        -o Acquire::http::Pipeline-Depth=0 -o Acquire::https::Pipeline-Depth=0 \
        -o Acquire::Languages=none "$@" > "$apt_log" 2>&1 &
  else
    apt_get "$@" > "$apt_log" 2>&1 &
  fi
  request_pid=$!
  while :; do
    if wait "$request_pid"; then apt_status=0; break; else apt_status=$?; fi
    kill -0 "$request_pid" 2>/dev/null || break
  done
  [ "$stopping" = no ] || apt_status=143
  tail -c 131072 "$apt_log"
  printf 'DEBIAN_APT_STAGE phase=%s seconds=%s exit=%s\n' "$apt_phase" "$(($(date +%s) - started))" "$apt_status"
  return "$apt_status"
}
write_sources() {
  printf '%s\n' \
    "deb [check-valid-until=no] ${scheme}://${mirror}/archive/debian/${snapshot}/ bookworm main" \
    "deb [check-valid-until=no] ${scheme}://${mirror}/archive/debian-security/${snapshot}/ bookworm-security main" \
    > /etc/apt/sources.list
}
transient_acquisition() {
  [ "$apt_status" != 143 ] || return 1
  # An authentication, integrity, TLS trust or local-state error must fail
  # closed, even if another repository also reported a transient network error.
  if grep -Eiq 'NO_PUBKEY|EXPKEYSIG|BADSIG|invalid signature|Hash Sum mismatch|not signed|does not have a Release file|Certificate verification failed|No space left|dpkg was interrupted|not valid yet' "$apt_log"; then
    return 1
  fi
  [ "$apt_status" = 124 ] || grep -Eiq '(^|[^0-9])(403|408|429|5[0-9][0-9])([[:space:]]|$)|Temporary failure resolving|Could not resolve|Could not connect|Connection timed out|Connection failed|Connection reset|Network is unreachable|Timeout was reached|TLS connection was non-properly terminated|TLS handshake.*timed out' "$apt_log"
}
acquire() {
  acquire_phase=$1
  shift
  acquire_attempt=1
  while :; do
    write_sources
    if [ "$acquire_attempt" -gt 1 ] && [ "$1" != update ]; then
      # A different host has different APT list filenames. Verify its same-date
      # signed indexes before resolving the download against that endpoint.
      if run_apt "${acquire_phase}-refresh" yes update --error-on=any; then :; else return "$apt_status"; fi
    fi
    if run_apt "$acquire_phase" yes "$@"; then return 0; fi
    if [ "$acquire_attempt" -ge 2 ] || ! transient_acquisition; then return "$apt_status"; fi
    case "$mirror" in
      snapshot.debian.org) mirror=snapshot-cloudflare.debian.org ;;
      *) mirror=snapshot.debian.org ;;
    esac
    printf 'DEBIAN_APT_RETRY phase=%s endpoint=%s attempt=2\n' "$acquire_phase" "$mirror"
    acquire_attempt=2
  done
}
# Bootstrap CA certificates via signed APT, then require verified HTTPS on
# either official snapshot endpoint. Timestamp and suites never change.
mirror=snapshot.debian.org
scheme=http
write_sources
rm -f /etc/apt/sources.list.d/debian.sources
acquire bootstrap-update update --error-on=any
acquire bootstrap-ca-download install -y --download-only --no-install-recommends ca-certificates
run_apt bootstrap-ca no install -y --no-download --no-install-recommends ca-certificates
scheme=https
write_sources
acquire https-update update --error-on=any
acquire packages-download install -y --download-only --no-install-recommends "$@"
run_apt packages no install -y --no-download --no-install-recommends "$@"
mkdir -p /opt/renderer
# Do not hide dpkg-query failure behind sort's exit status.
dpkg-query -W -f='${binary:Package}\t${Version}\n' > /opt/renderer/debian-packages.unsorted
LC_ALL=C sort /opt/renderer/debian-packages.unsorted > /opt/renderer/debian-packages.txt
rm -f /opt/renderer/debian-packages.unsorted
rm -rf /var/lib/apt/lists/*
APT_INSTALL
