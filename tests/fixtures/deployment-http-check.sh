#!/bin/sh
set -eu
. "$1"
temporary_root=$2
deployment_checkpoint fixture-http
trap 'status=$?; if [ "$status" -ne 0 ]; then deployment_report_failure "$status"; fi' EXIT
deployment_expect_body "$3" 'literal.[marker]'
