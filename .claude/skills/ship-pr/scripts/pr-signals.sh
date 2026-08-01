#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
pr-signals.sh [<pr>] [<owner/repo>]

Prints one JSON object holding the PR findings that appear neither in the diff
nor in the checks list: code-scanning alerts the diff introduced, the alerts
already open on the base branch, and unresolved review threads.

    { "context": { "repo": …, "pr": …, "prRef": …, "baseRef": … },
      "introduced": [ … ], "preExisting": [ … ], "unresolvedThreads": [ … ] }

Every key is always present, `[]` when empty. Each alert carries
`number, severity, tool, rule, path, line, url`.

The GraphQL call runs first, and that ordering is load-bearing. The
code-scanning endpoint answers a nonexistent PR number with `[]` and exit 0, so
a typo reads as a clean PR — the one wrong answer this must never give. The same
number through GraphQL exits 1 with `Could not resolve to a PullRequest`. It is
also where `baseRefName` comes from, which the base-branch query needs.

`introduced` is the PR-ref alerts whose `number` is absent from the base list.
The set difference is keyed on `.number` deliberately: if that key turns out to
be per-ref rather than per-alert, every alert reports as introduced, which is
loud. A path+rule fingerprint can collide and under-report, which is silent.

`preExisting` is the whole base list, not the intersection. Scorecard only ever
analyses `refs/heads/<base>`, so an intersection would leave the posture bucket
empty by construction.

The base query asks `?ref=refs/heads/<base>` rather than omitting `?ref=`.
Omitting it returns alerts across every ref, a superset that under-reports
`introduced`.

`--paginate` is on both alert calls: the endpoint returns 30 per page, and a
truncated list here reads as clean. Do not reach for `--slurp` — `gh` rejects it
alongside `--jq`. Pagination against a repo with more than one page of alerts is
untested here, because this repo has zero.

Bot comments are deliberately not collected. `gh pr view <pr> --comments` errors
loudly on a bad number and needs no placeholder substitution, so it fails the
test a script exists to pass.

Arguments:
  [<pr>]          Pull request number. Defaults to `gh pr view --json number`,
                  i.e. the PR for the current checkout's branch.
  [<owner/repo>]  Defaults to `gh repo view --json owner,name`.

Environment:
  SHIP_PR_PR_ALERTS_FIXTURE      Path to a JSON file holding what
                                 `gh api repos/<o>/<r>/code-scanning/alerts`
                                 would return for the PR ref.
  SHIP_PR_BASE_ALERTS_FIXTURE    The same, for the base ref.
  SHIP_PR_REVIEW_THREADS_FIXTURE Path to a JSON file holding a whole GraphQL
                                 response document, so the extraction path is
                                 exercised rather than bypassed.
                                 All three stand in for the `gh` calls together,
                                 which is how this is run without a live PR. Set
                                 one and the rest are required too: a partial
                                 fixture run would quietly hit the network.

Exit codes:
  0  the payload was printed
  1  bad usage, or GraphQL returned no base ref
  *  a `gh` call failed; its status is passed through, which call failed is
     named on stderr, and nothing is written to stdout. A partial payload must
     be impossible — an absent category and a failed call read identically once
     the JSON is the only thing left.
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

pr=${1:-}
repo=${2:-}

pr_alerts_fixture=${SHIP_PR_PR_ALERTS_FIXTURE:-}
base_alerts_fixture=${SHIP_PR_BASE_ALERTS_FIXTURE:-}
threads_fixture=${SHIP_PR_REVIEW_THREADS_FIXTURE:-}

offline=0
if [ -n "$pr_alerts_fixture" ] || [ -n "$base_alerts_fixture" ] || [ -n "$threads_fixture" ]; then
  offline=1
  if [ -z "$pr_alerts_fixture" ] || [ -z "$base_alerts_fixture" ] || [ -z "$threads_fixture" ]; then
    echo "pr-signals.sh: all three SHIP_PR_*_FIXTURE variables are required together" >&2
    exit 1
  fi
  if [ -z "$pr" ] || [ -z "$repo" ]; then
    echo "pr-signals.sh: a fixture run takes <pr> and <owner/repo> explicitly, so nothing reaches the network" >&2
    exit 1
  fi
fi

fail() {
  printf 'pr-signals.sh: %s failed (exit %s) — no payload written\n' "$2" "$1" >&2
  exit "$1"
}

if [ -z "$pr" ]; then
  status=0
  pr=$(gh pr view --json number --jq '.number') || status=$?
  [ "$status" -eq 0 ] || fail "$status" "gh pr view --json number"
fi

if [ -z "$repo" ]; then
  status=0
  repo=$(gh repo view --json owner,name --jq '.owner.login + "/" + .name') || status=$?
  [ "$status" -eq 0 ] || fail "$status" "gh repo view --json owner,name"
fi

if ! [[ $pr =~ ^[0-9]+$ ]]; then
  echo "pr-signals.sh: <pr> must be a number, got '$pr'" >&2
  usage >&2
  exit 1
fi

if ! [[ $repo =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
  echo "pr-signals.sh: <owner/repo> must be owner/name, got '$repo'" >&2
  usage >&2
  exit 1
fi

owner=${repo%%/*}
name=${repo##*/}

read -r -d '' query <<'EOF' || true
query($owner: String!, $name: String!, $pr: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      baseRefName
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 1) { nodes { author { login } url } }
        }
      }
    }
  }
}
EOF

# GraphQL first: it is the only call that fails on a PR number that does not
# exist, and it carries the base ref the next query is built from.
if [ "$offline" -eq 1 ]; then
  threads_pages=$(cat "$threads_fixture")
else
  status=0
  threads_pages=$(gh api graphql --paginate \
    -F owner="$owner" -F name="$name" -F pr="$pr" -f query="$query") || status=$?
  [ "$status" -eq 0 ] || fail "$status" "GraphQL reviewThreads/baseRefName for $repo#$pr"
fi

base_ref_name=$(jq -sr '.[0].data.repository.pullRequest.baseRefName // empty' <<<"$threads_pages")
if [ -z "$base_ref_name" ]; then
  echo "pr-signals.sh: GraphQL returned no baseRefName for $repo#$pr — refusing to guess a base ref" >&2
  exit 1
fi

unresolved_threads=$(jq -s '
  [ .[].data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved == false)
    | { path, line: (.line // .originalLine), isOutdated,
        author: (.comments.nodes[0].author.login // null),
        url: (.comments.nodes[0].url // null) } ]
' <<<"$threads_pages")

pr_ref="refs/pull/$pr/merge"
base_ref="refs/heads/$base_ref_name"

# shellcheck disable=SC2016  # jq filter, not shell.
alert_shape='[ .[] | { number,
    severity: (.rule.security_severity_level // .rule.severity),
    tool: .tool.name, rule: .rule.id,
    path: .most_recent_instance.location.path,
    line: .most_recent_instance.location.start_line,
    url: .html_url } ]'

alerts() {
  local ref=$1 fixture=$2 label=$3 pages status=0
  if [ -n "$fixture" ]; then
    pages=$(cat "$fixture")
  else
    pages=$(gh api --paginate \
      "repos/$repo/code-scanning/alerts?ref=$(jq -rn --arg r "$ref" '$r|@uri')&state=open") || status=$?
    [ "$status" -eq 0 ] || fail "$status" "code-scanning alerts for $label ($ref)"
  fi
  jq -s "(add // []) | $alert_shape" <<<"$pages"
}

# `fail` inside a command substitution ends only that subshell, so the status has
# to be passed on by hand rather than left to `set -e`.
pr_alerts=$(alerts "$pr_ref" "$pr_alerts_fixture" "the PR ref") || exit $?
base_alerts=$(alerts "$base_ref" "$base_alerts_fixture" "the base ref") || exit $?

# Everything is in hand, so the object cannot be emitted half-built.
jq -n \
  --arg repo "$repo" \
  --argjson pr "$pr" \
  --arg prRef "$pr_ref" \
  --arg baseRef "$base_ref" \
  --argjson prAlerts "$pr_alerts" \
  --argjson baseAlerts "$base_alerts" \
  --argjson threads "$unresolved_threads" \
  '($baseAlerts | map(.number)) as $baseNumbers
   | { context: { repo: $repo, pr: $pr, prRef: $prRef, baseRef: $baseRef },
       introduced: [ $prAlerts[]
                     | . as $alert
                     | select(($baseNumbers | index($alert.number)) == null) ],
       preExisting: $baseAlerts,
       unresolvedThreads: $threads }'
