#!/bin/sh
# Download into an isolated directory. Never install or start a Caddy service.
set -eu
[ "$(uname -m)" = x86_64 ]
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$work"
apt-get download caddy
mkdir legacy modern
dpkg-deb -x ./caddy_*.deb legacy
node "$source_root/deploy/ci/check-caddy-template.mjs" "$work/legacy/usr/bin/caddy"
gh release download v2.11.9 --repo caddyserver/caddy --pattern caddy_2.11.9_linux_amd64.tar.gz
printf '%s  %s\n' 5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb caddy_2.11.9_linux_amd64.tar.gz | sha256sum -c -
tar -xzf caddy_2.11.9_linux_amd64.tar.gz -C modern caddy
node "$source_root/deploy/ci/check-caddy-template.mjs" "$work/modern/caddy"
