#!/bin/sh
set -eu

# Keep the GitHub-hosted runner client reproducible. Server updates are managed
# separately through Cloudflare's signed APT repository.
version=2026.8.3
case "$(uname -m)" in
  x86_64) architecture=amd64; sha256=f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e ;;
  aarch64|arm64) architecture=arm64; sha256=4bcfd35521a7cbc545ebfd5d57334a71ee180e2a64874981f374c81472118391 ;;
  *) echo "Unsupported cloudflared CI architecture" >&2; exit 65 ;;
esac
: "${RUNNER_TEMP:?RUNNER_TEMP required}"
: "${GITHUB_PATH:?GITHUB_PATH required}"

directory=$RUNNER_TEMP/cloudflared-$version-$architecture
binary=$directory/cloudflared
mkdir -p "$directory"
if [ ! -x "$binary" ]; then
  partial=$binary.partial
  rm -f "$partial"
  curl --fail --location --silent --show-error \
    --output "$partial" \
    "https://github.com/cloudflare/cloudflared/releases/download/$version/cloudflared-linux-$architecture"
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
