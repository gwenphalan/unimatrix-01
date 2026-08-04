#!/usr/bin/env bash
#
# Runs every watch-pr.sh fixture and diffs its stdout and exit code against what
# this file says they should be. Nothing here reaches the network.
#
# `watch-pr.sh` has two phases and both are offline here: phase 1 reads its
# required-context list from SHIP_PR_BRANCH_RULES_FIXTURE and its check results
# from SHIP_PR_CHECKS_FIXTURES, phase 2 reads reviews and comments from
# SHIP_PR_FIXTURES. The script requires all three together, so every case gets
# the one-context gate below by default and the review cases pass through it
# unchanged — invisibly now, since `PASS  Verify` and `checks green on <sha>`
# moved to stderr and stdout is dropped here (see below).
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
# That trap has a phase-1 twin, which is why the gate is not simply switched off
# when its fixtures are unset: every case below would then claim a green gate it
# never proved.
#
# stderr is dropped: it carries the heartbeats, the offline notices, the whole
# phase-1 ledger (`PASS`/`SKIPPING` rows and `checks green on <sha>`), and now
# `review in progress` and the rate-limit progress lines, none of which say
# anything about which arm was taken. Wall-clock times in the output are
# normalised, since a cooldown line renders the reader's own clock.
#
# That move costs coverage: `no-baseline`, `partial-fixtures` and
# `checks-timeout-non-numeric` now share one expectation — empty stdout, exit 1
# — and are distinguished only by which fixtures each sets, not by anything
# `check()` diffs. The `phase-1-ledger-on-stderr` and `in-progress-on-stderr`
# assertions below are what prove the moved rows are still printed at all,
# since every `check()` case above now proves only that they are off stdout.
#
# Usage: run-fixtures.sh [name ...]   — no arguments runs every case.

set -uo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
script=$here/../watch-pr.sh
ping=2026-07-31T18:03:02Z
wanted=("$@")
failures=0
ran=0

# name, expected exit code, SHIP_PR_FIXTURES, then any extra NAME=VALUE env —
# and, after a literal `--`, arguments for the script itself. Expected stdout on
# stdin.
#
# The split exists because `--no-review` is a flag rather than a setting, so a
# case that exercises it cannot be expressed as another env assignment.
check() {
  local name=$1 want_rc=$2 fixtures=$3
  shift 3
  local expected actual rc arg
  local envs=() flags=() past=0
  for arg in ${1+"$@"}; do
    if [ "$past" -eq 0 ] && [ "$arg" = "--" ]; then
      past=1
    elif [ "$past" -eq 1 ]; then
      # An env assignment written on the wrong side of the `--` reaches the
      # script as a third positional, and its usage error is exit 1 with empty
      # stdout — which is exactly what `checks-timeout-non-numeric` and
      # `partial-fixtures` legitimately expect. Left alone, a miswritten case
      # could pass by matching the wrong failure. So it fails as itself.
      case $arg in
        -*) flags+=("$arg") ;;
        *)
          printf '  FAIL  %s (arguments after the separator go to the script and must be flags, got: %s)\n' \
            "$name" "$arg"
          failures=$((failures + 1))
          return 0
          ;;
      esac
    else
      envs+=("$arg")
    fi
  done
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
      SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
      SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
      SHIP_PR_FIXTURES="${fixtures//,/:}" ${envs+"${envs[@]}"} \
      "$script" ${flags+"${flags[@]}"} fixture/repo 1 2>/dev/null
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

# Fixture paths are absolute because the SHIP_PR_* variables are read from
# wherever the caller happens to stand. `f` takes review-wait fixture
# directories, comma-separated because the script's own separator is a colon and
# writing them out twice is how one goes stale; `cf` takes phase-1 check
# payloads, which are flat files beside this one.
f() {
  local out="" name
  for name in "$@"; do out+="$here/wait/$name,"; done
  printf '%s' "${out%,}"
}

cf() {
  local out="" name
  for name in "$@"; do out+="$here/$name:"; done
  printf '%s' "${out%:}"
}

# Post-review thread-wait payloads, colon-separated like `cf` — the wait
# consumes SHIP_PR_THREADS_FIXTURES the same way phase 1 consumes
# SHIP_PR_CHECKS_FIXTURES, one entry per poll.
tf() {
  local out="" name
  for name in "$@"; do out+="$here/threads/$name:"; done
  printf '%s' "${out%:}"
}

# The three-context gate, matching the names the checks-*.json payloads carry.
three=SHIP_PR_BRANCH_RULES_FIXTURE=$here/branch-rules.json

printf 'watch-pr fixtures\n\n'

# --- Phase 1: the required-context gate ------------------------------------

# The regression test for the hazard merging the two scripts creates. Everything
# in this payload is terminal and green and none of it is required, so the old
# "nothing is pending" exit condition would have read it as green and pinged.
check checks-non-required-only 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-non-required-only.json checks-green-three.json)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# A red required context is terminal on the poll it appears, and phase 2 never
# runs — no ping, no outcome line.
check checks-red 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" <<'EOF'
FAIL  Images (api)
checks red: Images (api) — not pinging
EOF

# Results print as they land, once each, and then the gate closes.
check checks-pending-to-green 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-all-pending.json checks-pending.json checks-green-three.json)" <<'EOF'
FIXTURES EXHAUSTED
EOF

check checks-skipping 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-skipping.json)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# `gh pr checks` exits 1 with this on stderr when the head commit carries no
# check at all — the state for the first minutes after a PR opens. Three in a row
# must not reach the three-strikes exit; without the normalisation this case ends
# at exit 2 having never pinged.
check checks-empty-list 0 "$(f quiet)" \
  SHIP_PR_CHECKS_FIXTURES="ERROR=no checks reported on the 'feat/x' branch:ERROR=no checks reported on the 'feat/x' branch:ERROR=no checks reported on the 'feat/x' branch:$here/checks-green-one.json" <<'EOF'
FIXTURES EXHAUSTED
EOF

# Phase 1 keeps its own ledger; these three are not shared with phase 2's.
check checks-three-strikes 2 "$(f quiet)" \
  SHIP_PR_CHECKS_FIXTURES="ERROR=a:ERROR=b:ERROR=c" <<'EOF'
checks API ERROR x3 — stopping rather than gating blind: c
EOF

# A required context that never appears ends the run naming it, rather than
# polling forever behind a heartbeat.
check checks-timeout 0 "$(f quiet)" "$three" SHIP_PR_CHECKS_TIMEOUT=0 \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-all-pending.json)" <<'EOF'
checks timed out after 0m — never reported: Verify, Images (api), CodeQL
EOF

# A non-numeric cap is rejected at startup. Left to the comparison it evaluates
# false on every poll, so the run is unbounded — the one failure mode the cap
# exists to remove.
check checks-timeout-non-numeric 1 "$(f quiet)" "$three" SHIP_PR_CHECKS_TIMEOUT=soon \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-all-pending.json)" <<'EOF'
EOF

# An empty required list is a failure, not a vacuously green gate.
check no-required-contexts 1 "$(f quiet)" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-empty.json" <<'EOF'
no required status checks — refusing to read an empty list as green
EOF

# The three fixture variables are one switch. Two of them set is a usage error,
# not a run that reaches the network for the third.
check partial-fixtures 1 "$(f quiet)" SHIP_PR_BRANCH_RULES_FIXTURE= <<'EOF'
EOF

# --- --no-review: phase 1, a thread wait, then the arm ----------------------

# `never-reviewed` carries an empty `reviews.json` and nothing else — it is the
# baseline `--no-review`'s own count() read consumes, and a phase-2 run
# reaching it at all would fail hard on the missing `comments.json` rather than
# quietly printing `FIXTURES EXHAUSTED`, so this proves phase 2 never ran at
# least as strongly as the fuller fixture it replaces did.
check no-review-arms 0 "$(f never-reviewed)" -- --no-review <<'EOF'
offline: auto-merge not armed (would be UNREVIEWED on fixture-head-sha)
EOF

# The off switch outranks the flag, and says so rather than leaving the run's
# only output as `checks green` — which reads as a script that died. Exits
# before the thread wait or the baseline read, so the fixture directory here
# does not matter; `never-reviewed` is used for consistency with the other two.
check no-review-auto-merge-off 0 "$(f never-reviewed)" SHIP_PR_AUTO_MERGE=0 -- --no-review <<'EOF'
no review requested, and auto-merge is off — nothing armed
EOF

# Skipping the review does not skip the gate: the flag is read long after phase
# 1 is over. The expectation is the `checks-red` case's, typed out again rather
# than derived from it — so the two are equal by two copies, not by construction.
check no-review-checks-red 0 "$(f never-reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" -- --no-review <<'EOF'
FAIL  Images (api)
checks red: Images (api) — not pinging
EOF

# `already-reviewed`'s baseline carries one bodied CodeRabbit review — a PR
# this run never pinged but that CodeRabbit already read. The wording is about
# that history, not about the flag: the ordinary armed line, not UNREVIEWED.
# Not `quiet`, which ~10 phase-1-only cases above also consume for a fixture
# list that never reaches the baseline read — those needed it zeroed to stay
# clear of the new startup auto-skip, and reusing it here would have silently
# flipped this case's own expectation along with them.
check no-review-prior-review 0 "$(f already-reviewed)" -- --no-review <<'EOF'
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# --- Phase 2: the review wait ----------------------------------------------

check clean 0 "$(f clean)" <<'EOF'
reviewed clean, count unchanged at 0
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# The off switch outranks a genuinely clean review, and arm_auto_merge()'s
# return code is what wait_for_merge() gates on — a non-zero return here must
# not enter that wait.
check clean-auto-merge-off 0 "$(f clean)" SHIP_PR_AUTO_MERGE=0 <<'EOF'
reviewed clean, count unchanged at 0
offline: auto-merge not armed (auto-merge is off)
EOF

check head-changed 0 "$(f head-changed)" <<'EOF'
refused: head commit changed mid-review, reviewed head was fixture-head-sha
EOF

check in-progress 0 "$(f in-progress)" <<'EOF'
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
# Findings now fall into the post-review wait rather than exiting: the default-
# clear thread wait (no SHIP_PR_THREADS_FIXTURES) passes through immediately,
# and the required-checks recheck consumes a *second* SHIP_PR_CHECKS_FIXTURES
# entry — proving the fixture cursor really is the continuous stream `--help`
# describes, since the default single-entry list would otherwise exhaust here.
check reviewed 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" <<'EOF'
reviewed: 0 -> 1
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# Same shape as `reviewed`, but SHIP_PR_HEAD_SHA_2 stands in for a push landing
# during the wait. The armed line has to carry the NEW sha, not the sha the
# transition originally pinned — this is the case that actually exercises
# `re_pin_head_sha` rather than its no-op default.
check reviewed-head-moved 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_HEAD_SHA_2=fixture-head-sha-2 <<'EOF'
reviewed: 0 -> 1
offline: auto-merge not armed (would arm on fixture-head-sha-2)
EOF

# Threads unresolved on the first poll, clear on the second — proves the wait
# actually loops rather than reading the first entry and stopping regardless
# of its content.
check reviewed-threads-clear 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_THREADS_FIXTURES="$(tf one-unresolved.json clear.json)" <<'EOF'
reviewed: 0 -> 1
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# Three unreadable thread counts in a row is the same ledger shape as phase 1's
# own three-strikes abort, on its own counter.
check reviewed-threads-three-strikes 2 "$(f quiet reviewed)" \
  SHIP_PR_THREADS_FIXTURES="ERROR=a:ERROR=b:ERROR=c" <<'EOF'
reviewed: 0 -> 1
thread count API ERROR x3 — stopping rather than waiting blind
EOF

# 0 means the very first poll is the last one, the same idiom
# SHIP_PR_CHECKS_TIMEOUT=0 uses in the phase-1 suite above. Terminal and exit 0
# — a PR that needs a reply and a re-arm, not a script failure.
check reviewed-threads-timeout 0 "$(f quiet reviewed)" \
  SHIP_PR_THREAD_WAIT_TIMEOUT=0 SHIP_PR_THREADS_FIXTURES="$(tf one-unresolved.json)" <<'EOF'
reviewed: 0 -> 1
threads still unresolved after 0m — reply and re-arm, or resolve by hand
EOF

# The recheck's own red-check line ends `— not arming`, not phase 1's
# `— not pinging` — the whole point of parameterising the suffix. Three
# required contexts here, so `checks-terminal.json`'s red `Images (api)`
# actually registers against the gate.
check reviewed-checks-recheck-red 0 "$(f quiet reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-three.json checks-terminal.json)" <<'EOF'
reviewed: 0 -> 1
FAIL  Images (api)
checks red: Images (api) — not arming
EOF

# No comments fixture, so the cooldown arithmetic has nothing to read and the
# refusal is reported rather than ridden out.
check rate-limited 0 "$(f rate-limited)" <<'EOF'
refused: rate limited
EOF

check rate-limited-retry 0 "$(f rate-limited clean)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
offline: re-ping suppressed, continuing as if posted
reviewed clean, count unchanged at 0
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# One retry and no more: the second refusal is the owner's call.
check rate-limited-cap 0 "$(f rate-limited rate-limited)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
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
API ERROR x3 (count=0) — stopping rather than waiting blind: c
EOF

# An unreadable ping has no timestamp for either branch to compare against, so
# the run stops instead of letting the two disagree.
check unreadable-ping 1 "$(f clean)" SHIP_PR_PING_AT=not-a-timestamp <<'EOF'
ping timestamp is unreadable — nothing to compare against
EOF

# The rows moved to stderr, not away. Every case above proves they are off
# stdout; this proves they are still printed at all, which nothing else now
# asserts.
combined=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>&1)
ran=$((ran + 1))
if grep -q '^PASS  Verify$' <<<"$combined" \
  && grep -q '^checks green on fixture-head-sha$' <<<"$combined"; then
  printf '  ok    phase-1-ledger-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  phase-1-ledger-on-stderr (the rows are not printed on either stream)\n'
fi

# `SKIPPING` takes the same stderr arm as `PASS` but a different `case` branch,
# so asserting only `PASS` above would let a misrouted or dropped `SKIPPING` row
# through the whole suite.
skipping=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-skipping.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>&1)
ran=$((ran + 1))
if grep -q '^SKIPPING  Verify$' <<<"$skipping"; then
  printf '  ok    skipping-row-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  skipping-row-on-stderr (the SKIPPING row is not printed on either stream)\n'
fi

# `review in progress` moved to stderr along with the phase-1 ledger and the
# rate-limit progress lines. Captured separately, not combined with 2>&1 — the
# two siblings above only prove the line is printed *somewhere*, which a
# regression back onto stdout would still satisfy. This proves the stream.
in_progress_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
  SHIP_PR_FIXTURES="$(f in-progress)" "$script" fixture/repo 1 2>/tmp/ship-pr-in-progress-err.$$)
in_progress_err=$(cat /tmp/ship-pr-in-progress-err.$$)
rm -f /tmp/ship-pr-in-progress-err.$$
ran=$((ran + 1))
if ! grep -q '^review in progress$' <<<"$in_progress_out" \
  && grep -q '^review in progress$' <<<"$in_progress_err"; then
  printf '  ok    in-progress-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  in-progress-on-stderr (expected off stdout and on stderr)\n'
fi

printf '\n%s case(s), %s failure(s)\n' "$ran" "$failures"
[ "$failures" -eq 0 ]
