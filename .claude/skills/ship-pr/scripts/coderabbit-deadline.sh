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
  updated=<iso8601> countdown=<n> <unit>   the last-edited rate-limit comment
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

# shellcheck disable=SC2016  # jq filter, not shell: $m and $c are jq bindings.
filter='
  [.[] | select(.user.login=="coderabbitai[bot]" and (.body | contains("rate limited by coderabbit.ai")))]
  | if length == 0 then "no rate-limit comment found"
    else
      max_by(.updated_at) as $m
      | ([$m.body | scan("Next review available in:[^0-9]*([0-9]+) ([a-z]+)")] | first) as $c
      | if $c == null then "updated=\($m.updated_at) countdown=unknown"
        else "updated=\($m.updated_at) countdown=\($c[0]) \($c[1])"
        end
    end'

if [ -n "${SHIP_PR_COMMENTS_FIXTURE:-}" ]; then
  jq -r "$filter" "$SHIP_PR_COMMENTS_FIXTURE"
else
  # `--jq` runs per page, so the aggregating filter has to see every page at
  # once or a page without a marker prints "no rate-limit comment found" of its
  # own. Stream the objects out and slurp them back into one array. Held in a
  # variable rather than piped, so a failed `gh` exits here instead of feeding
  # jq an empty stream and reporting "no rate-limit comment found".
  raw=$(gh api "repos/$repo/issues/$pr/comments" --paginate --jq '.[]')
  jq -sr "$filter" <<<"$raw"
fi
