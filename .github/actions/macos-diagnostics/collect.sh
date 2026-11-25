#!/usr/bin/env bash
set -eu

directory="$RUNNER_TEMP/macos-diagnostics"
mkdir -p "$directory"

resources() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  vm_stat
  df -h "$RUNNER_TEMP"
  iostat -d -c 1
  ps -axo pid,ppid,state,%cpu,%mem,rss,time,comm -r
}

snapshot() {
  {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
    sw_vers
    uname -srm
    sysctl hw.ncpu hw.memsize kern.osversion
    xcode-select -p
    xcodebuild -version
    git rev-parse HEAD
    command -v node
    node --version
    command -v brew
    brew --version
    openssl version
    df -h "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
    iostat -d -c 1
  } >"$directory/$1.log" 2>&1 || true
}

case "$1" in
  start)
    date '+%Y-%m-%d %H:%M:%S' >"$directory/start-time"
    mkdir -p "$directory/homebrew"
    {
      printf 'MACOS_DIAGNOSTICS_DIR=%s\n' "$directory"
      printf 'HOMEBREW_LOGS=%s\n' "$directory/homebrew"
    } >>"$GITHUB_ENV"
    snapshot runner-start
    nohup bash "$0" sample </dev/null >"$directory/resources.log" 2>&1 &
    printf '%s\n' "$!" >"$directory/sampler-pid"
    ;;
  sample)
    while :; do
      resources || true
      sleep 5
    done
    ;;
  finish)
    if [ -r "$directory/sampler-pid" ]; then
      read -r sampler <"$directory/sampler-pid"
      # Match the sampler command again before sending a signal to a reused PID.
      if ps -p "$sampler" -o command= | grep -Fq -- "$0 sample"; then
        kill "$sampler" 2>/dev/null || true
      fi
    fi
    snapshot runner-finish
    resources >"$directory/resources-finish.log" 2>&1 || true
    start=$(cat "$directory/start-time" 2>/dev/null || date -v-30M '+%Y-%m-%d %H:%M:%S')
    # Keep the job's Appium and test logs alongside related Apple subsystems.
    perl -e 'alarm shift; exec @ARGV or die $!' 75 /usr/bin/log show \
      --start "$start" --style compact --info --debug \
      --predicate 'subsystem BEGINSWITH "com.apple.CoreSimulator" OR process == "Simulator" OR process == "DeviceHub" OR process == "simdiskimaged" OR process == "syspolicyd" OR process == "amfid" OR process == "XProtectService" OR process == "oahd" OR process == "ReportCrash" OR process == "diskarbitrationd"' \
      >"$directory/macos-system.log" 2>"$directory/macos-system.stderr" || true
    reports="$HOME/Library/Logs/DiagnosticReports"
    if [ -d "$reports" ] && [ -f "$directory/start-time" ]; then
      mkdir -p "$directory/crashes"
      find "$reports" -maxdepth 2 -type f -newer "$directory/start-time" \
        \( -name 'node*' -o -name 'ruby*' -o -name 'Safari*' -o -name 'WebKit*' -o \
           -name 'Simulator*' -o -name 'CoreSimulatorService*' -o -name 'WebDriverAgent*' -o \
           -name 'xcodebuild*' \) -exec cp {} "$directory/crashes/" \;
    fi
    ;;
  *)
    printf 'Unknown diagnostics phase: %s\n' "$1" >&2
    exit 2
    ;;
esac
