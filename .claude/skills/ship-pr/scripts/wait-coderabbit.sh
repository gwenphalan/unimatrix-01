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

Every terminal outcome prints a line; only one of them raises the count. A
review that finds nothing is the trap — it completes without moving the count,
so a loop watching only the count runs to its timeout on the commonest happy
path. That outcome is recognised from the summary comment instead, and it is
matched ahead of the in-progress marker: a body carrying both means the review
finished while stale progress text is still in the window.

The skipped notice is terminal only once a ping has been seen. With
`auto_review.enabled: false` every PR carries that notice from the moment it
opens, inside the `since` window of a waiter armed before the first ping, so
reading it as a swallowed ping reports a refusal of something nobody sent. A
ping is any comment in the window addressed to CodeRabbit by anyone else.

There is no iteration cap: a cap that expired mid-cooldown would look identical
to a silent failure, and a review that is genuinely running would trip it. It
heartbeats on stderr instead, so silence carries its own elapsed time without
costing the caller a notification per interval.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number

A rate-limit refusal is not a review — nothing was read — so this rides the
cooldown out and re-pings, once, rather than handing back three manual steps
whose arithmetic is the part that goes wrong. The deadline is the marker
comment's updated_at plus its countdown, never "now plus the countdown".

Four guards, because a ping is a spent slot and sustained pinging tightens an
adaptive limit:

  - Exactly one automatic re-ping. A second refusal means the window is longer
    than advertised, and that is the owner's call, not a loop's.
  - Only a rate-limit refusal. A merged PR, a changed head or a skipped ping
    still exit immediately; re-pinging those buys nothing.
  - A cooldown longer than the threshold exits with the figure instead of
    sleeping on it, so a long window stays a decision rather than a stall.
  - `since` advances to just before the ping. Skip that and the previous
    marker, still inside the old window, matches instantly and reports a
    refusal that already expired.

A refusal that predates the run is caught as well. `since` hides it from the
poll loop — which is the ordinary case, since a waiter is usually armed after a
refusal has been seen — so the comments are also read unfiltered once at
startup, and acted on when the marker's deadline is still in the future.
Staleness is arithmetic there, not position, which is what makes reading past
the window safe. A lapsed marker is reported and left alone: CodeRabbit never
deletes one, so a dead marker from a finished review is indistinguishable from a
window that wants a ping.

Fixture runs never post. The re-ping is live-only, and offline runs continue as
though it landed so the one-retry cap stays exercisable.

Environment:
  SHIP_PR_POLL_SECONDS  Seconds between polls. Default 30. Set it to 0 for a
                        fixture run, which has nothing to wait for and would
                        otherwise take 30s per entry.
  SHIP_PR_AUTO_REPING   1 to ride out a rate limit and re-ping once (default),
                        0 to report the refusal and exit as before. Only
                        *acting* is gated; a live marker is reported either way.
  SHIP_PR_AUTO_MERGE    1 to arm GitHub's auto-merge when the review comes back
                        clean. Default 0. Only a genuine clean review qualifies:
                        a refusal read nothing, a review with findings is not
                        clean, and an unreviewable diff is an unreviewed merge
                        wearing a clean one's clothes. GitHub still waits for
                        every required check, so this arms rather than merges.
  SHIP_PR_MAX_COOLDOWN  Longest cooldown to wait out, in seconds. Default 1800.
                        Beyond it the script exits and leaves the call to you.
                        Raise it for an overnight run, where wall-clock is free
                        and nobody is waiting.
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
  SHIP_PR_COMMENTS_FIXTURE
                        Read by coderabbit-deadline.sh, which this script runs
                        as a child, so exporting it drives the cooldown
                        arithmetic and the startup detection from a file. Set it
                        alongside SHIP_PR_FIXTURES; without it a fixture run
                        skips the startup check rather than reaching the
                        network.

Output, one line, whichever applies:
  reviewed: <base> -> <n>                     the count rose; triage the findings
  reviewed clean, count unchanged at <n>      it ran and found nothing
  auto-merge armed — GitHub squashes once the required checks pass
  auto-merge could NOT be armed — merge by hand
  offline: auto-merge not armed
  review in progress                          said once, then carried by the heartbeat
  live rate-limit marker at arm time, <n>m left
  stale rate-limit marker at arm time, deadline lapsed — polling only
  rate-limit marker at arm time, countdown unreadable — polling only
  auto-reping disabled — polling only, the ping is yours
  cooling down <n>m, re-pinging at <time>     riding out a rate limit, then one ping
  re-pinged at <time>                         the ping is posted; the wait goes on
  offline: re-ping suppressed, continuing as if posted
  refused: rate limited                       cool down, recompute, re-ping
  refused: rate limited, cooldown <n>m exceeds threshold
  refused: rate limited, countdown unreadable — the ping is yours
  refused: rate limited again after one re-ping
  refused: merged, CodeRabbit is done for good
  refused: head commit changed mid-review
  refused: review failed — read the comment
  auto-review-disabled notice, no ping yet — polling only
  refused: skipped — ping did not register    re-ping, nothing was spent
  nothing reviewable — that IS the review

On stderr, every 10th poll, so it reaches a terminal and the monitor's output
file without waking a caller that only reads stdout:
  still waiting, review running, count=<n>, <m>m elapsed
  still waiting, nothing from CodeRabbit yet, count=<n>, <m>m elapsed
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
auto_reping=${SHIP_PR_AUTO_REPING:-1}
auto_merge=${SHIP_PR_AUTO_MERGE:-0}
max_cooldown=${SHIP_PR_MAX_COOLDOWN:-1800}
repinged=0
# Sticky. CodeRabbit edits its in-progress comment into the outcome, so the text
# is gone from a later poll while the review is still legitimately running —
# recomputing this each round would report "nothing yet" mid-review.
in_progress=0
# Sticky for a second reason as well as that one: `ride_out_cooldown` advances
# `since`, so a ping seen once leaves the window on the very next poll.
#
# The skipped notice cannot tell a swallowed ping from the resting state of a
# repo with `auto_review.enabled: false` — every PR gets it at open, and this
# waiter is armed before the first ping, so the notice lands inside `since` and
# used to report a refusal of a ping that never existed. A ping is any comment
# in the window addressed to CodeRabbit by anyone but CodeRabbit; its own
# comments quote `@coderabbitai` in their help text, which is why the author is
# filtered rather than the text alone.
pinged=0
# Said once, like `review in progress`, and for the same reason: the notice sits
# in the window for the whole wait.
skip_notice=0

# Epoch seconds rendered in the reader's own timezone. Every comparison here is
# epoch arithmetic and every API filter is UTC; this is display only, and a
# deadline printed in UTC is one the reader has to convert before it means
# anything.
local_time() { date -d "@$1" '+%-I:%M:%S %p %Z'; }

# Hands the merge to GitHub rather than performing it here. `--auto` waits for
# every *required* status check on its own, so this never has to re-verify green
# or race a branch that goes BEHIND mid-wait — the same contract
# .github/workflows/dependabot-auto-merge.yml relies on.
#
# Off unless asked for. This waiter is armed on every PR, so a default-on merge
# would land work nobody chose to land. Reached only from the clean-review arm:
# a refusal read nothing and a review with findings is not clean, so neither is
# a merge signal.
arm_auto_merge() {
  [ "$auto_merge" -eq 1 ] || return 0
  if [ "$offline" -eq 1 ]; then
    echo "offline: auto-merge not armed"
    return 0
  fi
  if gh pr merge "$pr" --repo "$repo" --auto --squash --delete-branch >/dev/null 2>&1; then
    echo "auto-merge armed — GitHub squashes once the required checks pass"
  else
    # Never silent, and never phrased as though it merged. Arming fails for
    # reasons worth seeing: auto-merge disabled on the repo, a branch GitHub
    # will not fast-forward, missing permission.
    echo "auto-merge could NOT be armed — merge by hand"
  fi
}

# Seconds remaining on the cooldown, from the marker comment's own updated_at
# plus its countdown. Prints a bare integer, or nothing when the deadline
# cannot be established — an unparseable countdown must not be read as zero,
# because zero would ping immediately into a live limit.
cooldown_remaining() {
  local line updated count unit secs deadline
  # A fixture run carrying no comments fixture has nothing to read from. Without
  # this it would reach the network — the offline short-circuit that used to sit
  # in the caller was also what kept fixture runs hermetic, and moving the
  # detection ahead of it takes that away.
  if [ "$offline" -eq 1 ] && [ -z "${SHIP_PR_COMMENTS_FIXTURE:-}" ]; then
    return 1
  fi
  line=$("$here/coderabbit-deadline.sh" "$repo" "$pr" 2>/dev/null) || return 1
  case $line in
    updated=*countdown=[0-9]*) : ;;
    # Marker present, countdown missing or unreadable. Distinct from "no marker"
    # on purpose: the PR *is* rate limited and only the arithmetic is missing,
    # which the caller reports rather than passing over in silence.
    updated=*) return 2 ;;
    *) return 1 ;;
  esac
  updated=${line#updated=}
  updated=${updated%% *}
  count=${line##*countdown=}
  unit=${count#* }
  count=${count%% *}
  case $unit in
    second*) secs=1 ;;
    minute*) secs=60 ;;
    hour*) secs=3600 ;;
    *) return 2 ;;
  esac
  deadline=$(date -u -d "$updated" +%s 2>/dev/null) || return 2
  echo $((deadline + count * secs - $(date -u +%s)))
}

# The rate-limit path, reached from two places: the startup check below and the
# poll loop's own arm. Called plainly and never in a subshell, so its writes to
# `since` and `repinged` are the caller's.
#
# Prints an outcome line on every branch. Returns 0 when a re-ping was posted
# and waiting should continue, 1 when the outcome is terminal.
ride_out_cooldown() {
  local remaining
  if [ "$repinged" -eq 1 ]; then
    echo "refused: rate limited again after one re-ping"
    return 1
  fi
  if [ "$auto_reping" -ne 1 ]; then
    echo "refused: rate limited"
    return 1
  fi
  # rc=2 is "the marker is there, only the arithmetic is missing", and collapsing
  # it into rc=1 here reported a plain refusal for a PR whose cooldown simply
  # could not be read — the startup check keeps the two apart, and `--help`
  # promises both.
  local rc
  remaining=$(cooldown_remaining) && rc=0 || rc=$?
  case $rc in
    0) : ;;
    2)
      echo "refused: rate limited, countdown unreadable — the ping is yours"
      return 1
      ;;
    *)
      echo "refused: rate limited"
      return 1
      ;;
  esac
  [ "$remaining" -lt 0 ] && remaining=0
  if [ "$remaining" -gt "$max_cooldown" ]; then
    echo "refused: rate limited, cooldown $((remaining / 60))m exceeds threshold"
    return 1
  fi
  # +15s of slack: the countdown is whatever was true when the comment was last
  # edited, so pinging exactly on the boundary earns a second refusal and burns
  # the one retry.
  remaining=$((remaining + 15))
  echo "cooling down $((remaining / 60))m, re-pinging at $(local_time $(($(date -u +%s) + remaining)))"
  # Offline is the fixture harness, and it has to reach the arithmetic above —
  # that is the point of routing both entry points through one function. What it
  # must not do is sleep out a real countdown or post to a real PR, so it skips
  # both and continues as though the ping landed. That keeps the one-retry cap
  # testable: the next fixture entry exercises `repinged` on the way back in.
  if [ "$offline" -eq 1 ]; then
    repinged=1
    pinged=1
    body=""
    echo "offline: re-ping suppressed, continuing as if posted"
    return 0
  fi
  sleep "$remaining"
  # Before the ping, never after: the marker that just refused us is still
  # inside the old window and would match on the very next poll. This one stays
  # UTC — it is an API filter, not something anyone reads.
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if ! gh pr comment "$pr" --repo "$repo" --body "@coderabbitai full review" >/dev/null 2>&1; then
    echo "refused: rate limited, and the re-ping could not be posted"
    return 1
  fi
  repinged=1
  pinged=1
  body=""
  echo "re-pinged at $(local_time "$(date -u +%s)")"
  return 0
}

# A refusal that predates this run is invisible to the loop below: `since` is
# captured at arm time, so a marker older than it never enters the window and
# the script heartbeats on a PR that is plainly rate limited. Arming the waiter
# *after* seeing a refusal is the ordinary sequence, so that was the common case
# rather than the edge one.
#
# Dropping the `since` filter is not the fix — it is the thing `since` exists to
# prevent. The discriminator is arithmetic instead: a marker whose deadline is
# still in the future is live wherever it sits, because that is a property of
# the comment's own body rather than of when this run started.
#
# A fixture run with no comments fixture falls out here without acting, because
# `cooldown_remaining` refuses to read one.
startup_remaining=$(cooldown_remaining) && startup_rc=0 || startup_rc=$?
case $startup_rc in
  0)
    if [ "$startup_remaining" -gt 0 ]; then
      echo "live rate-limit marker at arm time, $((startup_remaining / 60))m left"
      # Detection is not gated on auto_reping — only acting is. Gating the whole
      # block would make SHIP_PR_AUTO_REPING=0 silent about a live rate limit,
      # which is the same no-op this block exists to remove and would leave the
      # operator with nothing to act on.
      if [ "$auto_reping" -eq 1 ]; then
        ride_out_cooldown || exit 0
      else
        echo "auto-reping disabled — polling only, the ping is yours"
      fi
    else
      # Only a positive remainder acts. CodeRabbit never deletes the marker, so
      # a lapsed one is ambiguous — a dead marker from a review that already
      # finished looks identical to a window that wants a ping, and pinging the
      # first spends a slot against an adaptive limit for nothing. Under-pinging
      # is the recoverable direction.
      #
      # Say so rather than falling through quietly. The defect this block fixes
      # is a silent no-op, and a second one would hide inside it.
      echo "stale rate-limit marker at arm time, deadline lapsed — polling only"
    fi
    ;;
  # Marker present, arithmetic unavailable. Same reasoning as the lapsed case:
  # the PR is rate limited, so silence here would be the very no-op this block
  # exists to remove.
  2) echo "rate-limit marker at arm time, countdown unreadable — polling only" ;;
esac

started=$(date +%s)

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
        # Guarded for the same reason the live branch is: a fixture that will not
        # parse has to land in `ok=0` and reach the three-strikes exit, not kill
        # the script under `set -e` with jq's stderr and no outcome line.
        if n=$(count "$entry/reviews.json") && comments=$(cat "$entry/comments.json") &&
          body=$(jq -r '.[] | select(.user.login == "coderabbitai[bot]") | .body' <<<"$comments"); then
          :
        else
          ok=0
          err="fixture $entry would not parse"
        fi
        ;;
    esac
  else
    # The whole comment list, parsed here rather than by `gh --jq`, because two
    # readings are taken from it: CodeRabbit's own text, and whether a ping is in
    # the window at all. A parse failure has to land in `ok=0` alongside a failed
    # call, or the three-strikes exit never sees it.
    #
    # Paginated, because a page is 30 comments oldest-first: on a chatty PR the
    # outcome comment falls off page 1 and this waits forever on a review that
    # already finished. `--jq` runs per page, so the objects are streamed out and
    # slurped back into one array rather than filtered per page — the same shape
    # coderabbit-deadline.sh uses, and for the same reason.
    if n=$(count) && raw=$(gh api "repos/$repo/issues/$pr/comments?since=$since" --paginate --jq '.[]') &&
      comments=$(jq -s '.' <<<"$raw") &&
      body=$(jq -r '.[] | select(.user.login == "coderabbitai[bot]") | .body' <<<"$comments"); then
      :
    else
      ok=0
      err="gh call failed or its comment list would not parse"
    fi
  fi

  if [ "$ok" -eq 1 ]; then
    fails=0
    if [ "$pinged" -eq 0 ] && jq -e --arg bot "coderabbitai[bot]" \
      'any(.[]; .user.login != $bot and (.body // "" | test("@coderabbitai")))' \
      >/dev/null <<<"$comments"; then
      pinged=1
    fi
    if [ "$n" -gt "$base" ]; then
      echo "reviewed: $base -> $n"
      exit 0
    fi
    case $body in
      # Ahead of "review in progress": a clean review never moves the count, so
      # this is the only signal that it finished. Matching it first means stale
      # progress text left in the window cannot hold the wait open past the end.
      *"No actionable comments were generated"*)
        echo "reviewed clean, count unchanged at $n"
        arm_auto_merge
        exit 0
        ;;
      *"rate limited by coderabbit.ai"*)
        # A refusal read nothing, so the re-ping is still the *first* review.
        # Only this outcome is worth riding out; the rest are final.
        ride_out_cooldown || exit 0
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
      *"review in progress"*)
        # Said once, then carried by the heartbeat. Without it, a running review
        # and a ping that never registered produce identical output for as long
        # as the review takes.
        if [ "$in_progress" -eq 0 ]; then
          in_progress=1
          echo "review in progress"
        fi
        ;;
      *"Review skipped"* | *"Auto reviews are disabled"*)
        # Terminal only after a ping. Before one the same notice is just this
        # repo's resting state, and exiting on it reports a refusal of something
        # nobody sent.
        if [ "$pinged" -eq 1 ]; then
          echo "refused: skipped — ping did not register"
          exit 0
        fi
        if [ "$skip_notice" -eq 0 ]; then
          skip_notice=1
          echo "auto-review-disabled notice, no ping yet — polling only"
        fi
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
    # stderr, not stdout, and deliberately. Under `Monitor` only stdout is the
    # event stream, so a heartbeat on stdout wakes the caller every 5 minutes to
    # be told nothing changed — and a line nobody can act on is the one thing
    # that guidance says not to emit. On stderr it still reaches the terminal for
    # a human, and still lands in the monitor's output file, so a review stuck
    # in progress is diagnosable after the fact. Measured, not assumed: a stderr
    # line produced no notification and appeared in the output file as
    # `[stderr] ...`.
    #
    # The two cases this used to disambiguate are covered now. A dead script is
    # reported when the stream ends, and running-versus-nothing is a state change
    # printed once above.
    # Wall clock, not polls × interval. `ride_out_cooldown` sleeps for up to
    # SHIP_PR_MAX_COOLDOWN inside a single iteration, so the arithmetic version
    # under-reported by the whole cooldown — the one stretch where a reader most
    # wants to know how long this has been going.
    elapsed=$((($(date +%s) - started) / 60))
    if [ "$in_progress" -eq 1 ]; then
      echo "still waiting, review running, count=$n, ${elapsed}m elapsed" >&2
    else
      echo "still waiting, nothing from CodeRabbit yet, count=$n, ${elapsed}m elapsed" >&2
    fi
  fi

  sleep "$poll"
done
