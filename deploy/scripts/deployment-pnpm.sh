#!/bin/sh
set -eu

# Run only in the deployment user's writable tree, never in a sealed release.
if [ "$(id -u)" -eq 0 ]; then
  echo "deployment-pnpm.sh must run as a non-root deployment user" >&2
  exit 77
fi
if [ "$#" -lt 3 ]; then
  echo "usage: deployment-pnpm.sh BUILD_ROOT PNPM_EXECUTABLE COMMAND [ARGUMENTS...]" >&2
  exit 64
fi
build_root=$1
pnpm_executable=$2
shift 2
case "$build_root" in /*) ;; *) exit 64 ;; esac
case "$pnpm_executable" in /*) ;; *) exit 64 ;; esac
cd "$build_root"
build_root=$(pwd -P)
if [ ! -w "$build_root" ] || [ "$(stat -c %u "$build_root")" != "$(id -u)" ]; then
  echo "Deployment build tree must be owned and writable by the deployment user" >&2
  exit 78
fi
expected_version=$(node -e '
  const value=require(process.argv[1]).packageManager;
  if(typeof value!=="string"||!/^pnpm@\d+\.\d+\.\d+$/.test(value))process.exit(65);
  process.stdout.write(value.slice(5));
' "$build_root/package.json")
if [ "$("$pnpm_executable" --version)" != "$expected_version" ]; then
  echo "Deployment pnpm version does not match the release packageManager" >&2
  exit 65
fi

# The assembled node_modules carries another build's absolute store path.
# Reconcile it explicitly with `install --frozen-lockfile` before quiescing;
# subsequent (including nested) commands must fail, not silently reinstall.
export CI=true
export PNPM_CONFIG_STORE_DIR="$build_root/.deployment-tooling/store"
export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=error
export PNPM_CONFIG_FROZEN_LOCKFILE=true
exec "$pnpm_executable" --dir "$build_root" "$@"
