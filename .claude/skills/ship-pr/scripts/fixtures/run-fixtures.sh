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
# unchanged — invisibly now, since the whole phase-1 ledger moved to stderr and
# stdout is dropped here (see below).
#
# The ping timestamp is the reason this exists rather than a README of
# invocations. `SHIP_PR_PING_AT` defaults to the epoch, which sits before every
# fixture timestamp — so a run that does not set it has the ping comparison
# switched off in both branches at once: every comment passes the `since` filter
# and every commit status reads as newer than the ping. The skip fixtures then
# pass while proving the opposite of their names. `skipped-resting` in
# particular is the regression test for the whole commit-status redesign, and
# under the default it reported the ping as swallowed.
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
# phase-1 ledger (every bucket row and the `all <n> required checks green on
# <sha>` boundary), and now
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
  actual=$(sed -E 's/(asking again at )[^.]*\./\1<time>./' <<<"$actual")
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

# Every required context has reported and one of them is red, so the run ends on
# the poll that completes the ledger — one row carrying the whole tally, and
# phase 2 never runs. The `FAIL` row itself is on stderr; `fail-row-on-stderr`
# below is what proves it is still printed.
check checks-red 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" <<'EOF'
PR #1: checks failed — 1 red, 2 green. Red: Images (api). Nothing was reviewed and nothing will merge.
EOF

# A red alongside a context that has not finished is NOT terminal: the grace
# window is open, so the run says nothing and polls again. Asserted by the
# absence of any row and the presence of `FIXTURES EXHAUSTED` — the run asked
# for a second payload.
check checks-red-pending 0 "$(f quiet)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-red-pending.json)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# The same payload with the window shut. 0 makes the poll the first red appears
# the last one, the same idiom SHIP_PR_CHECKS_TIMEOUT=0 uses below. The row names
# what never reported, so a partial tally cannot read as a complete one.
check checks-red-grace-expiry 0 "$(f quiet)" "$three" SHIP_PR_CHECKS_RED_GRACE=0 \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-red-pending.json)" <<'EOF'
PR #1: checks failed — 1 red, 1 green, 1 never reported after 0m. Red: Verify. Never reported: Images (api). Nothing was reviewed and nothing will merge.
EOF

# A non-numeric grace is rejected at startup, for the same reason the two
# timeouts are: left to the comparison it evaluates false on every poll, so the
# window never closes and the bound it exists to provide is silently gone.
check checks-red-grace-non-numeric 1 "$(f quiet)" "$three" SHIP_PR_CHECKS_RED_GRACE=soon \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-red-pending.json)" <<'EOF'
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
PR #1: GitHub's checks API failed 3 times in a row — stopping rather than gating blind. Last error: c
EOF

# A required context that never appears ends the run naming it, rather than
# polling forever behind a heartbeat.
check checks-timeout 0 "$(f quiet)" "$three" SHIP_PR_CHECKS_TIMEOUT=0 \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-all-pending.json)" <<'EOF'
PR #1: checks never finished — 0m waited. Never reported: Verify, Images (api), CodeQL. Nothing was reviewed and nothing will merge.
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
PR #1: GitHub lists no required checks for this branch — stopping rather than reading an empty list as green.
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
PR #1: no review and no auto-merge — nothing to do here; merge it by hand.
EOF

# Skipping the review does not skip the gate: the flag is read long after phase
# 1 is over. The expectation is the `checks-red` case's, typed out again rather
# than derived from it — so the two are equal by two copies, not by construction.
check no-review-checks-red 0 "$(f never-reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-terminal.json)" -- --no-review <<'EOF'
PR #1: checks failed — 1 red, 2 green. Red: Images (api). Nothing was reviewed and nothing will merge.
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
PR #1: merged — fixture-merge-sha
EOF

# `state: CLOSED` is the other terminal state `gh pr view` can report — closed
# without a merge commit at all.
check merge-wait-closed 0 "$(f never-reviewed)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/closed.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
PR #1: closed without merging — nothing left to watch.
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
PR #1: Images (api) went red after the merge was armed. Nothing to do — GitHub retries on its own when it goes green again on fixture-head-sha.
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
PR #1: a push landed after the merge was armed. The merge is off again so nothing unreviewed lands. Re-arm on the new head when ready: gh pr merge 1 --repo fixture/repo --auto --squash --match-head-commit fixture-head-sha-2
EOF

# A base switch with the head sha untouched — invisible to the head comparison,
# and GitHub disables the arm on it. Two merge fixtures: the first baselines the
# base branch, the second switches it.
check merge-wait-base-switched 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$(mf open-same-head.json base-switched.json)" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
PR #1: the base branch changed from main to release-2, which turns the merge off. Re-arm when ready: gh pr merge 1 --repo fixture/repo --auto --squash --match-head-commit fixture-head-sha
EOF

# A merge to the base after the arm. The head sha, the base name and the checks
# are all still exactly what was armed, so every other detection above is blind
# to it and the arm can never fire — the regression this pins is the loop
# polling in silence until the timeout, which is what PR #242 actually did for
# about four hours.
check merge-wait-behind 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/behind.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
PR #1: the branch fell behind main, so the armed merge can never fire. Update it, then re-arm: gh pr update-branch 1 --repo fixture/repo, then gh pr merge 1 --repo fixture/repo --auto --squash --match-head-commit $(gh pr view 1 --repo fixture/repo --json headRefOid --jq .headRefOid)
EOF

# The same shape for a conflicted branch, which also cannot merge without the
# head moving.
check merge-wait-dirty 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/dirty.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
PR #1: the branch has conflicts, so the armed merge can never fire. Resolve them and start the watch again.
EOF

# `BLOCKED` must NOT be terminal — it is the ordinary state of an armed PR whose
# required checks have not all reported yet, so treating it like BEHIND would end
# almost every real run on its first poll. Asserted by the absence of any merge
# line and the presence of `FIXTURES EXHAUSTED`: the loop polled past it and
# asked for a second fixture.
check merge-wait-blocked-not-terminal 0 "$(f never-reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json checks-green-one.json)" \
  SHIP_PR_MERGE_FIXTURES="$here/merge-wait/blocked.json" -- --no-review <<'EOF'
offline: auto-merge armed UNREVIEWED (would arm on fixture-head-sha) — merge-wait fixtures follow
FIXTURES EXHAUSTED
EOF

# --- Phase 2: the review wait ----------------------------------------------

check clean 0 "$(f clean)" <<'EOF'
PR #1: CodeRabbit reviewed it and found nothing. Merging once the checks pass.
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# The off switch outranks a genuinely clean review, and arm_auto_merge()'s
# return code is what wait_for_merge() gates on — a non-zero return here must
# not enter that wait.
check clean-auto-merge-off 0 "$(f clean)" SHIP_PR_AUTO_MERGE=0 <<'EOF'
PR #1: CodeRabbit reviewed it and found nothing. Merging once the checks pass.
offline: auto-merge not armed (auto-merge is off)
EOF

check head-changed 0 "$(f head-changed)" <<'EOF'
PR #1: a push landed mid-review and CodeRabbit stopped. It read fixture-head-sha and nothing since.
EOF

check in-progress 0 "$(f in-progress)" <<'EOF'
FIXTURES EXHAUSTED
EOF

check merged 0 "$(f merged)" <<'EOF'
PR #1: already merged — CodeRabbit will not review it now or ever.
EOF

check no-changes 0 "$(f no-changes)" <<'EOF'
PR #1: nothing in this diff is reviewable — that is the review, not a failure.
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
PR #1: CodeRabbit reviewed it and found something.
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# Same shape as `reviewed`, but SHIP_PR_HEAD_SHA_2 stands in for a push landing
# during the wait. The armed line has to carry the NEW sha, not the sha the
# transition originally pinned — this is the case that actually exercises
# `re_pin_head_sha` rather than its no-op default.
check reviewed-head-moved 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_HEAD_SHA_2=fixture-head-sha-2 <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
offline: auto-merge not armed (would arm on fixture-head-sha-2)
EOF

# Threads unresolved on the first poll, clear on the second — proves the wait
# actually loops rather than reading the first entry and stopping regardless
# of its content.
check reviewed-threads-clear 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_THREADS_FIXTURES="$(tf one-unresolved.json clear.json)" <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
PR #1: CodeRabbit raised 1 review thread.
PR #1: apps/api/src/app.ts:42
**Guard the empty list.**

`required` can be empty here, and an empty gate reads as green.
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
PR #1: CodeRabbit reviewed it and found something.
PR #1: CodeRabbit raised 2 review threads.
PR #1: apps/api/src/app.ts:42
**Guard the empty list.**

`required` can be empty here, and an empty gate reads as green.
PR #1: apps/api/src/config.ts:17
**Fail closed on an unreadable state.**

An unreadable draft flag currently arms the merge.
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# A real CodeRabbit finding, taken off PR #284 unedited: a metadata line, a bold
# headline, two paragraphs of prose, and then a `🧩 Analysis chain` block, a
# `📝 Committable suggestion` block with its ‼️ IMPORTANT boilerplate, a
# `🤖 Prompt for AI Agents` block and four HTML comments.
#
# The expectation below is byte-for-byte, so it is also the absence assertion:
# any collapsed block or HTML comment surviving the stripper fails this case. The
# thread's `line` is null and `originalLine` is 95, which is what puts a location
# on a finding whose hunk has moved — the common case, 3 of 5 measured.
check reviewed-threads-noise 0 "$(f quiet reviewed)" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-one.json checks-green-one.json)" \
  SHIP_PR_THREADS_FIXTURES="$(tf one-unresolved-with-noise.json clear.json)" <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
PR #1: CodeRabbit raised 1 review thread.
PR #1: apps/deploy/src/secret-env/status.ts:95
_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_

**Classify only a 404 response as unresolved.**

`SecretsClientError` represents every non-success HTTP response. A 401, 403, 429, or 500 has a non-null status and currently becomes `unresolved`. The CLI then returns exit code 3 for a refused or failed store call.

Treat only status 404 as `unresolved`. Keep other statuses as `error` so the CLI returns exit code 4.

✅ Confirmed as addressed by @gwenphalan
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# Three unreadable thread counts in a row is the same ledger shape as phase 1's
# own three-strikes abort, on its own counter.
check reviewed-threads-three-strikes 2 "$(f quiet reviewed)" \
  SHIP_PR_THREADS_FIXTURES="ERROR=a:ERROR=b:ERROR=c" <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
PR #1: the review-thread count failed 3 times in a row — stopping rather than waiting blind.
EOF

# 0 means the very first poll is the last one, the same idiom
# SHIP_PR_CHECKS_TIMEOUT=0 uses in the phase-1 suite above. Terminal and exit 0
# — a PR that needs a reply and a re-arm, not a script failure.
check reviewed-threads-timeout 0 "$(f quiet reviewed)" \
  SHIP_PR_THREAD_WAIT_TIMEOUT=0 SHIP_PR_THREADS_FIXTURES="$(tf one-unresolved.json)" <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
PR #1: CodeRabbit raised 1 review thread.
PR #1: apps/api/src/app.ts:42
**Guard the empty list.**

`required` can be empty here, and an empty gate reads as green.
PR #1: 1 review thread still open after 0m. Answer them and start the watch again, or resolve them on GitHub.
EOF

# The recheck's own red-check line ends `— not arming`, not phase 1's
# `— not pinging` — the whole point of parameterising the suffix. Three
# required contexts here, so `checks-terminal.json`'s red `Images (api)`
# actually registers against the gate.
check reviewed-checks-recheck-red 0 "$(f quiet reviewed)" "$three" \
  SHIP_PR_CHECKS_FIXTURES="$(cf checks-green-three.json checks-terminal.json)" <<'EOF'
PR #1: CodeRabbit reviewed it and found something.
PR #1: checks failed — 1 red, 2 green. Red: Images (api). Nothing is armed to merge.
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
PR #1: CodeRabbit is rate limited and did not review. Use another reviewer.
EOF

check rate-limited-retry 0 "$(f rate-limited clean)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PR #1: CodeRabbit is rate limited — waiting 0m, asking again at <time>.
offline: re-ping suppressed, continuing as if posted
PR #1: CodeRabbit reviewed it and found nothing. Merging once the checks pass.
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# One retry and no more: the second refusal is the owner's call.
check rate-limited-cap 0 "$(f rate-limited rate-limited)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PR #1: CodeRabbit is rate limited — waiting 0m, asking again at <time>.
offline: re-ping suppressed, continuing as if posted
PR #1: CodeRabbit refused twice — the window is longer than it advertised. Use another reviewer.
EOF

# CodeRabbit's newer wording, matched on its own with no commit status to
# help — proves the widened body-loop arm catches "Review rate limited." the
# same way it already caught "rate limited by coderabbit.ai".
check rate-limited-new-wording 0 "$(f rate-limited-new)" <<'EOF'
PR #1: CodeRabbit is rate limited and did not review. Use another reviewer.
EOF

# An empty comment list, so only the commit status can be responsible for
# this outcome — proves the "Review rate limited" status arm acts on its own,
# not merely alongside a comment the body loop would have caught anyway.
check rate-limited-status 0 "$(f rate-limited-status)" <<'EOF'
PR #1: CodeRabbit is rate limited and did not review. Use another reviewer.
EOF

# The status twin of skipped-resting: the same description, stamped BEFORE
# the ping, is a refusal this run never earned rather than one to ride out.
check rate-limited-status-resting 0 "$(f rate-limited-status-resting)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# What CodeRabbit actually posted on PR #236: a "Review rate limited" commit
# status alongside BOTH comment wordings, all in the same poll. Without
# `rate_limited_by_status` gating the body loop, the status arm and a comment
# arm would each count this refusal once — two increments for one refusal,
# tripping the one-retry cap on the very first poll instead of riding it out.
# The expected shape is identical to `rate-limited-retry`'s: reaching the
# second poll's clean review is only possible if the first poll absorbed
# exactly one refusal.
check rate-limited-realistic 0 "$(f rate-limited-realistic clean)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited-realistic/comments.json" <<'EOF'
PR #1: CodeRabbit is rate limited — waiting 0m, asking again at <time>.
offline: re-ping suppressed, continuing as if posted
PR #1: CodeRabbit reviewed it and found nothing. Merging once the checks pass.
offline: auto-merge not armed (would arm on fixture-head-sha)
EOF

# The regression this pins: the status arm absorbing a refusal must not skip
# the body loop outright, or a co-present outcome comment in the same poll —
# here "did not have any reviewable changes" — goes unread. Gating only the
# rate-limit arm inside the loop reads it after `rate_limited_by_status` is
# already set; gating the whole loop the way the code used to would instead
# print `FIXTURES EXHAUSTED`, having advanced `since` past a comment nothing
# reads a second time.
check rate-limited-status-and-no-changes 0 "$(f rate-limited-status-and-no-changes)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PR #1: CodeRabbit is rate limited — waiting 0m, asking again at <time>.
offline: re-ping suppressed, continuing as if posted
PR #1: nothing in this diff is reviewable — that is the review, not a failure.
EOF

# The cap message names the quota when the refusal that tripped it carries the
# Fair Usage wording, because that refusal is not the plain cooldown the rest
# of this function's lines describe — riding out a longer wait would not have
# changed the outcome.
check rate-limited-cap-quota 0 "$(f rate-limited rate-limited-quota)" \
  SHIP_PR_COMMENTS_FIXTURE="$here/wait/rate-limited/comments.json" <<'EOF'
PR #1: CodeRabbit is rate limited — waiting 0m, asking again at <time>.
offline: re-ping suppressed, continuing as if posted
PR #1: CodeRabbit refused twice — the included review budget is spent, not a short wait. Use another reviewer.
EOF

# No commit status at all — the comment fallback reads the skip notice, and
# everything in `bodies` is already newer than the ping.
check skipped 0 "$(f skipped)" <<'EOF'
PR #1: CodeRabbit never picked up the review request. Nothing was spent — ask again.
EOF

# The pair. Same "Review skipped" description, opposite sides of the ping.
check skipped-after-ping 0 "$(f skipped-after-ping)" <<'EOF'
PR #1: CodeRabbit never picked up the review request. Nothing was spent — ask again.
EOF

check skipped-resting 0 "$(f skipped-resting)" <<'EOF'
FIXTURES EXHAUSTED
EOF

# A failed first call is a missing baseline, and waiting blind is worse than
# stopping.
check no-baseline 1 "ERROR=boom" <<'EOF'
EOF

check three-strikes 2 "$(f quiet),ERROR=a,ERROR=b,ERROR=c" <<'EOF'
PR #1: GitHub's comment API failed 3 times in a row — stopping rather than waiting blind. Last error: c
EOF

# An unreadable ping has no timestamp for either branch to compare against, so
# the run stops instead of letting the two disagree.
check unreadable-ping 1 "$(f clean)" SHIP_PR_PING_AT=not-a-timestamp <<'EOF'
PR #1: GitHub returned no usable timestamp for the review request — stopping rather than guessing.
EOF

# The rows moved to stderr, not away. Every case above proves they are off
# stdout; this proves they are still printed at all, which nothing else now
# asserts.
#
# Captured into two files and joined afterwards rather than with `2>&1`: the
# script refuses to run with its streams pointing at one destination, so a
# merged capture here would assert nothing but the refusal. This still only
# proves the rows are printed *somewhere* — `in-progress-on-stderr` below is
# what proves which stream.
ledger_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-ledger-err.XXXXXX") || exit 1
combined=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>"$ledger_err_file")
combined=$(printf '%s\n%s\n' "$combined" "$(cat "$ledger_err_file")")
rm -f "$ledger_err_file"
ran=$((ran + 1))
if grep -q '^PASS  Verify$' <<<"$combined" \
  && grep -q '^all 1 required checks green on fixture-head-sha$' <<<"$combined"; then
  printf '  ok    phase-1-ledger-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  phase-1-ledger-on-stderr (the rows are not printed on either stream)\n'
fi

# `SKIPPING` takes the same stderr arm as `PASS` but a different `case` branch,
# so asserting only `PASS` above would let a misrouted or dropped `SKIPPING` row
# through the whole suite.
skipping_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-skipping-err.XXXXXX") || exit 1
skipping=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-skipping.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>"$skipping_err_file")
skipping=$(printf '%s\n%s\n' "$skipping" "$(cat "$skipping_err_file")")
rm -f "$skipping_err_file"
ran=$((ran + 1))
if grep -q '^SKIPPING  Verify$' <<<"$skipping"; then
  printf '  ok    skipping-row-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  skipping-row-on-stderr (the SKIPPING row is not printed on either stream)\n'
fi

# FAIL and CANCEL moved to stderr along with PASS and SKIPPING, and unlike those
# two they lost their only other proof at the same time: three `check()` cases
# used to assert a `FAIL` row on stdout byte-for-byte, and they now assert the
# summary row instead. Without these two, a FAIL or CANCEL row that stopped
# being emitted at all would fail nothing anywhere.
#
# Both assert the stream rather than only the printing — off stdout and on
# stderr — the way in-progress-on-stderr does, since `check()` above proves the
# stdout half for FAIL but nothing covers CANCEL at all.
fail_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-fail-err.XXXXXX") || exit 1
fail_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-terminal.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>"$fail_err_file")
fail_err=$(cat "$fail_err_file")
rm -f "$fail_err_file"
ran=$((ran + 1))
if ! grep -q '^FAIL  Images (api)$' <<<"$fail_out" \
  && grep -q '^FAIL  Images (api)$' <<<"$fail_err"; then
  printf '  ok    fail-row-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  fail-row-on-stderr (expected off stdout and on stderr)\n'
fi

# `CANCEL` is the bucket a push mid-run leaves behind, since ci.yml sets
# cancel-in-progress — the one red this repo produces without anything being
# broken, and the one no other case here exercises.
cancel_err_file=$(mktemp "${TMPDIR:-/tmp}/ship-pr-cancel-err.XXXXXX") || exit 1
cancel_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-cancelled.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>"$cancel_err_file")
cancel_err=$(cat "$cancel_err_file")
rm -f "$cancel_err_file"
ran=$((ran + 1))
if ! grep -q '^CANCEL  Verify$' <<<"$cancel_out" \
  && grep -q '^CANCEL  Verify$' <<<"$cancel_err" \
  && grep -qF 'PR #1: checks failed — 1 red, 0 green. Red: Verify.' <<<"$cancel_out"; then
  printf '  ok    cancel-row-on-stderr\n'
else
  failures=$((failures + 1))
  printf '  FAIL  cancel-row-on-stderr (expected off stdout, on stderr, and a summary row counting it red)\n'
fi

# The refusal itself, with genuinely merged streams — the one case that must not
# use the two-file capture above. `$(...)` makes stdout a pipe and `2>&1` puts
# stderr on the same one, which is exactly the shape an agent produces by arming
# this under `Monitor` with a redirect it did not need.
#
# The fixture variables are set so that a placement regression stays offline:
# with the guard moved below them, this run reaches the fixtures instead of the
# network and fails as an ordinary assertion — exit 0 and no refusal — rather
# than hanging against the live API.
merged_out=$(env SHIP_PR_POLL_SECONDS=0 SHIP_PR_PING_AT="$ping" \
  SHIP_PR_BRANCH_RULES_FIXTURE="$here/branch-rules-one.json" \
  SHIP_PR_CHECKS_FIXTURES="$here/checks-green-one.json" \
  SHIP_PR_FIXTURES="$(f quiet)" "$script" fixture/repo 1 2>&1)
merged_rc=$?
ran=$((ran + 1))
if [ "$merged_rc" = 1 ] \
  && grep -q '^watch-pr.sh: stdout and stderr are the same destination.$' <<<"$merged_out" \
  && grep -qF "watch-pr.sh fixture/repo 1" <<<"$merged_out"; then
  printf '  ok    merged-streams-refused\n'
else
  failures=$((failures + 1))
  printf '  FAIL  merged-streams-refused (exit %s, wanted 1 and the refusal naming the fixed command)\n' "$merged_rc"
  printf '%s\n' "$merged_out" | sed 's/^/        /'
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

# --- coderabbit-deadline.sh -------------------------------------------
#
# Called directly rather than through `check()` and watch-pr.sh: the script
# already reads SHIP_PR_COMMENTS_FIXTURE itself, and going through watch-pr.sh
# adds the real wall clock (cooldown_remaining subtracts `date -u +%s` from
# every fixture's fixed 2026 timestamp) for no coverage in return — every
# fixture reads as long-elapsed regardless of which marker the tie-break
# picks. Reading the deadline line straight off the script is what actually
# pins the tie-break, not just the arithmetic downstream of it.
#
# Confirmed to matter: reverting coderabbit-deadline.sh to its pre-PR content
# in a scratch copy turns both cases below red — the new-wording case because
# the old `select` never matched "Review rate limited." at all, and the
# stale-older-marker case because the old code had no tie-break to bound.
deadline_script="$here/../coderabbit-deadline.sh"

deadline_case_wanted() {
  local name=$1
  [ "${#wanted[@]}" -eq 0 ] && return 0
  local entry
  for entry in "${wanted[@]}"; do
    [ "$entry" = "$name" ] && return 0
  done
  return 1
}

deadline_check() {
  local name=$1 fixture=$2 expected=$3 actual
  deadline_case_wanted "$name" || return 0
  ran=$((ran + 1))
  actual=$(SHIP_PR_COMMENTS_FIXTURE="$fixture" bash "$deadline_script" fixture/repo 1 2>&1)
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %s\n' "$name"
  else
    failures=$((failures + 1))
    printf '  FAIL  %s\n' "$name"
    diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | sed 's/^/        /'
  fi
}

# A rate-limit comment in CodeRabbit's newer wording only — no comment
# anywhere in the fixture carries the older "rate limited by coderabbit.ai"
# phrase the pre-PR `select` matched on.
deadline_check coderabbit-deadline-new-wording-only \
  "$here/wait/rate-limited-new/comments.json" \
  "updated=2026-07-31T18:04:11Z countdown=8 seconds"

# The regression this file exists to close: an older marker at 18:00:00Z with
# a readable countdown, a newer marker an hour later with none. The tie-break
# must not treat the hour-old marker as this refusal's own — it reports the
# newest marker's countdown=unknown instead of a deadline already an hour in
# the past.
deadline_check coderabbit-deadline-stale-older-marker-falls-back \
  "$here/comments-stale-older-marker.json" \
  "updated=2026-07-31T19:00:00Z countdown=unknown"

# The case the tie-break exists for: the newest marker (2 seconds later) has
# no readable countdown, and the older sibling does. Proves the 60s window
# still resolves the pair the tie-break was built for, not just the hour-apart
# pair above that it now refuses.
deadline_check coderabbit-deadline-near-tie-break-still-resolves \
  "$here/comments-near-tie-break.json" \
  "updated=2026-07-31T18:14:19Z countdown=6 seconds"

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
