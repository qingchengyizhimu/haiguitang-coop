#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PAGES_DEMO="true"
export NEXT_PUBLIC_TURTLE_DEMO_ONLY="true"
export NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/haiguitang-coop}"

if [[ "${NEXT_PUBLIC_BASE_PATH}" != "/haiguitang-coop" ]]; then
  echo "Pages demo base path must be /haiguitang-coop" >&2
  exit 64
fi

bash "${script_dir}/build-verified.sh"
node "${script_dir}/validate-pages-artifact.mjs"
