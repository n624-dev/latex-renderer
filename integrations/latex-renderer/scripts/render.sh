#!/bin/sh
set -eu
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: render.sh PROJECT_OR_ZIP [ENTRYPOINT]" >&2
  exit 64
fi
if [ "$#" -eq 2 ]; then
  exec latex-render render "$1" --entrypoint "$2"
fi
exec latex-render render "$1"
