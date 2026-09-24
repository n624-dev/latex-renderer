#!/bin/sh
set -eu

input_root=$1
output_root=$2

# TeX writes chapters/ch1.aux beside the relative include path in -outdir.
# The validated input tree is read-only, so mirror directories, not files, in
# the writable output tree. -exec preserves spaces and Unicode in path names.
find "$input_root" -mindepth 1 -type d -exec sh -c '
  input_root=$1
  output_root=$2
  shift 2
  for input_dir do
    relative=${input_dir#"$input_root"/}
    [ "$relative" != "$input_dir" ] || exit 78
    mkdir -p -- "$output_root/$relative"
  done
' sh "$input_root" "$output_root" {} +
