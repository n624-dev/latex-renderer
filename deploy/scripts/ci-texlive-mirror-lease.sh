#!/bin/sh
set -eu
operation=${1:?usage: ci-texlive-mirror-lease.sh acquire|release ...}

prepare_access() {
  : "${TEXLIVE_CI_ACCESS_CLIENT_ID:?TEXLIVE_CI_ACCESS_CLIENT_ID required}"
  : "${TEXLIVE_CI_ACCESS_CLIENT_SECRET:?TEXLIVE_CI_ACCESS_CLIENT_SECRET required}"
  command -v cloudflared >/dev/null 2>&1 || {
    echo "cloudflared is required for the protected CI mirror" >&2
    exit 69
  }
  # cloudflared deliberately reads these from the environment so the secret is
  # not exposed in the ProxyCommand command line.
  export TUNNEL_SERVICE_TOKEN_ID=$TEXLIVE_CI_ACCESS_CLIENT_ID
  export TUNNEL_SERVICE_TOKEN_SECRET=$TEXLIVE_CI_ACCESS_CLIENT_SECRET
}

run_lease_ssh() {
  key=$1
  known_hosts=$2
  shift
  shift
  attempt=1
  while :; do
    if ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes \
      -o ConnectTimeout=30 -o ConnectionAttempts=1 \
      -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$known_hosts" \
      -o "ProxyCommand=cloudflared access ssh --hostname %h" \
      "${TEXLIVE_CI_USER:-texlive-ci-lease}@$TEXLIVE_CI_HOST" "$@"; then
      return 0
    fi
    [ "$attempt" -lt 3 ] || return 255
    attempt=$((attempt + 1))
    sleep 5
  done
}

case "$operation" in
  acquire)
    date_value=${2:?date required}
    upstream_installer=${3:?upstream installer checksum required}
    architecture=${4:-amd64}
    : "${TEXLIVE_CI_HOST:?TEXLIVE_CI_HOST required}"
    : "${TEXLIVE_CI_SSH_KEY:?TEXLIVE_CI_SSH_KEY required}"
    prepare_access
    owner="${GITHUB_RUN_ID:?}:${GITHUB_RUN_ATTEMPT:?}:${GITHUB_JOB:?}:$architecture"
    key=$(mktemp "${RUNNER_TEMP:?}/texlive-ci-key.XXXXXX")
    known_hosts=$(mktemp "${RUNNER_TEMP:?}/texlive-ci-known-hosts.XXXXXX")
    response=$(mktemp "${RUNNER_TEMP:?}/texlive-ci-reservation.XXXXXX")
    trap 'rm -f "$key" "$known_hosts" "$response"' EXIT HUP INT TERM
    printf '%s\n' "$TEXLIVE_CI_SSH_KEY" > "$key"
    printf '%s\n' "${TEXLIVE_CI_KNOWN_HOSTS:?}" > "$known_hosts"
    chmod 600 "$key" "$known_hosts"
    run_lease_ssh "$key" "$known_hosts" \
      reserve "$date_value" "$owner" "$architecture" > "$response"
    node -e '
      const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(r.canonicalDate!==process.argv[2] || r.installerSha512!==process.argv[3]) throw new Error("mirror identity differs from canonical archive");
      const id=/^tl20\d{2}-[0-9a-f]{16}-[0-9a-f]{16}-[0-9a-f]{16}-v[1-9][0-9]*$/;
      if(!id.test(r.snapshotId)||!/^[0-9a-f]{64}$/.test(r.token)) throw new Error("invalid reservation response");
      const url=new URL(r.url);
      const expectedHost=process.env.TEXLIVE_CI_MIRROR_HOST;
      if(!expectedHost||url.hostname!==expectedHost||url.port||url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!==`/snapshots/${r.snapshotId}/tlnet`||r.url!==url.origin+url.pathname) throw new Error("invalid reservation URL");
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`repository=${r.url}\ntoken=${r.token}\nowner=${process.argv[4]}\nsnapshot_id=${r.snapshotId}\n`);
    ' "$response" "$date_value" "$upstream_installer" "$owner"
    ;;
  release)
    token=${2:?token required}
    owner=${3:?owner required}
    : "${TEXLIVE_CI_HOST:?TEXLIVE_CI_HOST required}"
    : "${TEXLIVE_CI_SSH_KEY:?TEXLIVE_CI_SSH_KEY required}"
    prepare_access
    key=$(mktemp "${RUNNER_TEMP:?}/texlive-ci-key.XXXXXX")
    known_hosts=$(mktemp "${RUNNER_TEMP:?}/texlive-ci-known-hosts.XXXXXX")
    trap 'rm -f "$key" "$known_hosts"' EXIT HUP INT TERM
    printf '%s\n' "$TEXLIVE_CI_SSH_KEY" > "$key"
    printf '%s\n' "${TEXLIVE_CI_KNOWN_HOSTS:?}" > "$known_hosts"
    chmod 600 "$key" "$known_hosts"
    run_lease_ssh "$key" "$known_hosts" release "$token" "$owner"
    ;;
  *) echo "unknown operation" >&2; exit 64 ;;
esac
