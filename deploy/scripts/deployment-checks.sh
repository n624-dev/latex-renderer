# Sourced by the sealed deployment script; labels are static code, never URLs.
deployment_checkpoint() {
  deployment_step=$1
  printf 'Deployment check: %s\n' "$deployment_step" >&2
}

deployment_report_failure() {
  printf 'Deployment failed: step=%s exit=%s\n' "$deployment_step" "$1" >&2
}

# No pipeline: a matching partial body must not hide a failed curl transfer.
# A subshell keeps request-local variables out of the caller's cleanup state.
deployment_fetch() (
  fetch_url=$1
  fetch_output=$2
  fetch_status=000
  fetch_exit=0
  fetch_status=$(curl --fail --silent --connect-timeout 10 --max-time 30 \
    --max-filesize 4194304 --output "$fetch_output" --write-out '%{http_code}' \
    "$fetch_url" 2>/dev/null) || fetch_exit=$?
  if [ "$fetch_exit" -ne 0 ] || [ "$fetch_status" != 200 ]; then
    printf 'Deployment HTTP check failed: step=%s curl_exit=%s http_status=%s\n' \
      "$deployment_step" "$fetch_exit" "$fetch_status" >&2
    return 1
  fi
)

deployment_expect_body() (
  deployment_fetch "$1" "$temporary_root/check-response" || return 1
  if ! grep -Fq -- "$2" "$temporary_root/check-response"; then
    printf 'Deployment HTTP check failed: step=%s reason=expected-content-missing\n' \
      "$deployment_step" >&2
    return 1
  fi
)
