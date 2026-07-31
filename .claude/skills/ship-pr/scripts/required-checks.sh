#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
required-checks.sh [--ref <branch>] [owner/repo] [ruleset-id]

Prints the required status check contexts a merge into <branch> must satisfy,
one per line. Read the list from here rather than from memory before merging —
every context printed must be green, and the set changes when a Dockerfile or a
workflow is added.

It asks `rules/branches/<branch>`, so GitHub decides which rulesets apply:
enforcement, branch-vs-tag target and the ref conditions are evaluated server
side. Enumerating rulesets instead would merge in contexts from disabled ones
and from rulesets scoped to a ref nobody is merging into.

Pass a ruleset id to read that one ruleset directly instead, ignoring which refs
it applies to. Either way, rules carrying no required_status_checks print
nothing.

Arguments:
  --ref <branch>  Defaults to the repository's default branch
  [owner/repo]    Defaults to `gh repo view --json owner,name`
  [ruleset-id]    Defaults to asking which rules apply to <branch>

Environment:
  SHIP_PR_BRANCH_RULES_FIXTURE  Path to a JSON file holding what
                                `gh api repos/<o>/<r>/rules/branches/<branch>`
                                would return — a flat array of rule objects.
  SHIP_PR_RULESET_FIXTURE       Path to a JSON file holding what
                                `gh api repos/<o>/<r>/rulesets/<id>` would
                                return — one ruleset, its rules under `.rules`.
                                Both stand in for the `gh` calls, which is how
                                this script is exercised without network access.

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

ref=""
if [ "${1:-}" = "--ref" ]; then
  if [ -z "${2:-}" ]; then
    usage >&2
    exit 1
  fi
  ref=$2
  shift 2
fi

if [ "$#" -gt 2 ]; then
  usage >&2
  exit 1
fi

# shellcheck disable=SC2016  # jq filters, not shell.
contexts='select(.type=="required_status_checks") | .parameters.required_status_checks[].context'

if [ -n "${SHIP_PR_RULESET_FIXTURE:-}" ]; then
  jq -r ".rules[] | $contexts" "$SHIP_PR_RULESET_FIXTURE"
  exit 0
fi

if [ -n "${SHIP_PR_BRANCH_RULES_FIXTURE:-}" ]; then
  jq -r ".[] | $contexts" "$SHIP_PR_BRANCH_RULES_FIXTURE"
  exit 0
fi

repo=${1:-$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')}

if [ -n "${2:-}" ]; then
  gh api "repos/$repo/rulesets/$2" --jq ".rules[] | $contexts"
  exit 0
fi

if [ -z "$ref" ]; then
  ref=$(gh repo view "$repo" --json defaultBranchRef --jq '.defaultBranchRef.name')
fi

# The branch sits in the path, so a slash in the ref needs encoding. Unencoded,
# a mis-routed request returns an empty rule list rather than an error, and an
# empty list here reads as "nothing is required". Both forms agreed on the only
# slash-bearing ref available to test — both empty — so this is precaution
# against that silent shape, not a measured fix.
gh api "repos/$repo/rules/branches/$(jq -rn --arg b "$ref" '$b|@uri')" \
  --paginate --jq ".[] | $contexts"
