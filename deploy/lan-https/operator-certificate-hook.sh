#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
case "${RENEWED_LINEAGE:-}" in /etc/letsencrypt/live/akebi-keyless) ;; *) exit 0 ;; esac
# A fixed, root-controlled runtime directory bounds interrupted imports. Do not
# put root-created files below a directory writable by the service account.
staging=/run/latex-renderer-lan-certificate-import
umask 077
if [ ! -e "$staging" ] && [ ! -L "$staging" ]; then mkdir -m 0701 "$staging"; fi
[ ! -L "$staging" ] && [ -d "$staging" ] && [ "$(stat -c %u "$staging")" = 0 ] || exit 78
case "$(stat -c %a "$staging")" in 700|701) ;; *) exit 78 ;; esac
[ ! -L "$staging/import.lock" ] || exit 78
exec 9>"$staging/import.lock"
flock --exclusive --nonblock 9 || exit 75
chmod 0700 "$staging"
trap 'rm -f -- "$staging/fullchain.pem" "$staging/privkey.pem"; chmod 0700 "$staging"' EXIT
# Parent is root-owned, so the service cannot swap these entries for symlinks.
rm -f -- "$staging/fullchain.pem" "$staging/privkey.pem"
install -o latex-renderer-lan-authority -g latex-renderer-lan-authority -m 0600 "$RENEWED_LINEAGE/fullchain.pem" "$staging/fullchain.pem"
install -o latex-renderer-lan-authority -g latex-renderer-lan-authority -m 0600 "$RENEWED_LINEAGE/privkey.pem" "$staging/privkey.pem"
chmod 0701 "$staging"
runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority import-keyless \
  --config /etc/latex-renderer-lan-authority/authority.json \
  --certificate "$staging/fullchain.pem" --key "$staging/privkey.pem"
# The signer reloads the verified atomic bundle within 60 seconds. The next
# invocation reclaims an interrupted copy under the same lock; /run clears at boot.
