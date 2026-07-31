#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
required-checks.sh [owner/repo] [ruleset-id]

Prints the required status check contexts on the repository's rulesets, one per
line. Read the list from here rather than from memory before merging — every
context printed must be green, and the set changes when a Dockerfile or a
workflow is added.

With no arguments it derives the repo from the current checkout and walks every
ruleset. Rulesets carrying no required_status_checks rule print nothing.

Arguments:
  [owner/repo]    Defaults to `gh repo view --json owner,name`
  [ruleset-id]    Defaults to every ruleset on the repo

Environment:
  SHIP_PR_RULESET_FIXTURE  Path to a JSON file holding what
                           `gh api repos/<owner>/<repo>/rulesets/<id>` would
                           return. Used in place of both `gh` calls, which is
                           how this script is exercised without network access.

Output:
  One check context per line, e.g. `Verify`, `Images (api)`, `CodeQL`.

Exit codes:
  0  the contexts were read
  1  bad usage
  *  a `gh` call failed; its status is passed through
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$#" -gt 2 ]; then
  usage >&2
  exit 1
fi

filter='.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'

if [ -n "${SHIP_PR_RULESET_FIXTURE:-}" ]; then
  jq -r "$filter" "$SHIP_PR_RULESET_FIXTURE"
  exit 0
fi

repo=${1:-$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')}

if [ -n "${2:-}" ]; then
  ids=$2
else
  ids=$(gh api "repos/$repo/rulesets" --jq '.[].id')
fi

for id in $ids; do
  gh api "repos/$repo/rulesets/$id" --jq "$filter"
done
