#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
wait-coderabbit.sh <owner/repo> <pr>

Waits for a CodeRabbit ping to reach one of its terminal outcomes and prints
which. Arm it under `Monitor` and carry on working.

Start it BEFORE posting the ping. It records the review-count baseline and a
timestamp first, and both have to predate the ping:

  - The baseline is not zero. A PR reviewed once already starts at n >= 1, so a
    loop testing n > 0 succeeds immediately and you merge believing a review ran
    that never did. If the baseline call fails, the script exits rather than
    waiting blind.
  - Comments are filtered on `since=`, which matches updated_at. CodeRabbit
    edits its own ack comment into the outcome, so a rate-limit marker from an
    earlier round is still in the unfiltered list and matches instantly — the
    wait would report "refused again" before anything had happened.

Every terminal outcome prints a line; only one of them raises the count. There
is no iteration cap: a cap that expired mid-cooldown would look identical to a
silent failure, and a review that is genuinely running would trip it. It
heartbeats instead, so silence carries its own elapsed time.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number

Environment:
  SHIP_PR_POLL_SECONDS  Seconds between polls. Default 30.
  SHIP_PR_SINCE         ISO-8601 UTC timestamp to filter comments from.
                        Defaults to now, captured before the baseline returns.
  SHIP_PR_FIXTURES      Colon-separated entries consumed one per iteration in
                        place of the `gh` calls. An entry is either a directory
                        holding `reviews.json` and `comments.json` — what
                        `pulls/<pr>/reviews` and `issues/<pr>/comments` would
                        return — or the form ERROR=<message>, standing in for
                        a failed call. No entry may contain a colon, which is
                        the separator. The baseline is read from the first
                        entry, so an ERROR there exercises the
                        no-baseline exit. The run ends when the list is
                        exhausted. This is how the script is exercised without a
                        live PR.

Output, one line, whichever applies:
  reviewed: <base> -> <n>                     the count rose; triage the findings
  refused: rate limited                       cool down, recompute, re-ping
  refused: merged, CodeRabbit is done for good
  refused: head commit changed mid-review
  refused: review failed — read the comment
  refused: skipped — ping did not register    re-ping, nothing was spent
  nothing reviewable — that IS the review
  still waiting, count=<n>, <m>m elapsed      heartbeat, every 10th poll
  API ERROR xN (count=<n>) — <message>        three consecutive failures

Exit codes:
  0  a terminal outcome was reached, or the fixture list ran out
  1  bad usage, or the baseline call failed
  2  three consecutive failures after the baseline
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

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$1
pr=$2
poll=${SHIP_PR_POLL_SECONDS:-30}

fixtures=()
offline=0
if [ -n "${SHIP_PR_FIXTURES:-}" ]; then
  offline=1
  IFS=: read -r -a fixtures <<<"$SHIP_PR_FIXTURES"
fi
step=0

count() {
  if [ -n "${1:-}" ]; then
    SHIP_PR_REVIEWS_FIXTURE=$1 "$here/review-count.sh" "$repo" "$pr"
  else
    "$here/review-count.sh" "$repo" "$pr"
  fi
}

no_baseline() {
  echo "cannot reach GitHub — no baseline, do not wait blind" >&2
  exit 1
}

# Ahead of the baseline call, not after it: a comment landing during that round
# trip is invisible to a `since=` taken once it returns.
since=${SHIP_PR_SINCE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}

if [ "$offline" -eq 1 ]; then
  case "${fixtures[0]:-ERROR=empty fixture list}" in
    ERROR=*) no_baseline ;;
  esac
  base=$(count "${fixtures[0]}/reviews.json") || no_baseline
else
  base=$(count) || no_baseline
fi

n=$base
body=""
fails=0
i=0

while true; do
  ok=1
  err=""

  if [ "$offline" -eq 1 ]; then
    if [ "$step" -ge "${#fixtures[@]}" ]; then
      echo "FIXTURES EXHAUSTED"
      exit 0
    fi
    entry=${fixtures[$step]}
    step=$((step + 1))
    case $entry in
      ERROR=*)
        ok=0
        err=${entry#ERROR=}
        ;;
      *)
        n=$(count "$entry/reviews.json")
        body=$(jq -r '.[] | select(.user.login == "coderabbitai[bot]") | .body' "$entry/comments.json")
        ;;
    esac
  else
    if n=$(count) && body=$(gh api "repos/$repo/issues/$pr/comments?since=$since" \
      --jq '.[] | select(.user.login=="coderabbitai[bot]") | .body'); then
      :
    else
      ok=0
      err="gh call failed"
    fi
  fi

  if [ "$ok" -eq 1 ]; then
    fails=0
    if [ "$n" -gt "$base" ]; then
      echo "reviewed: $base -> $n"
      exit 0
    fi
    case $body in
      *"rate limited by coderabbit.ai"*)
        echo "refused: rate limited"
        exit 0
        ;;
      *"did not have any reviewable changes"*)
        echo "nothing reviewable — that IS the review"
        exit 0
        ;;
      *"The pull request is closed"*)
        echo "refused: merged, CodeRabbit is done for good"
        exit 0
        ;;
      *"The head commit changed during the review"*)
        echo "refused: head commit changed mid-review"
        exit 0
        ;;
      *"Review failed"*)
        echo "refused: review failed — read the comment"
        exit 0
        ;;
      *"review in progress"*) : ;;
      *"Review skipped"* | *"Auto reviews are disabled"*)
        echo "refused: skipped — ping did not register"
        exit 0
        ;;
    esac
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 3 ]; then
      printf 'API ERROR x%s (count=%s) — stopping rather than waiting blind: %s\n' "$fails" "$n" "$err"
      exit 2
    fi
  fi

  i=$((i + 1))
  if [ $((i % 10)) -eq 0 ]; then
    echo "still waiting, count=$n, $(((i * poll) / 60))m elapsed"
  fi

  sleep "$poll"
done
