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
for value in "$total" "$transfer" "$retries"; do
  case "$value" in ''|*[!0-9]*|??????????*) echo 'Invalid Debian acquisition limit' >&2; exit 64 ;; esac
done
[ "$total" -ge 1 ] && [ "$total" -le 3600 ] &&
  [ "$transfer" -ge 1 ] && [ "$transfer" -le 120 ] &&
  [ "$retries" -le 5 ] || { echo 'Debian acquisition limit out of range' >&2; exit 64; }
# An inactivity timeout alone does not bound slow responses or server retry
# delays. GNU timeout also bounds the entire signed acquisition/install phase
# and terminates its process group (forcefully after a 15-second grace).
exec timeout --signal=TERM --kill-after=15s "${total}s" \
  sh -eu -s -- "$snapshot" "$transfer" "$retries" "$@" <<'APT_INSTALL'
snapshot=$1
transfer=$2
retries=$3
shift 3
# Keep the supervising shell alive while a request ignores TERM, otherwise
# GNU timeout can exit before its force-kill timer reaches that request.
trap ':' TERM
apt_get() {
  exec apt-get -o "Acquire::http::Timeout=$transfer" \
    -o "Acquire::https::Timeout=$transfer" \
    -o "Acquire::Retries=$retries" \
    -o Acquire::http::Pipeline-Depth=0 \
    -o Acquire::https::Pipeline-Depth=0 \
    -o Acquire::Languages=none "$@"
}
run_apt() {
  phase=$1
  shift
  printf 'DEBIAN_INSTALL_PHASE=%s\n' "$phase"
  started=$(date +%s)
  apt_get "$@" &
  request_pid=$!
  while :; do
    if wait "$request_pid"; then status=0; break; else status=$?; fi
    # A trapped signal interrupts wait even if the actual request is alive.
    kill -0 "$request_pid" 2>/dev/null || break
  done
  printf 'DEBIAN_APT_STAGE phase=%s seconds=%s exit=%s\n' "$phase" "$(($(date +%s) - started))" "$status"
  return "$status"
}
# The slim image has the Debian archive keyring but not TLS CA certificates.
# Bootstrap only CA certificates over signed APT, then use verified HTTPS.
printf '%s\n' \
  "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${snapshot}/ bookworm main" \
  "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${snapshot}/ bookworm-security main" \
  > /etc/apt/sources.list
rm -f /etc/apt/sources.list.d/debian.sources
run_apt bootstrap-update update --error-on=any
run_apt bootstrap-ca install -y --no-install-recommends ca-certificates
sed -i 's|http://snapshot.debian.org/|https://snapshot.debian.org/|g' /etc/apt/sources.list
run_apt https-update update --error-on=any
run_apt packages install -y --no-install-recommends "$@"
mkdir -p /opt/renderer
# Do not hide dpkg-query failure behind sort's exit status.
dpkg-query -W -f='${binary:Package}\t${Version}\n' > /opt/renderer/debian-packages.unsorted
LC_ALL=C sort /opt/renderer/debian-packages.unsorted > /opt/renderer/debian-packages.txt
rm -f /opt/renderer/debian-packages.unsorted
rm -rf /var/lib/apt/lists/*
APT_INSTALL
