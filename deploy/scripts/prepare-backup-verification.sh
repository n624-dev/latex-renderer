#!/bin/sh
set -eu

group=latex-renderer-backup
directory=/var/lib/latex-renderer-backup-verification
receipt=$directory/latest.json

getent group "$group" >/dev/null || groupadd --system "$group"

if [ -e "$directory" ] || [ -L "$directory" ]; then
  if [ -L "$directory" ] || [ ! -d "$directory" ]; then
    echo "Unsafe backup verification state directory" >&2
    exit 1
  fi
  mode=$(stat -c %a -- "$directory")
  if [ "$(stat -c %u -- "$directory")" -ne 0 ] || [ "$((0$mode & 022))" -ne 0 ]; then
    echo "Unsafe backup verification state directory permissions" >&2
    exit 1
  fi
fi
install -d -o root -g "$group" -m 0750 -- "$directory"

# Only migrate the legacy private receipt. Leave untrusted files untouched.
if [ -f "$receipt" ] && [ ! -L "$receipt" ] && \
   [ "$(stat -c '%u:%a:%h' -- "$receipt")" = 0:600:1 ]; then
  chgrp --no-dereference -- "$group" "$receipt"
  chmod 0640 -- "$receipt"
fi
