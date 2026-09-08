#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || {
  echo "cloudflared-update must run as root" >&2
  exit 77
}
[ -f /etc/apt/sources.list.d/cloudflared.list ] || {
  echo "Cloudflare APT source is not installed" >&2
  exit 78
}

before=$(dpkg-query -W -f='${Version}' cloudflared)
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update \
  -o Dir::Etc::sourcelist=sources.list.d/cloudflared.list \
  -o Dir::Etc::sourceparts=- \
  -o APT::Get::List-Cleanup=0
apt-get -o DPkg::Lock::Timeout=300 install --only-upgrade --yes cloudflared
after=$(dpkg-query -W -f='${Version}' cloudflared)

if [ "$before" != "$after" ]; then
  systemctl restart cloudflared.service
fi
systemctl is-active --quiet cloudflared.service
cloudflared --version
