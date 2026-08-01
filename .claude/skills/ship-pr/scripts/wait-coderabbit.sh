#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
wait-coderabbit.sh <owner/repo> <pr>

Pings CodeRabbit, waits for that ping to reach one of its terminal outcomes,
and prints which. Arm it under `Monitor` and carry on working.

**It posts the ping itself, so do not also ping by hand.** A second ping against
an adaptive limit costs a slot, and it moves the marker this script does its
cooldown arithmetic on. There is no switch that hands the ping back: two code
paths meant every later comparison had to guess whether a ping existed, and
guessing wrong is what made this repo's resting `Review skipped` notice read as
a swallowed one.

The order is the design, and it runs before the ping:

  - The head sha is pinned once and never re-read. CodeRabbit's commit status is
    per sha, so a push landing after the review leaves the new head carrying
    only the resting skip notice.
  - The baseline is not zero. A PR reviewed once already starts at n >= 1, so a
    loop testing n > 0 succeeds immediately and you merge believing a review ran
    that never did. If the baseline call fails, the script exits rather than
    waiting blind.
  - A cooldown that is already live is ridden out first, so the ping is spent on
    the far side of it rather than refused on arrival.

Then it pings with `gh api` rather than `gh pr comment`, because the created
comment comes back and its `created_at` is GitHub's own. Every later "did this
arrive in answer to the ping" comparison runs against a clock the API also
filters on, so no local skew enters the arithmetic.

The primary signal is CodeRabbit's commit status on the pinned sha, context
`CodeRabbit`, read from the combined status endpoint. It is undocumented — four
descriptions measured across two PRs — so an absent context degrades to matching
the comments and says so on stderr rather than hanging:

  Review queued                                  keep polling
  Review in progress                             said once, then the heartbeat
  Review skipped: ...   updated after the ping    the ping was swallowed
  Review skipped: ...   updated before the ping    this repo's resting state
  Review completed                               read the comments for the outcome

The `state` field is not read. It was measured `success` for both the skip and
the completion, so branching on it would call a swallowed ping a finished
review. The timestamp is the whole discriminator: with `auto_review.enabled:
false` every PR carries a skip notice from the moment it opens, so where that
notice sits in a list says nothing and when it was written says everything.

`Review completed` is a phase rather than an outcome — on the one PR measured
here it landed two seconds AFTER the summary comment, and nothing guarantees
that order — so a completed status with neither a raised count nor a summary in
the window keeps polling instead of terminating with nothing to report.

Comments are then matched one body at a time, newest first, and only those
updated after the ping. Matching against every body concatenated asks "does this
string appear anywhere on the PR", which is true of a marker from a round that
finished hours ago. A clean review is matched ahead of the in-progress marker
within a single body: it completes without moving the count, so it is the trap a
loop watching only the count runs to its timeout on.

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

  - Exactly one automatic re-ping. The cap counts refusals absorbed, not pings
    posted: a first ping that had to wait out a pre-existing cooldown is still
    the first ping, and would otherwise arrive with its retry already spent. A
    second refusal means the window is longer than advertised, and that is the
    owner's call, not a loop's.
  - Only a rate-limit refusal. A merged PR, a changed head or a skipped ping
    still exit immediately; re-pinging those buys nothing.
  - A cooldown longer than the threshold exits with the figure instead of
    sleeping on it, so a long window stays a decision rather than a stall.
  - `since` advances to just before each ping. Skip that and the previous
    marker, still inside the old window, matches instantly and reports a
    refusal that already expired.

A refusal that predates the run is caught as well, before the ping. `since`
would hide it from the poll loop — and arming this after seeing a refusal is the
ordinary sequence — so the comments are read unfiltered once at startup, and the
cooldown ridden out when the marker's deadline is still in the future. Staleness
is arithmetic there, not position, which is what makes reading past the window
safe. A lapsed marker or an unreadable countdown no longer stops anything: this
script has not pinged yet, so the window is open and the ping goes out.

Every startup path that declines to ping is terminal. Nothing else is going to
post one, so polling on would be a wait that can only end in a timeout.

Fixture runs never post. Both the first ping and the re-ping are live-only, and
offline runs continue as though each landed so the one-retry cap stays
exercisable.

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
  SHIP_PR_SINCE         ISO-8601 UTC timestamp to filter comments from before
                        the ping is posted. The ping's own timestamp supersedes
                        it.
  SHIP_PR_FIXTURES      Colon-separated entries consumed one per iteration in
                        place of the `gh` calls. An entry is either a directory
                        holding `reviews.json`, `comments.json` and optionally
                        `status.json` — what `pulls/<pr>/reviews`,
                        `issues/<pr>/comments` and `commits/<sha>/status` would
                        return — or the form ERROR=<message>, standing in for
                        a failed call. A directory with no `status.json`, or one
                        whose `statuses` carry no `CodeRabbit` context, exercises
                        the fallback to comment matching. No entry may contain a
                        colon, which is the separator. The baseline is read from
                        the first entry, so an ERROR there exercises the
                        no-baseline exit. The run ends when the list is
                        exhausted. This is how the script is exercised without a
                        live PR.
  SHIP_PR_PING_AT       ISO-8601 UTC timestamp standing in for the ping a
                        fixture run does not post. Offline only. Defaults to the
                        epoch, which puts the ping before every fixture
                        timestamp; set it between two of them to place a status
                        or a comment on the resting side of the ping, which is
                        the only way the resting skip is testable offline.
  SHIP_PR_HEAD_SHA      Head sha for a fixture run, which has no PR to read one
                        from. Offline only. Defaults to `fixture-head-sha`.
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
  stale rate-limit marker at arm time, deadline lapsed — pinging anyway
  rate-limit marker at arm time, countdown unreadable — pinging anyway
  auto-reping disabled — the ping is yours, nothing was posted
  cannot post the ping — nothing to wait for
  cooling down <n>m, re-pinging at <time>     riding out a rate limit, then one ping
  re-pinged at <time>                         the ping is posted; the wait goes on
  offline: re-ping suppressed, continuing as if posted
  refused: rate limited                       cool down, recompute, re-ping
  refused: rate limited, cooldown <n>m exceeds threshold
  refused: rate limited, countdown unreadable — the ping is yours
  refused: rate limited again after one re-ping
  refused: merged, CodeRabbit is done for good
  refused: head commit changed mid-review, reviewed head was <sha>
  refused: review failed — read the comment
  refused: skipped — ping did not register    re-ping, nothing was spent
  nothing reviewable — that IS the review

On stderr, every 10th poll, so it reaches a terminal and the monitor's output
file without waking a caller that only reads stdout:
  still waiting, review running, count=<n>, <m>m elapsed
  still waiting, nothing from CodeRabbit yet, count=<n>, <m>m elapsed
  API ERROR xN (count=<n>) — <message>        three consecutive failures

Also on stderr, said once where they apply:
  no CodeRabbit commit status on <sha> — falling back to comment matching
  offline: first ping suppressed, ping_at=<time>

Exit codes:
  0  a terminal outcome was reached, or the fixture list ran out
  1  bad usage, the baseline or head-sha call failed, or the ping would not post
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

# Captured once and never re-read. CodeRabbit's commit status is per sha, so a
# push landing after the review leaves the new head carrying only this repo's
# resting skip notice — re-reading the head each poll would read that and call it
# a swallowed ping. Pinning it means a moved head shows up as a moved head.
if [ "$offline" -eq 1 ]; then
  head_sha=${SHIP_PR_HEAD_SHA:-fixture-head-sha}
elif ! head_sha=$(gh api "repos/$repo/pulls/$pr" --jq '.head.sha'); then
  echo "cannot reach GitHub — no head sha, do not wait blind" >&2
  exit 1
fi

# Ahead of the baseline call, not after it: a comment landing during that round
# trip is invisible to a `since=` taken once it returns. It is superseded by the
# ping's own timestamp below; this is the window for anything that happens before
# the ping is posted.
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
bodies=()
status_line=""
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
ping_posted=0
ping_at=""
ping_epoch=0
if [ "$offline" -eq 1 ]; then
  # A fixture run posts nothing, so the ping's timestamp is supplied instead. The
  # epoch default puts the ping before every fixture timestamp, which is the
  # resting behaviour of every fixture that does not care; the resting-skip
  # fixtures set it deliberately so their status lands on the earlier side.
  ping_at=${SHIP_PR_PING_AT:-1970-01-01T00:00:00Z}
fi
# Said once. A run whose head sha carries no CodeRabbit status falls back to
# reading the comments, which is what the script did before the status was found
# — worth saying on stderr, because the status is the better signal and its
# absence means the vocabulary changed.
status_absent_said=0

# Epoch seconds rendered in the reader's own timezone. Every comparison here is
# epoch arithmetic and every API filter is UTC; this is display only, and a
# deadline printed in UTC is one the reader has to convert before it means
# anything.
local_time() { date -d "@$1" '+%-I:%M:%S %p %Z'; }

# Posts the ping and echoes GitHub's own created_at for it. Nothing on failure.
#
# `gh api` rather than `gh pr comment`, because the created object comes back and
# its timestamp is GitHub's — every later "did this land after the ping"
# comparison is against a clock the API also filters on, so no local skew enters
# the arithmetic.
post_ping() {
  gh api "repos/$repo/issues/$pr/comments" -f body='@coderabbitai full review' \
    --jq '.created_at' 2>/dev/null
}

# Everything after the ping is discriminated on `ping_at`, so it is converted
# once. The `since=` window backs off a second: the API filter is inclusive and
# whole-second, and a comment sharing the ping's second must not be filtered out
# before the per-comment comparison gets to judge it.
adopt_ping_at() {
  ping_posted=1
  if ping_epoch=$(date -u -d "$ping_at" +%s 2>/dev/null); then
    since=$(date -u -d "@$((ping_epoch - 1))" +%Y-%m-%dT%H:%M:%SZ)
  else
    echo "ping timestamp $ping_at is unreadable — comparisons fall back to the comment list" >&2
    ping_epoch=0
    since=${SHIP_PR_SINCE:-$since}
  fi
}

# The CodeRabbit commit status on the pinned head, as
# "<updated_at><TAB><description>". Takes the fixture directory offline and reads
# the combined status endpoint live; that endpoint returns the latest status per
# context, so there is at most one line either way.
#
# Empty output is a real state rather than an error: the context is undocumented,
# so a vocabulary change has to degrade to comment matching rather than hang.
# Fills `bodies` with CodeRabbit's comment bodies from `comments`, newest first,
# and only those updated after the ping. Returns 1 when `comments` is not a JSON
# array, so a bad read reaches the three-strikes exit.
#
# Base64 per body, because a body is multi-line and the `case` below has to see
# each one whole. The timestamps are RFC 3339 in UTC, so a string comparison is
# a chronological one and no clock conversion enters the filter.
read_bodies() {
  local encoded=() line
  bodies=()
  jq -e 'type == "array"' >/dev/null <<<"$comments" || return 1
  mapfile -t encoded < <(
    jq -r --arg since "$ping_at" '
      [.[] | select(.user.login == "coderabbitai[bot]") | select(.updated_at > $since)]
      | sort_by(.updated_at) | reverse | .[] | .body | @base64' <<<"$comments"
  )
  for line in ${encoded+"${encoded[@]}"}; do
    bodies+=("$(base64 -d <<<"$line")")
  done
}

coderabbit_status() {
  local raw
  if [ -n "${1:-}" ]; then
    [ -f "$1/status.json" ] || return 0
    raw=$(cat "$1/status.json") || return 1
  else
    raw=$(gh api "repos/$repo/commits/$head_sha/status") || return 1
  fi
  jq -r '.statuses[]? | select(.context == "CodeRabbit")
         | "\(.updated_at)\t\(.description)"' <<<"$raw"
}

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
    # `ping_at` stays where the fixture put it — a suppressed ping cannot move a
    # timestamp nothing posted — but the run still has to count as pinged, or the
    # startup path would fall through and "post" a second one.
    adopt_ping_at
    echo "offline: re-ping suppressed, continuing as if posted"
    return 0
  fi
  sleep "$remaining"
  local created
  created=$(post_ping) || created=""
  if [ -z "$created" ]; then
    echo "refused: rate limited, and the re-ping could not be posted"
    return 1
  fi
  # Adopting the new ping's timestamp also advances `since`, which is what keeps
  # the marker that just refused us — still sitting in the old window — from
  # matching on the very next poll.
  ping_at=$created
  adopt_ping_at
  repinged=1
  echo "re-pinged at $(local_time "$(date -u +%s)")"
  return 0
}

# This runs BEFORE the script posts its own ping, and that ordering is the point:
# a cooldown that is already live means the ping would be refused on arrival, so
# the wait is ridden out first and the ping spent on the far side of it.
#
# `since` would hide a marker older than arm time, and arming the waiter *after*
# seeing a refusal is the ordinary sequence — so the comments are read unfiltered
# here. Dropping the `since` filter in the loop is not the fix; it is the thing
# `since` exists to prevent. The discriminator is arithmetic instead: a marker
# whose deadline is still in the future is live wherever it sits, because that is
# a property of the comment's own body rather than of when this run started.
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
      #
      # With the script owning the ping, declining to act is terminal rather than
      # "polling only": nothing else is going to post one, so polling on would be
      # a wait that can only end in a timeout.
      if [ "$auto_reping" -eq 1 ]; then
        ride_out_cooldown || exit 0
      else
        echo "auto-reping disabled — the ping is yours, nothing was posted"
        exit 0
      fi
    else
      # A lapsed marker used to be ambiguous, because a human's ping might
      # already have been sent and the marker left over from it. It is not
      # ambiguous any more: this script has not pinged yet, so the window is
      # open and the ping below is the right move. Said out loud rather than
      # passed over, because the marker is still sitting on the PR and a reader
      # who greps for it deserves to know it was read and judged dead.
      echo "stale rate-limit marker at arm time, deadline lapsed — pinging anyway"
    fi
    ;;
  # Marker present, arithmetic unavailable — so there is no deadline to sleep
  # until. Ping anyway: if the window really is still live the ping comes back
  # refused, and that refusal is the one the retry below absorbs. Staying silent
  # and polling would be the no-op this block exists to remove.
  2) echo "rate-limit marker at arm time, countdown unreadable — pinging anyway" ;;
esac

# The ping is the script's, always. There is no environment switch that hands it
# back: two code paths meant every later comparison had to guess whether a ping
# existed, and guessing wrong is what made this repo's resting `Review skipped`
# notice read as a swallowed ping.
if [ "$ping_posted" -eq 0 ]; then
  if [ "$offline" -eq 1 ]; then
    # stderr, not stdout: a fixture run's stdout is its outcome, and a line every
    # fixture prints carries nothing.
    echo "offline: first ping suppressed, ping_at=$ping_at" >&2
  else
    ping_at=$(post_ping) || ping_at=""
    if [ -z "$ping_at" ]; then
      echo "cannot post the ping — nothing to wait for"
      exit 1
    fi
  fi
  adopt_ping_at
fi

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
          read_bodies && status_line=$(coderabbit_status "$entry"); then
          :
        else
          ok=0
          err="fixture $entry would not parse"
        fi
        ;;
    esac
  else
    # The whole comment list, parsed here rather than by `gh --jq`, because the
    # bodies are then matched one at a time below. A parse failure has to land in
    # `ok=0` alongside a failed call, or the three-strikes exit never sees it.
    #
    # Paginated, because a page is 30 comments oldest-first: on a chatty PR the
    # outcome comment falls off page 1 and this waits forever on a review that
    # already finished. `--jq` runs per page, so the objects are streamed out and
    # slurped back into one array rather than filtered per page — the same shape
    # coderabbit-deadline.sh uses, and for the same reason.
    if n=$(count) && raw=$(gh api "repos/$repo/issues/$pr/comments?since=$since" --paginate --jq '.[]') &&
      comments=$(jq -s '.' <<<"$raw") && read_bodies && status_line=$(coderabbit_status); then
      :
    else
      ok=0
      err="gh call failed or its comment list would not parse"
    fi
  fi

  if [ "$ok" -eq 1 ]; then
    fails=0

    # Primary signal: CodeRabbit's own commit status on the pinned head. It is
    # undocumented — four descriptions measured across two PRs — so an absent
    # context degrades to the comment matching below rather than hanging.
    #
    # The `state` field is deliberately not read. It was measured `success` for
    # both "Review skipped" and "Review completed", so branching on it would call
    # a swallowed ping a finished review.
    if [ -z "$status_line" ]; then
      if [ "$status_absent_said" -eq 0 ]; then
        status_absent_said=1
        echo "no CodeRabbit commit status on $head_sha — falling back to comment matching" >&2
      fi
    else
      status_at=${status_line%%$'\t'*}
      status_text=${status_line#*$'\t'}
      case $status_text in
        "Review skipped"*)
          # The whole redesign in one comparison. With `auto_review.enabled:
          # false` every PR carries this notice from the moment it opens, so its
          # position in a list says nothing — but its timestamp does. Older than
          # our ping, it is this repo's resting state and there is nothing to
          # announce. Newer, the ping was swallowed.
          if [ "$(date -u -d "$status_at" +%s 2>/dev/null || echo 0)" -gt "$ping_epoch" ]; then
            echo "refused: skipped — ping did not register"
            exit 0
          fi
          ;;
        "Review in progress"*)
          if [ "$in_progress" -eq 0 ]; then
            in_progress=1
            echo "review in progress"
          fi
          ;;
      esac
    fi

    if [ "$n" -gt "$base" ]; then
      echo "reviewed: $base -> $n"
      exit 0
    fi

    # `Review completed` is a phase, not an outcome: it says CodeRabbit stopped,
    # not what it found, and on the one PR measured here it landed two seconds
    # AFTER the summary comment. Nothing guarantees that order, so a completed
    # status with neither a raised count nor a summary in the window keeps
    # polling rather than terminating with no content to report. Do not
    # "simplify" this into an exit — it reads like an oversight and is the
    # opposite.
    #
    # One comment at a time, newest first, and the first match wins. Matching
    # against every body concatenated asks "does this string appear anywhere on
    # the PR", which is true of a marker from a round that finished hours ago —
    # correctness then rests on the order of the arms below rather than on the
    # order of events.
    for body in "${bodies[@]}"; do
      case $body in
        # Ahead of "review in progress" within a single body: a clean review
        # never moves the count, so this is the only signal that it finished, and
        # a body carrying both means the review ended while stale progress text
        # was still in it.
        *"No actionable comments were generated"*)
          echo "reviewed clean, count unchanged at $n"
          arm_auto_merge
          exit 0
          ;;
        *"rate limited by coderabbit.ai"*)
          # A refusal read nothing, so the re-ping is still the *first* review.
          # Only this outcome is worth riding out; the rest are final.
          ride_out_cooldown || exit 0
          break
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
          echo "refused: head commit changed mid-review, reviewed head was $head_sha"
          exit 0
          ;;
        *"Review failed"*)
          echo "refused: review failed — read the comment"
          exit 0
          ;;
        *"review in progress"*)
          # Said once, then carried by the heartbeat. Without it, a running
          # review and a ping that never registered produce identical output for
          # as long as the review takes.
          if [ "$in_progress" -eq 0 ]; then
            in_progress=1
            echo "review in progress"
          fi
          break
          ;;
        *"Review skipped"* | *"Auto reviews are disabled"*)
          # Reached only where the commit status is absent, and the resting-state
          # ambiguity is already gone by the time it is: `bodies` holds nothing
          # older than the ping this script posted, so a skip notice in here is a
          # skip notice that arrived in answer to it.
          echo "refused: skipped — ping did not register"
          exit 0
          ;;
      esac
    done
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
