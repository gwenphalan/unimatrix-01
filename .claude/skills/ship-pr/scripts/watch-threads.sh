#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
watch-threads.sh <owner/repo> <pr> <since>

Prints CodeRabbit's replies on individual review threads, one per line, as
"<path>:<line><TAB><body>". Run it after pushing fixes and replying to findings:
the push earns no new review, but CodeRabbit does answer thread replies, and
that answer is where it either concedes or produces a counterexample. A reply
that raises something new is a finding in its own right.

This reads `pulls/.../comments` — the review threads, a different endpoint from
the `issues/.../comments` where the summary comment lives. Only comments
carrying an `in_reply_to_id` are printed, so the findings themselves stay out of
the way and what you see is an answer to something you said. It polls once and
exits, so arm it under `Monitor` if you would rather the reply found you.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number
  <since>       ISO-8601 UTC timestamp, e.g. 2026-07-31T18:04:00Z. Filters on
                updated_at, so an edited older comment resurfaces — which is
                what you want, because CodeRabbit edits rather than reposts.

Environment:
  SHIP_PR_THREAD_COMMENTS_FIXTURE  Path to a JSON file holding what
                                   `gh api repos/<owner>/<repo>/pulls/<pr>/comments`
                                   would return. Used in place of the `gh` call,
                                   which is how this script is exercised without
                                   a live PR.

Output:
  Zero or more lines. No output means no reply has landed since <since>.

Exit codes:
  0  the call succeeded, whether or not it printed anything
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

if [ "$#" -ne 3 ]; then
  usage >&2
  exit 1
fi

repo=$1
pr=$2
since=$3

# shellcheck disable=SC2016  # jq filter, not shell.
# in_reply_to_id is what separates a reply from a top-level finding. Without it
# the whole review lands here on the round it was posted, burying the answer
# this script exists to surface.
filter='.[] | select(.user.login=="coderabbitai[bot]" and .in_reply_to_id != null) | "\(.path):\(.line)\t\(.body)"'

if [ -n "${SHIP_PR_THREAD_COMMENTS_FIXTURE:-}" ]; then
  jq -r "$filter" "$SHIP_PR_THREAD_COMMENTS_FIXTURE"
else
  gh api "repos/$repo/pulls/$pr/comments?since=$since" --paginate --jq "$filter"
fi
