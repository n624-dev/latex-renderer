#!/bin/sh
set -eu

# Keep the GitHub-hosted runner client reproducible. Server updates are managed
# separately through Cloudflare's signed APT repository.
version=2026.8.3
sha256=f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e

[ "$(uname -m)" = x86_64 ] || {
  echo "The CI mirror currently supports only amd64 (issue #62 tracks ARM)" >&2
  exit 65
}
: "${RUNNER_TEMP:?RUNNER_TEMP required}"
: "${GITHUB_PATH:?GITHUB_PATH required}"

directory=$RUNNER_TEMP/cloudflared-$version
binary=$directory/cloudflared
mkdir -p "$directory"
if [ ! -x "$binary" ]; then
  partial=$binary.partial
  rm -f "$partial"
  curl --fail --location --silent --show-error \
    --output "$partial" \
    "https://github.com/cloudflare/cloudflared/releases/download/$version/cloudflared-linux-amd64"
  printf '%s  %s\n' "$sha256" "$partial" | sha256sum --check --status || {
    rm -f "$partial"
    echo "cloudflared checksum verification failed" >&2
    exit 65
  }
  chmod 0755 "$partial"
  mv "$partial" "$binary"
fi
printf '%s\n' "$directory" >> "$GITHUB_PATH"
"$binary" --version
