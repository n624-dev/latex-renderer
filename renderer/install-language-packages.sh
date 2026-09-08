#!/bin/sh
set -eu
[ "$#" -gt 0 ] || exit 64
for language in "$@"; do
  case "$language" in collection-lang*) ;; *) exit 64 ;; esac
  case "${language#collection-lang}" in ''|*[!A-Za-z0-9._-]*) exit 64 ;; esac
done

# tlmgr can return success after rejecting a corrupted dependency download.
# Check the resulting dependency graph and files, not only its exit status.
if tlmgr install "$@" && tlmgr check depends && tlmgr check files; then
  exit 0
fi
echo 'Language installation incomplete; retrying once with reinstallation.' >&2
# Reinstalling a collection also reinstalls its package dependencies, including
# one incorrectly recorded as installed or forcibly removed by an earlier try.
if tlmgr install --reinstall "$@" && tlmgr check depends && tlmgr check files; then
  exit 0
fi
echo 'Language installation remains incomplete after two attempts.' >&2
exit 65
