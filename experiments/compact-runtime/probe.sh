#!/bin/sh
# Use only a trusted, already-local renderer image on a disposable Linux host.
set -eu
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail 'Usage: sh probe.sh sha256:<local renderer image ID>'
case "$1" in sha256:*) image=${1#sha256:} ;; *) fail 'Expected a full immutable local image ID' ;; esac
case "$image" in ''|*[!0-9a-f]*) fail 'Invalid image ID' ;; esac
[ "${#image}" -eq 64 ] || fail 'Invalid image ID length'
[ "$(id -u)" -ne 0 ] || fail 'Run as an unprivileged test user, not root'
profile=$(CDPATH= cd -- "$(dirname -- "$0")/../../deploy/security" && pwd)/seccomp.json
[ -r "$profile" ] || fail 'Repository seccomp profile missing'
unset CONTAINER_HOST CONTAINER_CONNECTION DOCKER_HOST DOCKER_CONTEXT
engine() { timeout -k 5s 20s podman --remote=false "$@"; }
[ "$(engine info --format '{{.Host.Security.Rootless}} {{.Host.CgroupsVersion}}')" = 'true v2' ] || fail 'Local rootless Podman with cgroup v2 required'
# Nothing from a live installation is mounted. Only the fixed public fixture is readable.
work=$(mktemp -d /tmp/latex-compact.XXXXXXXXXX)
name=latex-compact-${work##*.}
cleanup() {
  rc=$?; trap - EXIT HUP INT TERM
  if [ -s "$work/cid" ]; then
    cid=$(cat "$work/cid")
    case "$cid" in ''|*[!0-9a-f]*) rc=1 ;; *)
      if [ "${#cid}" -eq 64 ]; then engine rm --force --ignore "$cid" >/dev/null || rc=1; else rc=1; fi ;;
    esac
  fi
  # A dead engine is not proof of cleanup; status 1 alone means absent.
  exists=0; engine container exists "$name" || exists=$?
  if [ "$exists" -ne 1 ]; then printf 'Could not confirm removal: %s\n' "$name" >&2; rc=1; fi
  rm -rf -- "$work"
  if [ "$rc" -eq 0 ]; then printf '%s\n' 'PDF fixture, sandbox checks and cleanup passed.'; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir "$work/input"
printf '%s\n' '\documentclass{article}' '\begin{document}' 'Compact probe 4729' '\end{document}' > "$work/input/main.tex"
chmod 0755 "$work/input"; chmod 0644 "$work/input/main.tex"
# Private tmpfs output avoids mapping the host UID to container UID 10000.
# Check the applied policy inside the sandbox, not just the CLI arguments.
timeout -k 8s 240s podman --remote=false run --rm --init --pull=never --timeout=180 \
  --name "$name" --cidfile "$work/cid" --network=none --cgroupns=private \
  --read-only --read-only-tmpfs=false --user=10000:10000 --cap-drop=ALL \
  --security-opt=no-new-privileges --security-opt="seccomp=$profile" \
  --pids-limit=128 --cpus=1.5 --memory=1g --memory-swap=1g \
  --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m,uid=10000,gid=10000 \
  --tmpfs=/work/output:rw,noexec,nosuid,nodev,size=64m,uid=10000,gid=10000 \
  --mount="type=bind,src=$work/input,dst=/work/input,ro" \
  --env=LATEX_RENDER_STAGE=pdf --env=LATEX_OUTPUTS=pdf --env=LATEX_ENTRYPOINT=main.tex \
  --entrypoint=/bin/sh "$image" -ec '
    test "$(id -u):$(id -g)" = 10000:10000
    awk "/^NoNewPrivs:/ && \$2==1 {n=1} /^Seccomp:/ && \$2==2 {s=1} /^CapEff:/ && \$2~/^0+$/ {e=1} /^CapBnd:/ && \$2~/^0+$/ {b=1} END {exit !(n&&s&&e&&b)}" /proc/self/status
    awk "\$5==\"/\" && \$6~/^ro(,|$)/ {r=1} \$5==\"/work/input\" && \$6~/^ro(,|$)/ {i=1} END {exit !(r&&i)}" /proc/self/mountinfo
    test -e /sys/class/net/lo
    for iface in /sys/class/net/*; do test "$iface" = /sys/class/net/lo; done
    cd /sys/fs/cgroup
    test "$(cat memory.max)" = 1073741824
    test "$(cat memory.swap.max)" = 0
    test "$(cat pids.max)" = 128
    awk "NF==2 && \$1~/^[0-9]+$/ && \$2>0 && 2*\$1==3*\$2 {ok=1} END {exit !ok}" cpu.max
    cd /work/input
    /opt/renderer/compile.sh
    qpdf --check /work/output/result.pdf >/dev/null
    pdftotext /work/output/result.pdf /tmp/compact-probe.txt
    grep -Fq "Compact probe 4729" /tmp/compact-probe.txt
  '
