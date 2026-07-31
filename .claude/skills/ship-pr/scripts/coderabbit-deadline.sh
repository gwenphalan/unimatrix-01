#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
coderabbit-deadline.sh <owner/repo> <pr>

Prints the rate-limit comment's updated_at and the countdown it carries, so you
can compute the deadline as updated_at + countdown.

The "Next review available in: N minutes" countdown is not a live clock. It is
rewritten only when CodeRabbit runs, so polling for the marker to vanish waits
forever, and N is whatever was true when the comment was last edited. Not
created_at, and not "now + N". A window that has already lapsed still reads
"rate limited" — do the arithmetic before assuming you must keep waiting.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number

Environment:
  SHIP_PR_COMMENTS_FIXTURE  Path to a JSON file holding what
                            `gh api repos/<owner>/<repo>/issues/<pr>/comments`
                            would return. Used in place of the `gh` call, which
                            is how this script is exercised without a live PR.

Output, one line, whichever applies:
  updated=<iso8601> countdown=<n> <unit>   the newest rate-limit comment
  updated=<iso8601> countdown=unknown      marker present, no countdown in it
  no rate-limit comment found              the PR is not rate limited

Exit codes:
  0  the comments were read, whether or not a marker was present
  1  bad usage
  *  the `gh` call failed; its status is passed through
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$#" -ne 2 ]; then
  usage >&2
  exit 1
fi

repo=$1
pr=$2

filter='
  [.[] | select(.user.login=="coderabbitai[bot]" and (.body | contains("rate limited by coderabbit.ai")))]
  | if length == 0 then "no rate-limit comment found"
    else
      last as $m
      | ([$m.body | scan("Next review available in:[^0-9]*([0-9]+) ([a-z]+)")] | first) as $c
      | if $c == null then "updated=\($m.updated_at) countdown=unknown"
        else "updated=\($m.updated_at) countdown=\($c[0]) \($c[1])"
        end
    end'

if [ -n "${SHIP_PR_COMMENTS_FIXTURE:-}" ]; then
  jq -r "$filter" "$SHIP_PR_COMMENTS_FIXTURE"
else
  gh api "repos/$repo/issues/$pr/comments" --jq "$filter"
fi
