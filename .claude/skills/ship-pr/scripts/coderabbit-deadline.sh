#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
coderabbit-deadline.sh <owner/repo> <pr>

Prints the rate-limit comment's updated_at and the countdown it carries, so you
can compute the deadline as updated_at + countdown.

CodeRabbit has posted two wordings for the same refusal — "rate limited by
coderabbit.ai" with a "Next review available in: N <unit>" countdown, and
"Review rate limited." with a Fair Usage Limits Policy notice and "next
included review will be available in N <unit>" — and this matches either.
CodeRabbit has been seen posting comments in both wordings, seconds apart, for
one refusal; when the newest marker has no readable countdown but a sibling
posted within the last minute does, the sibling's countdown wins. Past that
window a readable older marker is a separate, prior refusal rather than a
same-refusal sibling, so its countdown is not reused — it may already have
lapsed, which would report a deadline in the past as still live. The newest
marker wins on its own in that case, reporting countdown=unknown.

The countdown is not a live clock. It is rewritten only when CodeRabbit runs,
so polling for the marker to vanish waits forever, and N is whatever was true
when the comment was last edited. Not created_at, and not "now + N". A window
that has already lapsed still reads "rate limited" — do the arithmetic before
assuming you must keep waiting.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number

Environment:
  SHIP_PR_COMMENTS_FIXTURE  Path to a JSON file holding what
                            `gh api repos/<owner>/<repo>/issues/<pr>/comments`
                            would return. Used in place of the `gh` call, which
                            is how this script is exercised without a live PR.

Output, one line, whichever applies:
  updated=<iso8601> countdown=<n> <unit>   the newest marker with a readable countdown
  updated=<iso8601> countdown=unknown      a marker is present, but none of them parse
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

# shellcheck disable=SC2016  # jq filter, not shell: $re, $window, $latest, $m, $c and $near are jq bindings.
filter='
  ("(?:Next review available in|next included review will be available in):?[^0-9]*([0-9]+) ([a-z]+)") as $re
  # How close a readable sibling has to sit to the newest marker to count as
  # the same refusal rather than a separate, earlier one. CodeRabbit has been
  # seen posting both wordings a couple of seconds apart for one refusal;
  # nothing has been seen anywhere near a minute, so this is generous, not
  # tight. Widen it only with a fresh measurement, since the whole point is to
  # stay well short of "an hour apart is still the same refusal".
  | 60 as $window
  | [.[] | select(.user.login=="coderabbitai[bot]" and
      ((.body | contains("rate limited by coderabbit.ai")) or (.body | contains("Review rate limited."))))]
  | if length == 0 then "no rate-limit comment found"
    else
      max_by(.updated_at) as $latest
      | (if ([$latest.body | scan($re)] | length) > 0 then
          # The newest marker already carries a readable countdown — no
          # fallback needed, and no older marker gets to override it.
          $latest
        else
          # CodeRabbit has posted both wordings for one refusal seconds apart,
          # so the newest marker can be the one with no parseable countdown
          # while an older sibling from the SAME refusal has the real number.
          # Restrict the fallback to siblings within $window of the newest —
          # an older marker further back than that is a separate refusal, and
          # its countdown is stale rather than a stand-in for the current one.
          ( [.[] | select(
              ([.body | scan($re)] | length > 0) and
              (($latest.updated_at | fromdateiso8601) - (.updated_at | fromdateiso8601)) <= $window
            )]
          ) as $near
          | if ($near | length) > 0 then ($near | max_by(.updated_at)) else $latest end
        end) as $m
      | ([$m.body | scan($re)] | first) as $c
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
