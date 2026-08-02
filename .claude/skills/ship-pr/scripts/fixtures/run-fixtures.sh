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
# unchanged — which is why each of their expectations opens with `PASS  Verify`
# and the transition line.
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
# stderr is dropped: it carries the heartbeats and the offline notices, which say
# nothing about which arm was taken. Wall-clock times in the output are
# normalised, since a cooldown line renders the reader's own clock.
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
      flags+=("$arg")
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

# The three-context gate, matching the names the checks-*.json payloads carry.
three=SHIP_PR_BRANCH_RULES_FIXTURE=$here/branch-rules.json

printf 'watch-pr fixtures\n\n'

# --- Phase 1: the required-context gate ------------------------------------

# The regression test for the hazard merging the two scripts creates. Everything
# in this payload is terminal and green and none of it is required, so the old
# "nothing is pending" exit condition would have read it as green and pinged.
check checks-non-required-only 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-non-required-only.json checks-green-three.json)" <<'EOF'
PASS  CodeRabbit  — Review skipped: automatic reviews are disabled
PASS  Socket Security: Project Report
PASS  Socket Security: Pull Request Alerts
PASS  CodeQL
PASS  Images (api)
PASS  Verify
checks green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

# A red required context is terminal on the poll it appears, and phase 2 never
# runs — no ping, no outcome line.
check checks-red 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" <<'EOF'
FAIL  Images (api)
PASS  Verify
SKIPPING  CodeQL
checks red: Images (api) — not pinging
EOF

# Results print as they land, once each, and then the gate closes.
check checks-pending-to-green 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-all-pending.json checks-pending.json checks-green-three.json)" <<'EOF'
PASS  Verify
PASS  CodeQL
PASS  Images (api)
checks green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

check checks-skipping 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-skipping.json)" <<'EOF'
SKIPPING  CodeQL
SKIPPING  Images (api)
SKIPPING  Verify
checks green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

# `gh pr checks` exits 1 with this on stderr when the head commit carries no
# check at all — the state for the first minutes after a PR opens. Three in a row
# must not reach the three-strikes exit; without the normalisation this case ends
# at exit 2 having never pinged.
check checks-empty-list 0 "$(f quiet)" \
  SHIP_PR_CHECKS_FIXTURES="ERROR=no checks reported on the 'feat/x' branch:ERROR=no checks reported on the 'feat/x' branch:ERROR=no checks reported on the 'feat/x' branch:$here/checks-green-one.json" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
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

# --- --no-review: phase 1, then straight to the arm -------------------------

# The `quiet` fixture is a full phase-2 list, and its entries are what makes this
# case say anything: consumed, they end the run with `FIXTURES EXHAUSTED`. That
# line's absence is the proof phase 2 never ran — the ping itself is announced on
# stderr offline, so a stray one would not show up here.
check no-review-arms 0 "$(f quiet)" -- --no-review <<'EOF'
PASS  Verify
checks green on fixture-head-sha
offline: auto-merge not armed
EOF

# The off switch outranks the flag, and says so rather than leaving the run's
# only output as `checks green` — which reads as a script that died.
check no-review-auto-merge-off 0 "$(f quiet)" SHIP_PR_AUTO_MERGE=0 -- --no-review <<'EOF'
PASS  Verify
checks green on fixture-head-sha
no review requested, and auto-merge is off — nothing armed
EOF

# Skipping the review does not skip the gate. Byte-for-byte the `checks-red`
# case above, flag and all — the flag is read after phase 1 is already over.
check no-review-checks-red 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" -- --no-review <<'EOF'
FAIL  Images (api)
PASS  Verify
SKIPPING  CodeQL
checks red: Images (api) — not pinging
EOF

# --- Phase 2: the review wait ----------------------------------------------

check clean 0 "$(f clean)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
reviewed clean, count unchanged at 1
offline: auto-merge not armed
EOF

check head-changed 0 "$(f head-changed)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
refused: head commit changed mid-review, reviewed head was fixture-head-sha
EOF

check in-progress 0 "$(f in-progress)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
review in progress
FIXTURES EXHAUSTED
EOF

check merged 0 "$(f merged)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
refused: merged, CodeRabbit is done for good
EOF

check no-changes 0 "$(f no-changes)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
nothing reviewable — that IS the review
EOF

check quiet 0 "$(f quiet)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

# The baseline comes from the first entry, so the count only rises across two.
check reviewed 0 "$(f quiet reviewed)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
reviewed: 1 -> 2
EOF

# No comments fixture, so the cooldown arithmetic has nothing to read and the
# refusal is reported rather than ridden out.
check rate-limited 0 "$(f rate-limited)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
refused: rate limited
EOF

check rate-limited-retry 0 "$(f rate-limited clean)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
stale rate-limit marker at arm time, deadline lapsed — pinging anyway
cooling down 0m, re-pinging at <time>
offline: re-ping suppressed, continuing as if posted
reviewed clean, count unchanged at 1
offline: auto-merge not armed
EOF

# One retry and no more: the second refusal is the owner's call.
check rate-limited-cap 0 "$(f rate-limited rate-limited)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
stale rate-limit marker at arm time, deadline lapsed — pinging anyway
cooling down 0m, re-pinging at <time>
offline: re-ping suppressed, continuing as if posted
refused: rate limited again after one re-ping
EOF

# No commit status at all — the comment fallback reads the skip notice, and
# everything in `bodies` is already newer than the ping.
check skipped 0 "$(f skipped)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
refused: skipped — ping did not register
EOF

# The pair. Same "Review skipped" description, opposite sides of the ping.
check skipped-after-ping 0 "$(f skipped-after-ping)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
refused: skipped — ping did not register
EOF

check skipped-resting 0 "$(f skipped-resting)" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

# A failed first call is a missing baseline, and waiting blind is worse than
# stopping.
check no-baseline 1 "ERROR=boom" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
EOF

check three-strikes 2 "$(f quiet),ERROR=a,ERROR=b,ERROR=c" <<'EOF'
PASS  Verify
checks green on fixture-head-sha
API ERROR x3 (count=1) — stopping rather than waiting blind: c
EOF

# An unreadable ping has no timestamp for either branch to compare against, so
# the run stops instead of letting the two disagree.
check unreadable-ping 1 "$(f clean)" SHIP_PR_PING_AT=not-a-timestamp <<'EOF'
PASS  Verify
checks green on fixture-head-sha
ping timestamp is unreadable — nothing to compare against
EOF

printf '\n%s case(s), %s failure(s)\n' "$ran" "$failures"
[ "$failures" -eq 0 ]
