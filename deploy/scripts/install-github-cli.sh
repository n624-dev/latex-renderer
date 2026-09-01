#!/bin/sh
# Install the GitHub CLI used to verify release attestations. Debian's package
# can lag the verifier, so use this fixed upstream build when it is too old.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "install-github-cli.sh must run as root" >&2
  exit 77
fi

required_version=2.98.0
gh_bin=/usr/local/bin/gh

version_at_least() {
  candidate=$1
  awk -v candidate="$candidate" -v required="$required_version" 'BEGIN {
    split(candidate, c, "."); split(required, r, ".");
    for (i = 1; i <= 3; i++) {
      if ((c[i] + 0) > (r[i] + 0)) exit 0;
      if ((c[i] + 0) < (r[i] + 0)) exit 1;
    }
    exit 0;
  }'
}

installed_version=
if [ -x "$gh_bin" ]; then
  installed_version=$($gh_bin --version 2>/dev/null | sed -n '1s/^gh version v\{0,1\}\([0-9][0-9.]*\).*/\1/p')
fi
if [ -n "$installed_version" ] && version_at_least "$installed_version" && \
  "$gh_bin" attestation verify --help >/dev/null 2>&1; then
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64)
    asset=gh_2.98.0_linux_amd64.tar.gz
    asset_sha256=3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de
    archive_dir=gh_2.98.0_linux_amd64
    ;;
  aarch64|arm64)
    asset=gh_2.98.0_linux_arm64.tar.gz
    asset_sha256=cf689084f3a3618f7eae4a2420d335d74626d65f5e594b9828d125d69f800d86
    archive_dir=gh_2.98.0_linux_arm64
    ;;
  *)
    echo "Unsupported architecture for the pinned GitHub CLI: $(uname -m)" >&2
    exit 69
    ;;
esac

temporary_root=$(mktemp -d /tmp/latex-renderer-gh.XXXXXX)
cleanup() {
  status=$?
  rm -rf -- "$temporary_root"
  exit "$status"
}
trap cleanup EXIT INT TERM HUP

asset_path="$temporary_root/$asset"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  "https://github.com/cli/cli/releases/download/v$required_version/$asset" \
  --output "$asset_path"
printf '%s  %s\n' "$asset_sha256" "$asset_path" | sha256sum --check --status
tar -xzf "$asset_path" -C "$temporary_root"
test -x "$temporary_root/$archive_dir/bin/gh"
install -o root -g root -m 0755 "$temporary_root/$archive_dir/bin/gh" "$gh_bin"
"$gh_bin" attestation verify --help >/dev/null 2>&1
