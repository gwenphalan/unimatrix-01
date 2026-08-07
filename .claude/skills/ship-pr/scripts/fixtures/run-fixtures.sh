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

# wait_for_merge()'s own `gh pr view` payloads, colon-separated like `cf`/`tf`.
mf() {
  local out="" name
  for name in "$@"; do out+="$here/merge-wait/$name:"; done
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

# --- The merge-wait phase ---------------------------------------------------
#
# All four reach the arm via `never-reviewed` + --no-review, which needs
# nothing from the review-wait fixtures above — the shortest path to an armed
# merge_fixtures[@] non-empty return. SHIP_PR_MERGE_FIXTURES is the only new
# variable; the checks_fixtures cursor these consume is the existing one,
# read a second time here the same way the post-review recheck reads it a
# second time in the `reviewed` case above.

# `state: MERGED` is terminal on the poll it appears, printing the merge
# commit's own sha rather than the armed one — the two can differ once
# GitHub squashes.
check merge-wait-merged 0 "$(f never-reviewed)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/merged.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
merged fixture-merge-sha
EOF

# `state: CLOSED` is the other terminal state `gh pr view` can report — closed
# without a merge commit at all.
check merge-wait-closed 0 "$(f never-reviewed)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/closed.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
PR closed without merging — nothing left to watch
EOF

# A required check going red after the arm, on an unmoved head. `three` and
# `checks-green-three.json` bring in all three required contexts so
# `checks-terminal.json`'s red `Images (api)` actually registers against the
# gate — the same reason `reviewed-checks-recheck-red` above uses them. The
# second SHIP_PR_CHECKS_FIXTURES entry is read_checks_payload()'s third
# consumer of the cursor: one for phase 1's own gate, one for this wait's own
# checks read.
check merge-wait-checks-red 0 "$(f never-reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-three.json checks-terminal.json)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/open-same-head.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
required check red after arm: Images (api) — the arm survives; GitHub retries when it goes green on fixture-head-sha
FIXTURES EXHAUSTED
EOF

# The head moving after the arm — a push landing while this wait is polling.
# Disables auto-merge and names the sha to re-arm on, which is the current
# head (`fixture-head-sha-2`), not the one the arm pinned.
#
# Terminal, which is what the absent `FIXTURES EXHAUSTED` asserts: one merge
# fixture is supplied and the run ends on it rather than polling for a second.
# Falling through instead would reach the red-check line, whose "the arm
# survives" wording is only true while the live head still matches the arm.
check merge-wait-head-moved 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/head-moved.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
head changed after arm, from fixture-head-sha to fixture-head-sha-2 — auto-merge disabled; re-arm by hand: gh pr merge 1 --repo fixture/repo --auto --squash --match-head-commit fixture-head-sha-2
EOF

# A base switch with the head sha untouched — invisible to the head comparison,
# and GitHub disables the arm on it. Two merge fixtures: the first baselines the
# base branch, the second switches it.
check merge-wait-base-switched 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$(mf open-same-head.json base-switched.json)" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
base branch changed after arm, from main to release-2 — GitHub disables the arm on a base switch; re-arm by hand: gh pr merge 1 --repo fixture/repo --auto --squash --match-head-commit fixture-head-sha
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
findings: 1 unresolved review thread — reply and fix
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# The plural half of the findings line. Sibling to reviewed-threads-clear
# rather than a replacement for it: that one covers the singular, and the noun
# is the only thing that differs, so a regression would otherwise land on
# whichever count the suite happens not to use.
#
# Two non-zero polls before the clear, not one, so the single findings line
# below is also the assertion that it is said once rather than per poll — the
# only thing holding it to once is an `announced` flag, and a suite that never
# polls twice while unresolved cannot tell that flag from a no-op.
check reviewed-threads-plural 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_THREADS_FIXTURES="$(tf two-unresolved.json two-unresolved.json clear.json)" <<'EOF'
reviewed: 0 -> 1
findings: 2 unresolved review threads — reply and fix
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
findings: 1 unresolved review thread — reply and fix
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

# The startup auto-skip: `already-reviewed`'s baseline is already > 0 before
# the ping would ever post, so this never reaches the ping-and-wait arms above
# at all — it goes straight to post_review_wait(), the same function the
# findings row reaches, checks recheck included. Two SHIP_PR_CHECKS_FIXTURES
# entries: one for phase 1's own gate, one for the recheck inside
# post_review_wait(). Offline, arm_auto_merge() always returns 1 (it only ever
# says what it *would* do), so the `if arm_auto_merge` guard never calls
# wait_for_merge() here — this is as far as an offline run reaches, same as
# the `reviewed` case above.
check already-reviewed-skips-ping 0 "$(f already-reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-three.json checks-green-three.json)" <<'EOF'
offline: auto-merge not armed (would arm on fixture-head-sha)
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
#
# The capture file comes from mktemp, not from `$$`: a PID-derived name in a
# world-writable directory is predictable, so another local process can
# pre-create it as a symlink and have this redirection truncate the target.
in_progress_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-in-progress-err.XXXXXX") || exit 1
in_progress_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
  SHIP_PR_FIXTURES="$(f in-progress)" "$script" fixture/repo 1 2>"$in_progress_err_file")
in_progress_err=$(cat "$in_progress_err_file")
rm -f "$in_progress_err_file"
ran=$((ran + 1))
if ! grep -q '^review in progress$' <<<"$in_progress_out" \
  && grep -q '^review in progress$' <<<"$in_progress_err"; then
  printf '  ok    in-progress-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  in-progress-on-stderr (expected off stdout and on stderr)\n'
fi

# The startup auto-skip's own notice, proven off stdout and on stderr the same
# way in-progress-on-stderr proves its line — not covered by the terminal-line
# case above, which only proves the stdout the notice leads to. mktemp for the
# capture file, for the same reason as in-progress-on-stderr above.
already_reviewed_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-already-reviewed-err.XXXXXX") || exit 1
already_reviewed_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules.json" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-three.json checks-green-three.json)" \
  SHIP_PR_FIXTURES="$(f already-reviewed)" "$script" fixture/repo 1 2>"$already_reviewed_err_file")
already_reviewed_err=$(cat "$already_reviewed_err_file")
rm -f "$already_reviewed_err_file"
ran=$((ran + 1))
if ! grep -q '^already reviewed' <<<"$already_reviewed_out" \
  && grep -q '^already reviewed (count=1) — the ping is not needed$' <<<"$already_reviewed_err"; then
  printf '  ok    already-reviewed-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  already-reviewed-on-stderr (expected off stdout and on stderr)\n'
fi

# --- cleanup-branches.sh -----------------------------------------------
#
# cleanup-branches.sh talks to plain git, not `gh`, so a JSON payload cannot
# stand in for its input the way it does above — the input IS a git history.
# Each case here builds one throwaway repo (a bare "origin" plus a working
# clone, both under a fresh mktemp directory) and runs the script against it.
# Nothing reaches the network: fetching from a local bare repo by filesystem
# path is exactly as offline as reading a fixture file.
#
# One repo carries all five things the plan calls out as the bar this script
# has to clear: a plain ancestor of origin/main, a branch name containing a
# single quote (the xargs trap this script must not reproduce), a genuinely
# squash-merged branch with a `[gone]` upstream that the patch-id probe can
# confirm, and an unrelated `[gone]` branch the probe cannot — which must be
# kept, not deleted, because "the test could not confirm it" is not the same
# claim as "unmerged". `main` and its own history are the fifth case: nothing
# below ever touches it.
cleanup_branches_script="$here/../cleanup-branches.sh"

cleanup_branches_case_wanted() {
  local name=$1
  [ "${#wanted[@]}" -eq 0 ] && return 0
  local entry
  for entry in "${wanted[@]}"; do
    [ "$entry" = "$name" ] && return 0
  done
  return 1
}

if cleanup_branches_case_wanted cleanup-branches-refuses-a-failed-fetch \
  || cleanup_branches_case_wanted cleanup-branches-dry-run-deletes-nothing \
  || cleanup_branches_case_wanted cleanup-branches-sweeps-ancestor-quote-and-squash-keeps-unmerged; then
  cleanup_branches_dir=$(mktemp -d "${TMPDIR:-/tmp}/ship-pr-cleanup-branches.XXXXXX") || exit 1
  cleanup_branches_origin="$cleanup_branches_dir/origin.git"
  cleanup_branches_work="$cleanup_branches_dir/work"

  (
    git init --bare -q "$cleanup_branches_origin"
    git init -q "$cleanup_branches_work"
    cd "$cleanup_branches_work" || exit 1
    git config user.email fixture@example.invalid
    git config user.name fixture
    echo one >f.txt
    git add f.txt
    git commit -q -m init
    git branch -M main
    git remote add origin "$cleanup_branches_origin"
    git push -q -u origin main

    # A plain ancestor: branched off main, main then advances past it.
    git branch merged/ancestor-one
    echo two >>f.txt
    git commit -qam "advance main"
    git push -q origin main

    # Also an ancestor (no divergence at all) — the quote-name case.
    git branch "feat/quote's-branch"

    # A genuine squash merge: diverges on its own branch, main gets a single
    # squash commit, the remote branch is deleted the way deleteBranchOnMerge
    # would have done it server-side.
    git switch -c squash/feature -q
    echo alpha >alpha.txt
    git add alpha.txt
    git commit -qam "add alpha"
    echo beta >beta.txt
    git add beta.txt
    git commit -qam "add beta"
    git push -q -u origin squash/feature
    git switch main -q
    git merge --squash squash/feature -q
    git commit -q -m "feat: squash of feature"
    git push -q origin main
    git push -q origin --delete squash/feature

    # `[gone]` upstream like the squash-merged branch, but its content was
    # never folded into main — the probe must not confirm this one.
    git switch -c wip/never-merged -q
    echo gamma >gamma.txt
    git add gamma.txt
    git commit -qam "add gamma, never merged"
    git push -q -u origin wip/never-merged
    git push -q origin --delete wip/never-merged
    git switch main -q
  ) >/dev/null 2>&1

  # Ordered first, because the two cases below delete. A failed fetch has to
  # stop the sweep rather than fall through to it: `%(upstream:track)` is
  # recorded state, not a live read, so the `push --delete` above already left
  # `squash/feature` and `wip/never-merged` reading `[gone]` and an unreachable
  # remote does not clear that. An offline run is therefore a run against
  # whatever the last successful fetch saw — never the empty selection it looks
  # like. Only a clone that has never pruned selects nothing, which is the first
  # run and no other.
  if cleanup_branches_case_wanted cleanup-branches-refuses-a-failed-fetch; then
    ran=$((ran + 1))
    cleanup_branches_offline_before=$(cd "$cleanup_branches_work" && git branch --format='%(refname:short)' | sort)
    (cd "$cleanup_branches_work" && git remote set-url origin "$cleanup_branches_dir/unreachable.git") >/dev/null 2>&1
    cleanup_branches_offline_out=$(cd "$cleanup_branches_work" && bash "$cleanup_branches_script" 2>&1)
    cleanup_branches_offline_rc=$?
    cleanup_branches_offline_after=$(cd "$cleanup_branches_work" && git branch --format='%(refname:short)' | sort)
    # Restore it, or every case below sweeps against the broken remote too.
    (cd "$cleanup_branches_work" && git remote set-url origin "$cleanup_branches_origin") >/dev/null 2>&1
    if [ "$cleanup_branches_offline_rc" -eq 2 ] \
      && [ "$cleanup_branches_offline_after" = "$cleanup_branches_offline_before" ] \
      && grep -qF "refusing to sweep on a stale view of the remote" <<<"$cleanup_branches_offline_out" \
      && ! grep -qF "Deleted branch" <<<"$cleanup_branches_offline_out"; then
      printf '  ok    cleanup-branches-refuses-a-failed-fetch\n'
    else
      failures=$((failures + 1))
      printf '  FAIL  cleanup-branches-refuses-a-failed-fetch (rc=%s)\n' "$cleanup_branches_offline_rc"
      printf '%s\n' "$cleanup_branches_offline_out" | sed 's/^/        /'
    fi
  fi

  if cleanup_branches_case_wanted cleanup-branches-dry-run-deletes-nothing; then
    ran=$((ran + 1))
    cleanup_branches_dry_out=$(cd "$cleanup_branches_work" && bash "$cleanup_branches_script" --dry-run 2>/dev/null)
    cleanup_branches_dry_branches=$(cd "$cleanup_branches_work" && git branch --format='%(refname:short)' | sort)
    cleanup_branches_dry_expected=$(printf '%s\n' "feat/quote's-branch" main merged/ancestor-one squash/feature wip/never-merged | sort)
    if [ "$cleanup_branches_dry_branches" = "$cleanup_branches_dry_expected" ] \
      && grep -qF "would delete (ancestor of origin/main): feat/quote's-branch" <<<"$cleanup_branches_dry_out" \
      && grep -qF "would delete (ancestor of origin/main): merged/ancestor-one" <<<"$cleanup_branches_dry_out" \
      && grep -qF "would delete (squash-merged into origin/main): squash/feature" <<<"$cleanup_branches_dry_out" \
      && grep -qF "kept (squash probe did not match origin/main — test could not confirm this was merged): wip/never-merged" <<<"$cleanup_branches_dry_out"; then
      printf '  ok    cleanup-branches-dry-run-deletes-nothing\n'
    else
      failures=$((failures + 1))
      printf '  FAIL  cleanup-branches-dry-run-deletes-nothing\n'
      printf '%s\n' "$cleanup_branches_dry_out" | sed 's/^/        /'
    fi
  fi

  if cleanup_branches_case_wanted cleanup-branches-sweeps-ancestor-quote-and-squash-keeps-unmerged; then
    ran=$((ran + 1))
    cleanup_branches_real_out=$(cd "$cleanup_branches_work" && bash "$cleanup_branches_script" 2>/dev/null)
    cleanup_branches_real_branches=$(cd "$cleanup_branches_work" && git branch --format='%(refname:short)' | sort)
    cleanup_branches_real_expected=$(printf '%s\n' main wip/never-merged | sort)
    if [ "$cleanup_branches_real_branches" = "$cleanup_branches_real_expected" ] \
      && grep -qF "Deleted branch feat/quote's-branch" <<<"$cleanup_branches_real_out" \
      && grep -qF "Deleted branch merged/ancestor-one" <<<"$cleanup_branches_real_out" \
      && grep -qF "Deleted branch squash/feature" <<<"$cleanup_branches_real_out" \
      && grep -qF "kept (squash probe did not match origin/main — test could not confirm this was merged): wip/never-merged" <<<"$cleanup_branches_real_out"; then
      printf '  ok    cleanup-branches-sweeps-ancestor-quote-and-squash-keeps-unmerged\n'
    else
      failures=$((failures + 1))
      printf '  FAIL  cleanup-branches-sweeps-ancestor-quote-and-squash-keeps-unmerged\n'
      printf '%s\n' "$cleanup_branches_real_out" | sed 's/^/        /'
    fi
  fi

  rm -rf "$cleanup_branches_dir"
fi

printf '\n%s case(s), %s failure(s)\n' "$ran" "$failures"
[ "$failures" -eq 0 ]
