#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
case "${1:-}" in present) action=acme-hook-present ;; cleanup) action=acme-hook-cleanup ;; *) exit 64 ;; esac
# DNS-01 values are public TXT data, never account credentials or private keys.
exec runuser -u latex-renderer-lan-authority -- env \
  CERTBOT_DOMAIN="${CERTBOT_DOMAIN:?}" CERTBOT_VALIDATION="${CERTBOT_VALIDATION:?}" \
  /usr/local/bin/node /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs \
  authority "$action" --config /etc/latex-renderer-lan-authority/authority.json
