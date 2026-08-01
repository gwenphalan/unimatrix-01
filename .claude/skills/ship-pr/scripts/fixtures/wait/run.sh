#!/usr/bin/env bash
#
# Runs every wait-coderabbit.sh fixture and diffs its stdout and exit code
# against what this file says they should be. Nothing here reaches the network.
#
# The ping timestamp is the reason this exists rather than a README of
# invocations. `SHIP_PR_PING_AT` defaults to the epoch, which sits before every
# fixture timestamp — so a run that does not set it has the ping comparison
# switched off in both branches at once: every comment passes the `since` filter
# and every commit status reads as newer than the ping. The skip fixtures then
# pass while proving the opposite of their names. `skipped-resting` in
# particular is the regression test for the whole commit-status redesign, and
# under the default it printed `refused: skipped — ping did not register`.
#
# So the ping is pinned here, once, at 18:03:02Z — where the fixture data puts
# it — and the pair that carries the proof is:
#
#   skipped-resting     status skip at 18:00:00Z, BEFORE the ping   nothing to say
#   skipped-after-ping  status skip at 18:04:11Z, AFTER the ping    the ping was swallowed
#
# Same status description, opposite verdict, and the ping's position is the only
# difference between them.
#
# stderr is dropped: it carries the heartbeat and the offline notices, which say
# nothing about which arm was taken. Wall-clock times in the output are
# normalised, since a cooldown line renders the reader's own clock.
#
# Usage: run.sh [name ...]   — no arguments runs every case.

set -uo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
script=$here/../../wait-coderabbit.sh
ping=2026-07-31T18:03:02Z
wanted=("$@")
failures=0
ran=0

# name, expected exit code, SHIP_PR_FIXTURES, then any extra NAME=VALUE env.
# Expected stdout on stdin.
check() {
  local name=$1 want_rc=$2 fixtures=$3
  shift 3
  local expected actual rc
  expected=$(cat)
  if [ "${#wanted[@]}" -gt 0 ]; then
    local found=0 entry
    for entry in "${wanted[@]}"; do
      [ "$entry" = "$name" ] && found=1
    done
    [ "$found" -eq 1 ] || return 0
  fi
  ran=$((ran + 1))
  # The extra assignments come last, so a case can override a default rather
  # than being silently overridden by one.
  actual=$(
    env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
      SHIP_PR_FIXTURES="${fixtures//,/:}" "$@" "$script" fixture/repo 1 2>/dev/null
  )
  rc=$?
  # Normalised after the run, not piped through: a pipeline's exit code is the
  # last stage's, and the exit code is half of what each case asserts.
  actual=$(sed -E 's/(pinging at ).*/\1<time>/' <<<"$actual")
  if [ "$actual" = "$expected" ] && [ "$rc" = "$want_rc" ]; then
    printf '  ok    %s\n' "$name"
    return 0
  fi
  failures=$((failures + 1))
  printf '  FAIL  %s (exit %s, wanted %s)\n' "$name" "$rc" "$want_rc"
  diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | sed 's/^/        /'
}

# Fixture paths are absolute because SHIP_PR_FIXTURES is read from wherever the
# caller happens to stand, and comma-separated because the script's own
# separator is a colon and writing them out twice is how one goes stale.
f() {
  local out="" name
  for name in "$@"; do out+="$here/$name,"; done
  printf '%s' "${out%,}"
}

printf 'wait-coderabbit fixtures\n\n'

check clean 0 "$(f clean)" <<'EOF'
reviewed clean, count unchanged at 1
offline: auto-merge not armed
EOF

check head-changed 0 "$(f head-changed)" <<'EOF'
refused: head commit changed mid-review, reviewed head was fixture-head-sha
EOF

check in-progress 0 "$(f in-progress)" <<'EOF'
review in progress
FIXTURES EXHAUSTED
EOF

check merged 0 "$(f merged)" <<'EOF'
refused: merged, CodeRabbit is done for good
EOF

check no-changes 0 "$(f no-changes)" <<'EOF'
nothing reviewable — that IS the review
EOF

check quiet 0 "$(f quiet)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# The baseline comes from the first entry, so the count only rises across two.
check reviewed 0 "$(f quiet reviewed)" <<'EOF'
reviewed: 1 -> 2
EOF

# No comments fixture, so the cooldown arithmetic has nothing to read and the
# refusal is reported rather than ridden out.
check rate-limited 0 "$(f rate-limited)" <<'EOF'
refused: rate limited
EOF

check rate-limited-retry 0 "$(f rate-limited clean)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/rate-limited/comments.json" <<'EOF'
stale rate-limit marker at arm time, deadline lapsed — pinging anyway
cooling down 0m, re-pinging at <time>
offline: re-ping suppressed, continuing as if posted
reviewed clean, count unchanged at 1
offline: auto-merge not armed
EOF

# One retry and no more: the second refusal is the owner's call.
check rate-limited-cap 0 "$(f rate-limited rate-limited)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/rate-limited/comments.json" <<'EOF'
stale rate-limit marker at arm time, deadline lapsed — pinging anyway
cooling down 0m, re-pinging at <time>
offline: re-ping suppressed, continuing as if posted
refused: rate limited again after one re-ping
EOF

# No commit status at all — the comment fallback reads the skip notice, and
# everything in `bodies` is already newer than the ping.
check skipped 0 "$(f skipped)" <<'EOF'
refused: skipped — ping did not register
EOF

# The pair. Same "Review skipped" description, opposite sides of the ping.
check skipped-after-ping 0 "$(f skipped-after-ping)" <<'EOF'
refused: skipped — ping did not register
EOF

check skipped-resting 0 "$(f skipped-resting)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# A failed first call is a missing baseline, and waiting blind is worse than
# stopping.
check no-baseline 1 "ERROR=boom" <<'EOF'
EOF

check three-strikes 2 "$(f quiet),ERROR=a,ERROR=b,ERROR=c" <<'EOF'
API ERROR x3 (count=1) — stopping rather than waiting blind: c
EOF

# An unreadable ping has no timestamp for either branch to compare against, so
# the run stops instead of letting the two disagree.
check unreadable-ping 1 "$(f clean)" SHIP_PR_PING_AT=not-a-timestamp <<'EOF'
ping timestamp is unreadable — nothing to compare against
EOF

printf '\n%s case(s), %s failure(s)\n' "$ran" "$failures"
[ "$failures" -eq 0 ]
