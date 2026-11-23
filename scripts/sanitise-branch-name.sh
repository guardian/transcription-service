#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z ${1:-} ]]; then
  printf 'Usage: %s <branch-name>\n' "${0##*/}" >&2
  exit 1
fi

export LC_ALL=C
tag=${1//[^A-Za-z0-9_.-]/-}
if [[ $tag == [.-]* ]]; then
  tag="_$tag"
fi
printf '%s\n' "${tag:0:128}"
