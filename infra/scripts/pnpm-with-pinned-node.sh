#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"

if [ "$#" -eq 0 ]; then
  echo "Usage: ./infra/scripts/pnpm-with-pinned-node.sh <pnpm-args...>" >&2
  exit 1
fi

# Both pins are read from the files that already own them rather than repeated
# here. The previous version hard-coded `node@22.22.1` and was named after that
# major, so bumping the toolchain would have left it bootstrapping the old
# runtime under a name claiming otherwise — a mismatch that yields a working
# command and a wrong answer, which is the worst kind.
node_pin="$(tr -d '[:space:]' < "${repo_root}/.node-version")"
pnpm_pin="$(node -p "require('${repo_root}/package.json').packageManager.split('@').pop()" 2>/dev/null || echo "")"

if [ -z "${node_pin}" ] || [ -z "${pnpm_pin}" ]; then
  echo "pnpm-with-pinned-node: could not read the Node/pnpm pins from .node-version and package.json" >&2
  exit 1
fi

node_pin_major="${node_pin%%.*}"

node_major=""
pnpm_version=""

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p "process.versions.node.split('.')[0]")"
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_version="$(pnpm -v)"
fi

if [ "${node_major}" = "${node_pin_major}" ] && [ "${pnpm_version}" = "${pnpm_pin}" ]; then
  echo "pnpm-with-pinned-node: using local Node ${node_pin_major}.x and pnpm ${pnpm_pin}" >&2
  cd "${repo_root}"
  exec pnpm "$@"
fi

echo "pnpm-with-pinned-node: bootstrapping node@${node_pin} and pnpm@${pnpm_pin} via npm exec" >&2
cd "${TMPDIR:-/tmp}"
exec npm exec --yes --package="node@${node_pin}" --package="pnpm@${pnpm_pin}" -- sh -c 'cd "$1" && shift && exec pnpm "$@"' sh "${repo_root}" "$@"
