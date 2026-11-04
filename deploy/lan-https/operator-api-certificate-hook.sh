#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
case "${RENEWED_LINEAGE:-}" in /etc/letsencrypt/live/akebi-authority) ;; *) exit 0 ;; esac
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx.service
