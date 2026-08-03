#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
watch-pr.sh [--no-review] <owner/repo> <pr>

Watches a pull request from "CI is still running" to "merged", in two
sequential phases and the wait that follows a successful arm, all in one
process. Arm it under `Monitor` and carry on working.

  Phase 1  every required status check reports, and every one is green
  Phase 2  CodeRabbit is pinged and the review is waited out. A clean review
           arms GitHub's auto-merge directly. A review with findings does not
           exit — it stays up through the reply-and-fix cycle: every review
           thread has to clear, the required checks have to go green again on
           whatever head that produced, and only then does it arm

Arming is not merging. GitHub still has to run every required check on its
own clock before it squashes, so the script keeps running past a successful
arm — see "After the arm" below.

`--no-review` skips the ping and the review wait, but not the wait that
follows one: it still waits for every review thread to clear before arming, on
the theory that a PR resumed with `--no-review` may carry threads from an
earlier review this run never posted. What it actually removes is the ping and
the checks re-wait that only a fix commit would justify — see "the review
budget is one, this flag is not a second one" below. BEHIND, DIRTY and a draft
are still terminal in the transition, and the arm still declines on a draft, on
unresolved review threads and on a PR state it could not read. A red required
check and a phase-1 timeout end the run exactly as they do without it, since
both are terminal before the flag is ever consulted. SHIP_PR_AUTO_MERGE=0 still
wins: with both set, nothing is armed and the run says so.

An unreviewed arm prints a different line, and that is deliberate — but which
line depends on whether this PR actually carries a review, not on whether this
flag was passed. `--no-review` on a PR CodeRabbit has already reviewed prints
the ordinary armed line; only a PR with no review in its history at all gets
the UNREVIEWED one. CodeRabbit refuses a merged PR outright, so an unreviewed
merge is unreviewed permanently rather than pending — an outcome worth reading
as loudly as it deserves, and exactly as loudly whether or not it deserves it.

The ordering is the reason these are one script rather than two. A ping fired
while CI is still running spends a slot on code a red check is about to change,
and a spent slot is not recoverable for minutes to hours. Split across two
scripts that rule lived in prose and a reader had to honour it between them;
here it is a property of the code.

=== Phase 1 — the required checks ===

The gate is every context `required-checks.sh` names for the PR's base branch,
and nothing else. "No fail bucket anywhere" is the weaker test and it fails in
both directions. `gh pr checks` reports only what exists on the head commit, so
a fast third-party app answering before any workflow has been queued makes a
list of one look complete — and a red *non*-required check would hold back a
ping that should go out. An empty required list is a failure rather than a
vacuous pass, and so is a required-list read that did not come back.

`CodeRabbit` is deliberately not read here. It is `pass` on every PR, so it is
the signal phase 2 exists to discriminate, not an input to the gate.

Buckets map: green = {pass, skipping}, red = {fail, cancel}, pending = keep
polling — and anything else = keep polling too. A bucket vocabulary that grew a
member must stall rather than silently satisfy the gate. gh 2.97.0 documents the
set as exactly `pass, fail, pending, skipping, cancel`, so the enumeration is
complete rather than guessed; `skipping` on a *required* context is unreachable
in this repo, since no required job carries a job-level `if:`, so that arm is
precaution rather than a path anything takes.

A red required context is terminal on the poll it appears, without waiting for
the rest to report. Nothing that arrives later un-reds it.

Every terminal bucket is printed as it lands — PASS, FAIL and SKIPPING alike,
required or not. A filter that matched only success would be silent through a
failure, and silence is indistinguishable from still-running. FAIL and CANCEL
go to stdout; PASS and SKIPPING go to stderr, which still reaches the terminal
and the Monitor output file — the same split the heartbeat below already
uses. Under Monitor every stdout line is a notification, so this keeps a
clean PR's dozen passing checks from waking the caller a dozen times to be
told nothing.

`gh pr checks <pr> --watch` is the wrong tool for this: it reports once, after
everything has reported, so a `Verify` failure two minutes in stays invisible
until the slowest job finishes ten minutes later and you sit on a fixable red
the whole time.

A check's description is appended when it has one, because a green bucket does
not always mean the check did its job. `CodeRabbit` is `pass` either way, and
only its description separates "Review skipped: automatic reviews are disabled"
— this repo's resting state, since auto-review is off — from "Review completed".
Read as a bucket alone it is the line that waves an unreviewed merge through.
Every other check here has an empty description, so this annotates only the ones
carrying information. Expect that line to read "skipped" throughout phase 1 and
do not wait for it to change: the review has not been asked for yet.

Two `gh` statuses are not failures, and treating either as one kills the run
before the ping. Status 8 comes back alongside usable JSON whenever something is
still pending — the ordinary state of a PR mid-CI. And an empty checks list is
an *error*: status 1 with `no checks reported on the '<branch>' branch` on
stderr, which is every PR for the first minutes after it opens, exactly when
this is armed. Both are normalised to "nothing to report yet, keep polling".

Phase 1 is capped, and phase 2's deliberate lack of a cap does not transfer to
it: phase 2 waits on a ping it posted, while phase 1 waits on contexts that may
never be created at all. `CodeQL` here is a commit status posted by an app with
no workflow of its own, so a SARIF upload that never lands is a required context
that never appears. The cap ends the run naming the contexts that never
reported, rather than hanging.

=== The transition ===

One `gh pr view` for the head sha, the merge state and the draft flag.

`BEHIND`, `DIRTY` and a draft are terminal and do not ping.
`strict_required_status_checks_policy` is on, so a behind PR cannot merge until
it is updated — and `gh pr update-branch` moves the head sha and re-runs every
required check, so pinging one spends a slot on a sha about to be replaced and
would have its `--match-head-commit` arm cancelled by the update. A conflicted
PR's head has to change for the same reason. `UNKNOWN` proceeds: GitHub computes
mergeability asynchronously, so a single read genuinely returns it on a healthy
PR, and refusing to act on ignorance would refuse most runs. The value read is
printed either way.

A residual race survives here and is not worth a re-read to close. Phase 1
watches a moving head; the transition pins one. A push landing in the round trip
between phase 1's last read and this one would review a sha whose checks were
never confirmed. The window is one round trip, and `--match-head-commit` bounds
the damage to a cancelled arm rather than an unreviewed merge.

**Check-watching stops at the ping only on the clean row.** A clean review
never re-reads the checks: the only thing that moves one afterwards on that row
is a push, and a push already terminates the review with `The head commit
changed during the review`, which phase 2 catches by a better signal. A review
with findings is different — the fix commit that answers it is new code
nothing has run CI on, so once every thread has a reply the checks are watched
again, from a fresh clock, before arming. `--no-review` resuming a PR carries
the same watch for the same reason, on whatever threads a prior review left
open. The gap that survives is on the clean row and after a successful arm on
either row: a required check going red *after* auto-merge is armed means
GitHub holds the merge indefinitely, and nothing here reports that.

Re-arming this on a PR that is already green costs three calls before the gate
passes on its first iteration: the base-branch read, the ruleset read, and one
`gh pr checks`. There is deliberately no switch that skips phase 1; an escape
hatch there is a way to reintroduce the bug this shape exists to remove.

=== Phase 2 — the review ===

**It posts the ping itself, so do not also ping by hand.** A second ping against
an adaptive limit costs a slot, and it moves the marker this script does its
cooldown arithmetic on. There is no switch that hands the ping back: two code
paths meant every later comparison had to guess whether a ping existed, and
guessing wrong is what made this repo's resting `Review skipped` notice read as
a swallowed one. `--no-review` is not that switch either — it removes the
review, and the wait with it, rather than leaving one for somebody to ask for.

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

=== After the arm ===

Arming is not merging: `gh pr merge --auto` hands the decision to GitHub, which
still waits for every required check on its own clock before it squashes. So a
successful arm — on the clean row, the findings row, or `--no-review` — does
not end the run. It polls instead, the same way phase 2 polls on a ping it
posted rather than capping the wait: this waits on something the script itself
just placed (the arm), and a cap here would let the merge complete unattended
after the script had already given up watching it.

It polls for: the PR reaching MERGED (reports the merge sha and stops), the PR
reaching CLOSED without merging (terminal), and three consecutive API failures
(terminal, same three-strikes shape as every other wait in this script). Two
staleness cases are also caught, each reported with the exact `gh pr merge
--match-head-commit` command to re-arm by hand, because GitHub's own docs name
only two things that disable an armed auto-merge — a push from a user without
write permission, and switching the base branch — and say nothing about either
of these:

  - A required check going red after the arm. GitHub's resume behaviour once
    it goes green again is undocumented, so this does not guess at it.
  - The head sha moving after the arm, caught by comparing the live head sha
    against the sha the arm pinned on every poll.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number
  --no-review   Skip the ping and the review wait, then arm once every review
                thread this PR already carries has cleared. Above for what it
                does not skip.

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

=== After the ping — findings, and the review budget is one, this flag is not
    a second one ===

A clean review arms immediately, on the sha it was reviewed on, and moves
straight into the wait-for-merge phase (see "After the arm" above). A review
with findings, and a `--no-review` resume, both keep the script running before
they ever reach an arm: reply-and-fix is a real workflow with real wall-clock
in it, and the alternative was ending the run at the ping and pushing that
whole cycle onto a human running a second `watch-pr.sh --no-review` — which is
exactly the flag this section exists to stop needing.

  1. Wait for every review thread to clear (`isResolved == true` on all of
     them, the same GraphQL `unresolved_threads()` already gated the arm on).
     Threads first, because a fix commit can land after the reply that
     explains it — checking checks before threads would routinely read a
     stale or not-yet-caught-up state.
  2. Findings only: wait for every required check to go green again, on
     whatever head the fix commits produced. This is the same required-checks
     wait run a second time, fresh clock and fresh red/green ledger, with its
     red-check line ending `— not arming` instead of `— not pinging`.
     `--no-review` skips this: it never expects a fix commit, so there is
     nothing new for CI to have run on.
  3. Re-read the live head sha, once, and arm on that.

**A refuted finding is a reply, not a commit, and step 1 cannot see the
difference from here.** `unresolved_threads()` reads GitHub's `isResolved`
flag, the same mechanism the arm already gated on — deliberately not a second
"was this replied to" check with its own definition of done, because two
definitions of "handled" disagreeing with each other in the same code path is
worse than one imperfect one. The accepted cost: a reply with no code change
does not clear a thread by itself. Either CodeRabbit auto-resolves it, or a
human clicks "Resolve conversation" on GitHub. `SHIP_PR_THREAD_WAIT_TIMEOUT`
bounds the wait either way, and its expiry is not an error — it is a PR that
needs the same manual step it would have needed without this script at all.

**The re-pin in step 3 narrows the last round trip. It does not close the
race.** CodeRabbit only ever reviews the sha it was pinged on, once, at the
start of phase 2 — this script posts exactly one ping and never a second, so
nothing downstream re-reviews the eventual merge sha. What actually covers the
new head by the time step 3 arms is (i) every thread clear per
`unresolved_threads()`, findings or not, and (ii) required checks green on
that head, findings only — not a sha comparison. The re-read-then-arm only
bounds the *last* round trip to the same one-round-trip shape the transition
above already accepts, not the whole wait across steps 1-2, which is much
longer and not bounded the same way. `gh pr merge --auto`'s own re-verification
at merge time answers "is CI green", not "was this reviewed" — CodeRabbit is
deliberately not a required check, so that re-verification says nothing about
whether the arming sha was ever read.

Environment:
  SHIP_PR_POLL_SECONDS  Seconds between polls, in both phases and the
                        wait-for-merge phase that follows a successful arm.
                        Default 30. Set it to 0 for a fixture run, which has
                        nothing to wait for and would otherwise take 30s per
                        entry.
  SHIP_PR_AUTO_REPING   1 to ride out a rate limit and re-ping once (default),
                        0 to report the refusal and exit as before. Only
                        *acting* is gated; a live marker is reported either way.
  SHIP_PR_AUTO_MERGE    1 to arm GitHub's auto-merge when the review comes back
                        clean (default), 0 to leave the merge to you. Only a
                        genuine clean review qualifies: a refusal read nothing, a
                        review with findings is not clean, and an unreviewable
                        diff is an unreviewed merge wearing a clean one's
                        clothes. A draft PR and any unresolved review thread each
                        decline to arm, and so does a PR state that could not be
                        read. GitHub still waits for every required check, so
                        this arms rather than merges — and the arm is pinned to
                        the reviewed head sha, so a push landing after the review
                        cancels it rather than merging code nothing read. That
                        REJECT path is the whole safety argument for the default
                        being 1, and both paths are measured: pinned to a stale
                        sha the arm is refused outright and auto-merge stays off,
                        pinned to the current head it arms. Enforced when
                        auto-merge is enabled. Whether a push landing after a
                        successful arm is caught is still unmeasured.
  SHIP_PR_CHECKS_TIMEOUT
                        Seconds phase 1 will wait for the required contexts to
                        report. Default 2700 (45 minutes). Reached, the run ends
                        naming the contexts that never reported. 0 means the very
                        first poll is the last one. Also the timeout for the
                        post-review recheck of the same contexts, which reuses
                        this script's own name for the reason above.
  SHIP_PR_THREAD_WAIT_TIMEOUT
                        Seconds the post-review wait will wait for every review
                        thread to clear. Default 2700, matching
                        SHIP_PR_CHECKS_TIMEOUT's default. Reached, the run says
                        so and exits 0 — this is a PR that needs a human to
                        reply and re-arm, or to resolve a thread by hand, not a
                        script failure.
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
                        exhausted. This is how phase 2 is exercised without a
                        live PR, and `fixtures/run-fixtures.sh` is that suite with
                        each case's ping placed where the case needs it.
  SHIP_PR_CHECKS_FIXTURES
                        Colon-separated entries consumed one per phase-1
                        iteration in place of the `gh pr checks` call. An entry
                        is either a path to a JSON file holding what
                        `gh pr checks <pr> --json name,bucket,description` would
                        print, the form EXIT8=<path>, standing in for that same
                        JSON returned with the pending status 8, or the form
                        ERROR=<message>, standing in for a failed call. No entry
                        may contain a colon, which is the separator. A
                        multi-entry list is how the pending -> green transition is
                        exercised. Consumed twice per run when phase 2 reaches
                        the post-review recheck: the cursor is a continuous
                        stream across both calls, matching every other
                        fixture-cursor idiom in this file.
  SHIP_PR_THREADS_FIXTURES
                        Colon-separated entries consumed one per post-review
                        poll in place of the `unresolved_threads()` GraphQL
                        call. An entry is either a path to a JSON file holding
                        what the paginated `reviewThreads` query would return,
                        or the form ERROR=<message>, standing in for a failed
                        call. Unset offline, the post-review wait reads as
                        already-clear (0) rather than reaching the network, so
                        every fixture case that does not set this is unaffected
                        by the wait existing at all.
  SHIP_PR_BRANCH_RULES_FIXTURE
                        Read by required-checks.sh, which this script runs as a
                        child, so exporting it supplies the required-context list
                        phase 1 gates on without reaching the network.

  Those three are one switch, not three. Setting any one of SHIP_PR_FIXTURES,
  SHIP_PR_CHECKS_FIXTURES and SHIP_PR_BRANCH_RULES_FIXTURE requires the other
  two: a partial fixture run would quietly hit the network for the half nobody
  supplied, and the offline branches below all key off the same flag.
  SHIP_PR_PING_AT       ISO-8601 UTC timestamp standing in for the ping a
                        fixture run does not post. Offline only. Defaults to the
                        epoch, which puts the ping before every fixture
                        timestamp — and so switches the discriminator off for
                        the whole run, since everything then reads as newer than
                        the ping. Set it between two of them to place a status
                        or a comment on the resting side, which is the only way
                        the resting skip is testable offline.
  SHIP_PR_HEAD_SHA      Head sha for a fixture run, which has no PR to read one
                        from. Offline only. Defaults to `fixture-head-sha`.
  SHIP_PR_COMMENTS_FIXTURE
                        Read by coderabbit-deadline.sh, which this script runs
                        as a child, so exporting it drives the cooldown
                        arithmetic and the startup detection from a file. Set it
                        alongside SHIP_PR_FIXTURES; without it a fixture run
                        skips the startup check rather than reaching the
                        network.

Output from phase 1, in order, on stdout:
  <BUCKET>  <check-name>                      FAIL or CANCEL, the first time it appears
  <BUCKET>  <check-name>  — <desc>            same, for a check that carries one
  no required status checks — refusing to read an empty list as green
  cannot read the PR's base branch — refusing to gate blind
  the required check list could not be read — refusing to gate blind
  checks red: <names> — not pinging           terminal, phase 1's own call only
  checks timed out after <m>m — never reported: <names>
  branch is BEHIND — update it and re-arm     terminal, nothing pinged
  branch is DIRTY — resolve the conflicts and re-arm
  PR is a draft — mark it ready and re-arm

On stderr, so a clean run does not wake a `Monitor` caller to be told nothing:
  <BUCKET>  <check-name>                      PASS or SKIPPING, the first time it appears
  <BUCKET>  <check-name>  — <desc>            same, for a check that carries one
  checks green on <sha>                       the phase boundary; the slot is about to be spent

Under --no-review, before any wait:
  no review requested, and auto-merge is off — nothing armed   terminal

Otherwise, from phase 2's own ping-and-wait, one line, whichever applies:
  reviewed: <base> -> <n>                     the count rose; the post-review wait starts next
  reviewed clean, count unchanged at <n>      it ran and found nothing, arms directly
  auto-reping disabled — the ping is yours, nothing was posted
  cannot post the ping — nothing to wait for
  ping timestamp is unreadable — nothing to compare against
  offline: [re-]ping suppressed, continuing as if posted
  refused: rate limited, and the [re-]ping could not be posted
  refused: rate limited                       cool down, recompute, re-ping
  refused: rate limited, cooldown <n>m exceeds threshold
  refused: rate limited, countdown unreadable — the ping is yours
  refused: rate limited again after one re-ping
  refused: merged, CodeRabbit is done for good
  refused: head commit changed mid-review, reviewed head was <sha>
  refused: review failed — read the comment
  refused: skipped — ping did not register    re-ping, nothing was spent
  nothing reviewable — that IS the review

The post-review wait — reached from `reviewed: <base> -> <n>` and, minus the
checks recheck, from `--no-review` once auto-merge is on — on stdout:
  checks red: <names> — not arming             terminal, the recheck's own call only
  checks timed out after <m>m — never reported: <names>   the recheck's own clock
  threads still unresolved after <m>m — reply and re-arm, or resolve by hand   terminal, exit 0
  thread count API ERROR xN — stopping rather than waiting blind   three consecutive failures, exit 2

Then the arm, on stdout — the same code and the same lines regardless of which
of the three call sites (clean review, findings resolved, --no-review) reached
it. Only the live `gh pr merge` call succeeding leads to the wait-for-merge
phase below; every other line here is arm_auto_merge()'s own return of 1:
  auto-merge is off — nothing armed, merge by hand
  auto-merge not armed — PR is a draft
  auto-merge not armed — <n> unresolved threads
  auto-merge not armed — the PR state could not be read
  auto-merge could NOT be armed — merge by hand
  offline: auto-merge not armed (auto-merge is off)
  offline: auto-merge not armed (would arm on <sha>)
  offline: auto-merge not armed (would be UNREVIEWED on <sha>)

The wait-for-merge phase, reached only from a successful arm — see "After the
arm" above — on stdout:
  merged <sha>                                terminal
  PR closed without merging — nothing left to watch   terminal
  required check red after arm: <names> — ...re-arm by hand: gh pr merge ...
  head changed after arm, from <sha> to <sha> — re-arm by hand: gh pr merge ...
  merge-wait API ERROR xN — stopping rather than waiting blind   three consecutive failures, exit 2

Either phase, the post-review wait, or the wait-for-merge phase can also end
on stdout with:
  checks API ERROR xN — <message>             three consecutive failures in phase 1 or the recheck
  API ERROR xN (count=<n>) — <message>        three consecutive failures in phase 2's own wait
  FIXTURES EXHAUSTED                          offline runs only

On stderr, every 10th poll of any wait, so it reaches a terminal and the
monitor's output file without waking a caller that only reads stdout:
  still waiting on checks, <k>/<n> required reported, outstanding: <names>, <m>m elapsed
  still waiting, review running, count=<n>, <m>m elapsed
  still waiting, nothing from CodeRabbit yet, count=<n>, <m>m elapsed
  still waiting, <n> unresolved review threads, <m>m elapsed
  still waiting for the merge, <m>m elapsed   the wait-for-merge phase's own heartbeat

Also on stderr, said once where they apply:
  cannot reach GitHub — no head sha, do not wait blind   terminal
  cannot reach GitHub — no baseline, do not wait blind   terminal
  merge state reads <VALUE>
  no CodeRabbit commit status on <sha> — falling back to comment matching
  offline: first ping suppressed, ping_at=<time>
  checks green again on <sha>                  the recheck's own boundary
  re-pinned head to <sha>                       immediately before the arm; unchanged from the
                                                 original pin unless a push landed during the wait
  review in progress                          said once, then carried by the heartbeat
  live rate-limit marker at arm time, <n>m left
  stale rate-limit marker at arm time, deadline lapsed — pinging anyway
  rate-limit marker at arm time, countdown unreadable — pinging anyway
  cooling down <n>m, [re-]pinging at <time>   riding out a rate limit, then one ping
  pinged at <time> / re-pinged at <time>      the ping is posted; the wait goes on
  auto-merge armed on <sha> — GitHub squashes once the required checks pass
  auto-merge armed UNREVIEWED on <sha> — nothing has read this diff

Exit codes:
  0  a terminal outcome in any wait was reached, or a fixture list ran out
  1  bad usage, a partial fixture set, a non-numeric SHIP_PR_CHECKS_TIMEOUT or
     SHIP_PR_THREAD_WAIT_TIMEOUT, an empty or unreadable required-context list,
     an unreadable base branch or head sha (including the re-pin's own read),
     a failed baseline, or a ping that would not post or came back with a
     timestamp nothing can compare against
  2  three consecutive API failures — required checks (either call), the
     review-wait comment/status reads, the thread-count read, or the
     wait-for-merge phase's own PR read. Each ledger counts separately:
     different calls, different failure modes.
EOF
}

no_review=0
args=()
while [ "$#" -gt 0 ]; do
  case $1 in
    -h | --help)
      usage
      exit 0
      ;;
    --no-review) no_review=1 ;;
    # A misspelt flag must not become a positional. `--no-reviews <repo>` would
    # otherwise read as repo=--no-reviews, pr=<repo>, and the run would die
    # somewhere further down saying something else entirely.
    -*)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *) args+=("$1") ;;
  esac
  shift
done

if [ "${#args[@]}" -ne 2 ]; then
  usage >&2
  exit 1
fi

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=${args[0]}
pr=${args[1]}
poll=${SHIP_PR_POLL_SECONDS:-30}
checks_timeout=${SHIP_PR_CHECKS_TIMEOUT:-2700}
thread_wait_timeout=${SHIP_PR_THREAD_WAIT_TIMEOUT:-2700}

# The three fixture variables are one switch. Setting one without the others
# would run half the script offline and the other half against the live API —
# a "hermetic" suite that quietly reaches the network, and an offline branch
# below keyed off a flag that only some of the inputs honour.
set_fixtures=0
for v in "${SHIP_PR_FIXTURES:-}" "${SHIP_PR_CHECKS_FIXTURES:-}" "${SHIP_PR_BRANCH_RULES_FIXTURE:-}"; do
  [ -n "$v" ] && set_fixtures=$((set_fixtures + 1))
done
if [ "$set_fixtures" -ne 0 ] && [ "$set_fixtures" -ne 3 ]; then
  echo "SHIP_PR_FIXTURES, SHIP_PR_CHECKS_FIXTURES and SHIP_PR_BRANCH_RULES_FIXTURE are set together or not at all" >&2
  exit 1
fi

# Rejected here rather than at the comparison. `[ "$elapsed" -ge "$timeout" ]`
# with a non-numeric operand prints `integer expression expected` and evaluates
# false, so the cap never fires: the run is unbounded and says why on every
# single poll.
if ! [[ $checks_timeout =~ ^[0-9]+$ ]]; then
  echo "SHIP_PR_CHECKS_TIMEOUT must be a whole number of seconds, got: $checks_timeout" >&2
  exit 1
fi
if ! [[ $thread_wait_timeout =~ ^[0-9]+$ ]]; then
  echo "SHIP_PR_THREAD_WAIT_TIMEOUT must be a whole number of seconds, got: $thread_wait_timeout" >&2
  exit 1
fi

fixtures=()
checks_fixtures=()
offline=0
if [ "$set_fixtures" -eq 3 ]; then
  offline=1
  IFS=: read -r -a fixtures <<<"$SHIP_PR_FIXTURES"
  IFS=: read -r -a checks_fixtures <<<"$SHIP_PR_CHECKS_FIXTURES"
fi
# Independent of the three-fixture switch: unlike phase 1 and phase 2, the
# post-review wait has a real offline default (already-clear) rather than a
# hard requirement to reach the network, so it is not part of that gate.
threads_fixtures=()
if [ "$offline" -eq 1 ] && [ -n "${SHIP_PR_THREADS_FIXTURES:-}" ]; then
  IFS=: read -r -a threads_fixtures <<<"$SHIP_PR_THREADS_FIXTURES"
fi
# Three indices and three ledgers, one per wait. Sharing any would make two
# fixture lists fight over one cursor, and would fire a three-strikes abort
# after fewer than three consecutive failures within a single wait.
step=0
checks_step=0
threads_step=0

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

join_names() {
  local out="" name
  for name in "$@"; do out+="$name, "; done
  printf '%s' "${out%, }"
}

########################################################################
# Phase 1 — every required check reports, and every one of them is green
########################################################################

# The gate is the required contexts and nothing else. "No fail bucket anywhere"
# is the weaker test and wrong in both directions: `gh pr checks` reports only
# what exists on the head commit, so a fast third-party app answering first makes
# a list of one look complete, and a red non-required check would hold back a
# ping that should go out.
#
# A failed read and an empty list are separate failures, deliberately. Collapsed
# into one they would let a dead token read as "this branch requires nothing",
# which is the single answer that ends in an unattended merge over nothing.
required_read=1
if [ "$offline" -eq 1 ]; then
  # No --ref: required-checks.sh short-circuits on SHIP_PR_BRANCH_RULES_FIXTURE
  # before it reads either the ref or the repo.
  required_out=$("$here/required-checks.sh" "$repo") || required_read=0
else
  base_ref=$(gh pr view "$pr" --repo "$repo" --json baseRefName --jq '.baseRefName' 2>/dev/null) || base_ref=""
  if [ -z "$base_ref" ]; then
    echo "cannot read the PR's base branch — refusing to gate blind"
    exit 1
  fi
  required_out=$("$here/required-checks.sh" --ref "$base_ref" "$repo") || required_read=0
fi

if [ "$required_read" -eq 0 ]; then
  echo "the required check list could not be read — refusing to gate blind"
  exit 1
fi

required=()
mapfile -t required < <(printf '%s\n' "$required_out" | sed '/^$/d')
if [ "${#required[@]}" -eq 0 ]; then
  echo "no required status checks — refusing to read an empty list as green"
  exit 1
fi
required_json=$(printf '%s\n' "${required[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')

# One-shot bucket read: red/green/outstanding per required context, given a
# `gh pr checks --json name,bucket,description` payload. $required_json is
# read from the enclosing scope, same as every other reference to it in this
# file. Shared by wait_for_required_checks()'s own gate and by
# wait_for_merge()'s post-arm check, so the bucket vocabulary lives in
# exactly one place.
required_gate() {
  jq -r --argjson req "$required_json" '
    . as $rows
    | $req[]
    | . as $ctx
    | ([$rows[] | select(.name == $ctx) | .bucket]) as $b
    | (if ($b | length) == 0 then "outstanding"
       elif ($b | any(. == "fail" or . == "cancel")) then "red"
       elif ($b | any(. != "pass" and . != "skipping")) then "outstanding"
       else "green" end) as $s
    | "\($s)\t\($ctx)"
  ' <<<"$1"
}

# A function rather than an inline loop because phase 2 runs this a second
# time, against whatever head a fix commit produced, before arming on a review
# that had findings. `$1` is the only difference between the two calls: phase
# 1 says a red check holds back the ping, the reused call says it holds back
# the arm. `required` and `required_json` stay module-level — the required
# list itself does not change between calls — but every ledger below is
# function-local and reset fresh each time, because the second call is
# watching a different moment for a different purpose than the first and a
# carried-over red/green history from phase 1 would misreport it.
wait_for_required_checks() {
  local suffix=$1
  local checks_prev="" checks_fails=0 checks_i=0 checks_started
  checks_started=$(date +%s)
  # Seeded, not left empty: a run whose every poll failed still has to name what
  # it was waiting for when the cap fires.
  local outstanding=("${required[@]}")

  while true; do
    local rc=0
    # Two variables, because the two streams answer different questions. stdout is
    # the JSON the gate parses; stderr carries the `no checks reported` wording the
    # normalisation below keys on. Merged into one, any line gh writes to stderr —
    # a debug trace, a warning — lands inside a status-8 payload that is otherwise
    # valid JSON and fails the array check, so an ordinary pending poll is counted
    # as a failed read and three of them exit 2 before anything is pinged.
    local checks_err=""
    local entry payload

    # The fixture index has to advance in this shell: a `payload=$(helper)`
    # command substitution runs in a subshell, so the increment would be lost and
    # the loop would reread entry 0 forever. `checks_fixtures`/`checks_step` stay
    # module-level and are not reset per call: the second call continues
    # consuming the same colon-separated list, the same "fixture cursor is a
    # continuous stream" idiom every other fixture list in this file follows.
    if [ "$offline" -eq 1 ]; then
      if [ "$checks_step" -ge "${#checks_fixtures[@]}" ]; then
        echo "FIXTURES EXHAUSTED"
        exit 0
      fi
      entry=${checks_fixtures[$checks_step]}
      checks_step=$((checks_step + 1))
      payload=""
      case $entry in
        ERROR=*)
          checks_err=${entry#ERROR=}
          rc=1
          ;;
        EXIT8=*)
          entry=${entry#EXIT8=}
          rc=8
          if [ -r "$entry" ]; then
            payload=$(cat "$entry")
          else
            checks_err="fixture not readable: $entry"
            rc=1
          fi
          ;;
        *)
          if [ -r "$entry" ]; then
            payload=$(cat "$entry")
          else
            checks_err="fixture not readable: $entry"
            rc=1
          fi
          ;;
      esac
    else
      local checks_err_file
      checks_err_file=$(mktemp)
      payload=$(gh pr checks "$pr" --repo "$repo" --json name,bucket,description 2>"$checks_err_file") && rc=0 || rc=$?
      checks_err=$(cat "$checks_err_file")
      rm -f "$checks_err_file"
    fi

    # An empty checks list is an *error*, not an empty list: status 1 with
    # `no checks reported on the '<branch>' branch` on stderr. That is the state
    # for the first minutes after a PR opens, which is exactly when this is armed
    # — counted as a failure it exits 2 three polls later, before anything is
    # pinged, and the ledger cannot tell it from an expired token.
    if [ "$rc" -ne 0 ] && [ "$rc" -ne 8 ]; then
      case $checks_err in
        *"no checks reported"*)
          rc=0
          payload='[]'
          checks_err=""
          ;;
      esac
    fi

    # 8 is `gh pr checks` for "something is still pending", alongside valid JSON —
    # the normal state of a PR whose checks have not all reported. Treated as a
    # failure it trips the three-strike abort on every ordinary run.
    if [ "$rc" -eq 8 ]; then
      rc=0
    fi

    # A payload that will not parse must not read as "no required context has
    # reported yet". That would poll to the cap on garbage; it is a failed read and
    # is counted as one.
    if [ "$rc" -eq 0 ] && ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"$payload"; then
      rc=1
      checks_err="the checks payload would not parse as a JSON array"
    fi

    if [ "$rc" -eq 0 ]; then
      checks_fails=0
      # Every terminal bucket, required or not — a filter matching only success
      # would be silent through a failure, and silence is indistinguishable from
      # still-running. The description is appended because a green bucket does not
      # always mean the check did its job: `CodeRabbit` is pass either way, and
      # only the description separates "Review skipped: automatic reviews are
      # disabled" from "Review completed". Every other check here has an empty one,
      # so this annotates only the checks saying something.
      #
      # LC_ALL=C on both halves: `comm` reads two sorted streams, and a collation
      # that disagrees with the sort's silently drops or duplicates lines. This
      # suite is asserted byte-for-byte and now runs in CI as well as here.
      local cur
      cur=$(jq -r '
        .[]
        | select(.bucket != "pending")
        | "\(.bucket | ascii_upcase)  \(.name)"
          + (if (.description // "") == "" then "" else "  — \(.description)" end)
      ' <<<"$payload" | LC_ALL=C sort)
      # Non-actionable rows go to stderr, which still reaches the terminal and the
      # Monitor output file. Every stdout line under Monitor is a notification, and
      # each notification is one main-loop turn over the whole session context — so
      # ~a dozen PASS rows on a clean PR are a dozen wakes to be told nothing. On
      # the reused call this fires again for every context still green from the
      # first call, since `checks_prev` reset empty — a repeat of PASS rows already
      # seen, and accepted, because a fresh call has no other way to know what was
      # already reported.
      # FAIL and CANCEL stay on stdout: those are the rows a caller must act on.
      LC_ALL=C comm -13 <(printf '%s\n' "$checks_prev") <(printf '%s\n' "$cur") \
        | while IFS= read -r row; do
            case $row in
              FAIL* | CANCEL*) printf '%s\n' "$row" ;;
              *) printf '%s\n' "$row" >&2 ;;
            esac
          done
      checks_prev=$cur

      # green = {pass, skipping}, red = {fail, cancel}, and anything else keeps
      # polling. A bucket vocabulary that grew a member has to stall rather than
      # satisfy the gate.
      local gate=()
      mapfile -t gate < <(required_gate "$payload")

      local checks_red=()
      outstanding=()
      for line in ${gate+"${gate[@]}"}; do
        case ${line%%$'\t'*} in
          red) checks_red+=("${line#*$'\t'}") ;;
          green) : ;;
          *) outstanding+=("${line#*$'\t'}") ;;
        esac
      done

      # Terminal on the poll it appears, without waiting for the rest to report.
      # Nothing arriving later un-reds a required check. `$suffix` is the only
      # line that differs between the two calls this function serves.
      if [ "${#checks_red[@]}" -gt 0 ]; then
        echo "checks red: $(join_names ${checks_red+"${checks_red[@]}"}) $suffix"
        exit 0
      fi
      if [ "${#outstanding[@]}" -eq 0 ]; then
        return 0
      fi
    else
      checks_fails=$((checks_fails + 1))
      if [ "$checks_fails" -ge 3 ]; then
        # stderr where there is any, since that is where gh says what went wrong;
        # the stdout payload otherwise, which is what a call that failed without a
        # word on stderr leaves behind.
        printf 'checks API ERROR x%s — stopping rather than gating blind: %s\n' "$checks_fails" "${checks_err:-$payload}"
        exit 2
      fi
    fi

    checks_i=$((checks_i + 1))
    local checks_elapsed=$(($(date +%s) - checks_started))

    # This clock is fresh per call, so the reused call gets its own full
    # SHIP_PR_CHECKS_TIMEOUT rather than whatever phase 1 left on it — the fix
    # commit's CI run is a new wait, not a continuation of the first one.
    if [ "$checks_elapsed" -ge "$checks_timeout" ]; then
      printf 'checks timed out after %sm — never reported: %s\n' \
        "$((checks_elapsed / 60))" "$(join_names ${outstanding+"${outstanding[@]}"})"
      exit 0
    fi

    if [ $((checks_i % 10)) -eq 0 ]; then
      # stderr, for the same reason phase 2's heartbeat is on stderr. Without it a
      # gate stuck on a context that never appears is indistinguishable from a dead
      # script.
      echo "still waiting on checks, $((${#required[@]} - ${#outstanding[@]}))/${#required[@]} required reported, outstanding: $(join_names ${outstanding+"${outstanding[@]}"}), $((checks_elapsed / 60))m elapsed" >&2
    fi

    sleep "$poll"
  done
}

wait_for_required_checks "— not pinging"

########################################################################
# Arming the merge
########################################################################

# String-compared below, never integer-compared: `[ "false" -eq 1 ]` is a bash error,
# not a false, so a non-numeric value used to fall through to arming while printing
# nothing. Empty is the other trap - `:-` fires on it, so `SHIP_PR_AUTO_MERGE=`
# read as unset and armed. Anything that is not exactly 1 is off.
auto_merge=${SHIP_PR_AUTO_MERGE-1}

# Unresolved review threads on the PR, as a bare integer. Nothing on failure.
#
# A clean summary is not the same as a clear PR: findings can arrive as body text
# with no inline comment, and a thread left open is a finding nobody answered.
#
# Paginated, and that is the whole point of the guard rather than a nicety: one
# page of 100 threads reports the unresolved ones it can see, so a PR carrying
# more than that would arm an unattended merge over findings sitting on page 2.
# `--jq` runs per page, so the counts come back one per line and are summed here.
# A line that is not a bare integer aborts the sum and prints nothing, which the
# caller reads as a count it could not establish — the guard fails closed in
# every direction it can fail.
#
# Optional `$1` is a fixture path holding one GraphQL response — the same
# "optional first arg is a fixture path" shape `count()` uses. Live and fixture
# reads share the same jq filter because the fixture is the same response shape
# `--paginate` streams, just with one page instead of however many the real PR
# has; a fixture never needed pagination of its own before now, since the only
# caller was `arm_auto_merge`'s own offline short-circuit, which never reached
# this function at all.
unresolved_threads() {
  local pages
  if [ -n "${1:-}" ]; then
    [ -f "$1" ] || return 1
    pages=$(jq -r \
      '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' \
      "$1" 2>/dev/null) || return 1
  else
    # shellcheck disable=SC2016  # GraphQL variables, not shell: $owner/$name/$pr
    # are bound by the -F flags above, and $endCursor by --paginate.
    pages=$(gh api graphql --paginate -F owner="${repo%%/*}" -F name="${repo##*/}" -F pr="$pr" --jq \
      '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' \
      -f query='query($owner: String!, $name: String!, $pr: Int!, $endCursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100, after: $endCursor) {
              nodes { isResolved }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }' 2>/dev/null) || return 1
  fi
  # `bad` rather than a bare `exit 1`: awk runs END even on exit, so exiting
  # there alone still printed a total — a zero, which is precisely the answer
  # that arms the merge.
  awk '{ if ($0 !~ /^[0-9]+$/) { bad = 1 ; exit 1 } ; total += $0 }
       END { if (bad || NR == 0) exit 1 ; print total + 0 }' <<<"$pages"
}

# Waits for `unresolved_threads()` to read 0, the same mechanism the arm
# already gates on — deliberately not a second "was this replied to" check
# with its own definition of done, since two definitions of "handled"
# disagreeing in the same code path is worse than one imperfect one. The
# accepted cost is in `--help`: a refuted finding (a reply with no code
# change) does not clear here unless CodeRabbit auto-resolves it or a human
# resolves the conversation on GitHub by hand.
#
# Offline with no SHIP_PR_THREADS_FIXTURES reads as already-clear and returns
# immediately, printing nothing — so every fixture case that does not set that
# variable is unaffected by this wait existing at all. Set, an entry is either
# a fixture path `unresolved_threads()` reads or `ERROR=<message>`, standing in
# for a failed call, the same idiom `wait_for_required_checks` uses for its own
# fixture list.
wait_for_threads_replied() {
  if [ "$offline" -eq 1 ] && [ "${#threads_fixtures[@]}" -eq 0 ]; then
    return 0
  fi

  local threads_fails=0 threads_i=0 threads_started
  threads_started=$(date +%s)

  while true; do
    local rc=0 threads="" entry
    if [ "$offline" -eq 1 ]; then
      if [ "$threads_step" -ge "${#threads_fixtures[@]}" ]; then
        echo "FIXTURES EXHAUSTED"
        exit 0
      fi
      entry=${threads_fixtures[$threads_step]}
      threads_step=$((threads_step + 1))
      case $entry in
        ERROR=*) rc=1 ;;
        *) threads=$(unresolved_threads "$entry") || rc=1 ;;
      esac
    else
      threads=$(unresolved_threads) || rc=1
    fi

    if [ "$rc" -eq 0 ]; then
      threads_fails=0
      if [ "$threads" -eq 0 ]; then
        return 0
      fi
    else
      threads_fails=$((threads_fails + 1))
      if [ "$threads_fails" -ge 3 ]; then
        echo "thread count API ERROR x$threads_fails — stopping rather than waiting blind"
        exit 2
      fi
    fi

    threads_i=$((threads_i + 1))
    local threads_elapsed=$(($(date +%s) - threads_started))

    # Bounded, unlike phase 2's own wait: that one waits on a ping this script
    # posted, so it is always either running or terminal. This waits on a human
    # reply, or on someone clicking "Resolve conversation" for a refuted
    # finding, and either can simply never happen. Terminal rather than an
    # error — the PR just needs the same manual step it would have needed
    # without this script at all.
    if [ "$threads_elapsed" -ge "$thread_wait_timeout" ]; then
      echo "threads still unresolved after $((threads_elapsed / 60))m — reply and re-arm, or resolve by hand"
      exit 0
    fi

    if [ $((threads_i % 10)) -eq 0 ]; then
      echo "still waiting, $threads unresolved review threads, $((threads_elapsed / 60))m elapsed" >&2
    fi

    sleep "$poll"
  done
}

# Hands the merge to GitHub rather than performing it here. `--auto` waits for
# every *required* status check on its own, so this never has to re-verify green
# or race a branch that goes BEHIND mid-wait — the same contract
# .github/workflows/dependabot-auto-merge.yml relies on.
#
# Three callers, and `$1` is the only thing distinguishing them: the clean-
# review arm and the post-findings arm both pass 0, since both know a review
# actually ran; `--no-review` passes whichever `count()` says — 0 when this
# PR carries a prior real review, 1 when it genuinely never had one. The
# wording is about the diff, not the flag: `--no-review` on an already-reviewed
# PR reads the same as the clean-review arm, because CodeRabbit did read it,
# just not in this run.
#
# `--match-head-commit` is the guard the default carries its weight on. GitHub's
# auto-merge survives subsequent pushes, which is the entire hazard — pinning the
# arm to the sha CodeRabbit actually reviewed makes a later push cancel it
# instead of merging unreviewed code. The sha is printed so that cancellation is
# not silent.
#
# No `--delete-branch`: the repo already sets delete_branch_on_merge, and the
# flag additionally tries to delete the LOCAL branch, which fails from a
# worktree.
#
# Every path here says which one it took. One generic failure line covered five
# different situations, and "merge by hand" is not what a reader needs to know
# when the answer is that the PR is still a draft.
# Return code is a real contract now, not just an echo: every branch returns 1
# except the one where the live `gh pr merge` call actually succeeds, which
# returns 0 via its trailing echo. `wait_for_merge` below is only ever entered
# on that one true arm, never on "nothing to arm" or "arming failed".
arm_auto_merge() {
  local unreviewed=$1
  if [ "$auto_merge" != 1 ]; then
    if [ "$offline" -eq 1 ]; then
      echo "offline: auto-merge not armed (auto-merge is off)"
    else
      echo "auto-merge is off — nothing armed, merge by hand"
    fi
    return 1
  fi
  if [ "$offline" -eq 1 ]; then
    # Says what it would have done rather than only that it did nothing, so an
    # offline fixture run can assert the sha a re-pin produced and which of the
    # two wordings a `--no-review` baseline read actually earned — neither is
    # otherwise observable without a live `gh pr merge` call this branch
    # deliberately never makes.
    if [ "$unreviewed" -eq 1 ]; then
      echo "offline: auto-merge not armed (would be UNREVIEWED on $head_sha)"
    else
      echo "offline: auto-merge not armed (would arm on $head_sha)"
    fi
    return 1
  fi
  local draft threads
  draft=$(gh pr view "$pr" --repo "$repo" --json isDraft --jq '.isDraft' 2>/dev/null) || draft=""
  threads=$(unresolved_threads) || threads=""
  # Fails closed. A state that could not be read is not a state that permits an
  # unattended merge.
  if [ -z "$draft" ] || [ -z "$threads" ]; then
    echo "auto-merge not armed — the PR state could not be read"
    return 1
  fi
  if [ "$draft" = "true" ]; then
    echo "auto-merge not armed — PR is a draft"
    return 1
  fi
  if [ "$threads" -ne 0 ]; then
    echo "auto-merge not armed — $threads unresolved threads"
    return 1
  fi
  if gh pr merge "$pr" --repo "$repo" --auto --squash --match-head-commit "$head_sha" >/dev/null 2>&1; then
    if [ "$unreviewed" -eq 1 ]; then
      echo "auto-merge armed UNREVIEWED on $head_sha — nothing has read this diff" >&2
    else
      echo "auto-merge armed on $head_sha — GitHub squashes once the required checks pass" >&2
    fi
  else
    # Never silent, and never phrased as though it merged. Arming fails for
    # reasons worth seeing: auto-merge disabled on the repo, a branch GitHub will
    # not fast-forward, missing permission.
    echo "auto-merge could NOT be armed — merge by hand"
    return 1
  fi
}

# Reached only from a live, successful arm — never offline, never a decline.
# Arming is not merging: GitHub still waits for every required check on its
# own clock, so this keeps polling past the arm the same way phase 2 keeps
# polling past its own ping — both wait on something this script itself set in
# motion, so an uncapped wait here carries the same justification phase 2's
# already does. A cap would let a merge complete unattended after the script
# gave up watching it.
wait_for_merge() {
  local armed_sha=$1
  [ "$offline" -eq 1 ] && return 0

  local fails=0 i=0 started last_red="" push_reported=0
  started=$(date +%s)

  while true; do
    local pr_json rc=0
    pr_json=$(gh pr view "$pr" --repo "$repo" --json state,headRefOid,mergeCommit 2>/dev/null) || rc=1

    if [ "$rc" -eq 0 ] && [ -n "$pr_json" ]; then
      fails=0
      local state cur_sha merged_sha
      state=$(jq -r '.state // ""' <<<"$pr_json")
      cur_sha=$(jq -r '.headRefOid // ""' <<<"$pr_json")
      merged_sha=$(jq -r '.mergeCommit.oid // ""' <<<"$pr_json")

      if [ "$state" = "MERGED" ]; then
        echo "merged ${merged_sha:-$cur_sha}"
        exit 0
      fi
      if [ "$state" = "CLOSED" ]; then
        echo "PR closed without merging — nothing left to watch"
        exit 0
      fi

      if [ "$push_reported" -eq 0 ] && [ -n "$cur_sha" ] && [ "$cur_sha" != "$armed_sha" ]; then
        push_reported=1
        # A push from a write-permission actor leaves GitHub's auto-merge armed
        # (it disables only for an unprivileged pusher or a base-branch switch —
        # see reference/coderabbit.md), so left alone this would still merge
        # whatever landed, unreviewed, the moment checks pass. Disabling it here
        # is what makes the re-arm command below correct: nothing merges until
        # it's run again, deliberately, on the sha actually being reported.
        gh pr merge "$pr" --repo "$repo" --disable-auto >/dev/null 2>&1 || true
        echo "head changed after arm, from $armed_sha to $cur_sha — auto-merge disabled; re-arm by hand: gh pr merge $pr --repo $repo --auto --squash --match-head-commit $cur_sha"
      fi

      local checks_payload checks_rc=0
      checks_payload=$(gh pr checks "$pr" --repo "$repo" --json name,bucket,description 2>/dev/null) || checks_rc=$?
      if [ "$checks_rc" -eq 0 ] || [ "$checks_rc" -eq 8 ]; then
        local red
        red=$(required_gate "$checks_payload" | awk -F'\t' '$1=="red"{print $2}' | LC_ALL=C sort | tr '\n' ,)
        if [ -n "$red" ] && [ "$red" != "$last_red" ]; then
          last_red=$red
          # $cur_sha, not $armed_sha: gh pr checks reads the PR's current head,
          # and once a push has already been reported the two have diverged —
          # printing the stale sha would hand back a --match-head-commit that
          # no longer matches anything and fails outright.
          echo "required check red after arm: ${red%,} — GitHub's resume behaviour here is undocumented; re-arm by hand: gh pr merge $pr --repo $repo --auto --squash --match-head-commit $cur_sha"
        elif [ -z "$red" ]; then
          last_red=""
        fi
      elif [ "$checks_rc" -ne 0 ]; then
        # Not counted in $fails — that ledger belongs to the one read
        # (gh pr view) that decides whether the wait is still alive. A
        # degraded checks read is a secondary signal going dark, not the
        # loop itself failing, but silence here would read as "nothing red"
        # rather than "couldn't tell" — so it says so.
        echo "checks read failed inside the merge wait (exit $checks_rc) — red-check detection is degraded until it recovers" >&2
      fi
    else
      fails=$((fails + 1))
      if [ "$fails" -ge 3 ]; then
        printf 'merge-wait API ERROR x%s — stopping rather than waiting blind\n' "$fails"
        exit 2
      fi
    fi

    i=$((i + 1))
    if [ $((i % 10)) -eq 0 ]; then
      echo "still waiting for the merge, $((($(date +%s) - started) / 60))m elapsed" >&2
    fi
    sleep "$poll"
  done
}

########################################################################
# The transition — pin the head, then phase 2
########################################################################

# Captured once and never re-read on the clean-review row. CodeRabbit's commit
# status is per sha, so a push landing after the review leaves the new head
# carrying only this repo's resting skip notice — re-reading the head each poll
# would read that and call it a swallowed ping. Pinning it means a moved head
# shows up as a moved head.
#
# Phase 1 watched a moving head and this pins one; a second read inside the
# review-wait poll loop below would reintroduce the race this bounds. That
# still holds for the clean-review row, which arms straight off this pin and
# never reads the head again. The findings row and `--no-review` are
# different: both re-read it once more, immediately before arming, via
# `re_pin_head_sha` — see --help, "The re-pin in step 3 narrows the last round
# trip. It does not close the race," for what that does and does not cover.
#
# An empty sha is the same failure as an unreachable one, and louder about it
# than the exit code is: `--jq` prints nothing and exits 0 when the field is
# missing, which would leave the status URL as `commits//status` and hand
# `--match-head-commit` an empty value — the pin this whole design rests on,
# silently absent.
if [ "$offline" -eq 1 ]; then
  head_sha=${SHIP_PR_HEAD_SHA:-fixture-head-sha}
else
  pr_state=$(gh pr view "$pr" --repo "$repo" --json headRefOid,mergeStateStatus,isDraft 2>/dev/null) || pr_state=""
  head_sha=""
  merge_state=""
  is_draft=""
  if [ -n "$pr_state" ]; then
    head_sha=$(jq -r '.headRefOid // ""' <<<"$pr_state")
    merge_state=$(jq -r '.mergeStateStatus // ""' <<<"$pr_state")
    # Not `.isDraft // "false"`: jq's `//` fires on `false` as well as on null,
    # so the alternative form answers "false" for both and reads the same either
    # way by luck rather than by meaning.
    is_draft=$(jq -r 'if .isDraft == true then "true" else "false" end' <<<"$pr_state")
  fi
  if [ -z "$head_sha" ]; then
    echo "cannot reach GitHub — no head sha, do not wait blind" >&2
    exit 1
  fi
  # Printed rather than acted on. GitHub computes mergeability asynchronously, so
  # UNKNOWN comes back on a healthy PR and blocking on ignorance would refuse
  # most runs.
  echo "merge state reads ${merge_state:-UNREADABLE}" >&2
  # Each of these has to change the head commit before the PR can merge, so a
  # ping now is a slot spent on a sha about to be replaced — and the
  # --match-head-commit arm below would be cancelled by the replacement.
  case $merge_state in
    BEHIND)
      echo "branch is BEHIND — update it and re-arm"
      exit 0
      ;;
    DIRTY)
      echo "branch is DIRTY — resolve the conflicts and re-arm"
      exit 0
      ;;
  esac
  if [ "$is_draft" = "true" ]; then
    echo "PR is a draft — mark it ready and re-arm"
    exit 0
  fi
fi

echo "checks green on $head_sha" >&2

# Re-reads the live head sha, once, immediately before arming — used by the
# findings row of phase 2's own wait and by `--no-review`, never by the
# clean-review row, whose pin above stays this run's only read of it. See
# --help, "The re-pin in step 3 narrows the last round trip. It does not close
# the race," for the honest accounting of what this does and does not cover:
# it is not a second review, and nothing downstream re-reviews whatever this
# reads.
re_pin_head_sha() {
  if [ "$offline" -eq 1 ]; then
    # Defaults to a no-op — the same sha the original pin used — so every
    # fixture case that does not set SHIP_PR_HEAD_SHA_2 exercises this
    # function without its output changing. Set to something else, it is the
    # only way this logic is exercised without a live PR.
    head_sha=${SHIP_PR_HEAD_SHA_2:-$head_sha}
  else
    head_sha=$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq '.headRefOid // ""' 2>/dev/null) || head_sha=""
    if [ -z "$head_sha" ]; then
      echo "cannot reach GitHub — no head sha, do not wait blind" >&2
      exit 1
    fi
  fi
  echo "re-pinned head to $head_sha" >&2
}

# Reached from the findings row of phase 2's own wait ("reviewed: <base> ->
# <n>") only — the clean-review row arms directly, above, and never reaches
# this.
#
# Threads first, then checks, then the re-pin, then the arm. A fix commit can
# land after the thread reply that explains it, so checking checks ahead of
# threads would routinely read a state CI has not caught up to yet. Checks
# are re-watched at all only here, never under `--no-review`: a fix commit is
# new code nothing has run CI on, and `--no-review` by definition has none.
post_review_wait() {
  wait_for_threads_replied
  wait_for_required_checks "— not arming"
  echo "checks green again on $head_sha" >&2
  re_pin_head_sha
  if arm_auto_merge 0; then
    wait_for_merge "$head_sha"
  fi
  exit 0
}

# `--no-review` skips the ping and the review wait — there is nothing else in
# phase 2's own wait to keep — but not the wait that follows a review, since a
# PR resumed with this flag may carry threads from an earlier review this run
# never posted. What it does skip, beyond the ping: the checks recheck, since
# it never expects a fix commit to justify one.
#
# What it must not skip is the merge preconditions, and it does not: BEHIND,
# DIRTY and a draft are terminal in the transition above, before this line, and
# `arm_auto_merge` still declines on a draft, on unresolved threads and on a PR
# state it could not read. A red required check and a phase-1 timeout are
# terminal further up still, so this flag never sees them.
#
# SHIP_PR_AUTO_MERGE=0 wins, and says so. Silence here would be the flag quietly
# overriding the off switch, and the run's only other output is "checks green" —
# indistinguishable from a script that died.
if [ "$no_review" -eq 1 ]; then
  if [ "$auto_merge" != 1 ]; then
    echo "no review requested, and auto-merge is off — nothing armed"
    exit 0
  fi
  wait_for_threads_replied
  re_pin_head_sha

  # Whether this diff was ever read is a property of the PR's history, not of
  # this flag — `--no-review` means "do not ping and do not wait for one", not
  # "nothing has read this diff". A PR carrying a real review already (count
  # > 0, the same non-zero-baseline reasoning phase 2's own baseline read
  # rests on) gets the ordinary armed wording; a genuinely never-reviewed one
  # keeps the UNREVIEWED line. Read through the same offline/live split as the
  # baseline call below, so this stays reachable without a live PR: offline it
  # reads `fixtures[0]`, the same entry the baseline read would take if phase 2
  # ran, live it hits the network.
  if [ "$offline" -eq 1 ]; then
    count_now=$(count "${fixtures[0]}/reviews.json") || count_now=""
  else
    count_now=$(count) || count_now=""
  fi
  unreviewed=1
  if [ -n "$count_now" ] && [ "$count_now" -gt 0 ]; then
    unreviewed=0
  fi
  if arm_auto_merge "$unreviewed"; then
    wait_for_merge "$head_sha"
  fi
  exit 0
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
max_cooldown=${SHIP_PR_MAX_COOLDOWN:-1800}
# The cap counts refusals ABSORBED, not pings posted. A first ping that had to
# wait out a pre-existing cooldown is still the first ping — routing it through
# `ride_out_cooldown` and letting that function claim the retry would hand a PR
# already rate limited at arm time one ping and zero retries, silently weaker
# than the "exactly one automatic re-ping" this promises. So the increment lives
# at the poll loop's call site, where a refusal actually arrived, and the startup
# ride-out leaves the ledger at zero.
refusals_absorbed=0
# Sticky. CodeRabbit edits its in-progress comment into the outcome, so the text
# is gone from a later poll while the review is still legitimately running —
# recomputing this each round would report "nothing yet" mid-review.
in_progress=0
ping_posted=0
ping_at=""
# No `ping_epoch` seed. `adopt_ping_at` sets it or the script exits, and a
# placeholder here would be a third answer to "when was the ping" that only a
# path failing to adopt could ever read.
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
#
# An unreadable timestamp is terminal, and that is not tidiness. Every later
# discrimination is "did this land after the ping": the status branch compares
# epochs, the comment branch filters on the string. Carrying an "unknown" epoch
# gives those two independent answers to the same question — a zero epoch reads
# every real status as newer than the ping, so this repo's resting `Review
# skipped` notice comes back as a swallowed ping, which is the bug this script
# was rewritten to remove. There is no such state now: either the ping has a
# timestamp everything agrees on, or the run stops.
adopt_ping_at() {
  if ! ping_epoch=$(date -u -d "$ping_at" +%s 2>/dev/null); then
    echo "ping timestamp is unreadable — nothing to compare against"
    exit 1
  fi
  ping_posted=1
  since=$(date -u -d "@$((ping_epoch - 1))" +%Y-%m-%dT%H:%M:%SZ)
}

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

# The CodeRabbit commit status on the pinned head, as
# "<updated_at><TAB><description>". Takes the fixture directory offline and reads
# the combined status endpoint live; that endpoint returns the latest status per
# context, so there is at most one line either way.
#
# Empty output is a real state rather than an error: the context is undocumented,
# so a vocabulary change has to degrade to comment matching rather than hang.
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
# `since` and `refusals_absorbed` are the caller's.
#
# Prints an outcome line on every branch. Returns 0 when a ping was posted and
# waiting should continue, 1 when the outcome is terminal.
#
# Which ping it is comes from `ping_posted`, read before anything moves it. From
# the startup check nothing has been posted yet, so this is the FIRST ping and
# saying "re-pinged" would contradict the retry ledger a line above it: a first
# ping that had to wait out a pre-existing cooldown does not consume the one
# retry, and the wording is the only place a reader can see that.
ride_out_cooldown() {
  local remaining again verb
  if [ "$ping_posted" -eq 1 ]; then
    again="re-"
    verb="re-pinged"
  else
    again=""
    verb="pinged"
  fi
  if [ "$refusals_absorbed" -gt 1 ]; then
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
  echo "cooling down $((remaining / 60))m, ${again}pinging at $(local_time $(($(date -u +%s) + remaining)))" >&2
  # Offline is the fixture harness, and it has to reach the arithmetic above —
  # that is the point of routing both entry points through one function. What it
  # must not do is sleep out a real countdown or post to a real PR, so it skips
  # both and continues as though the ping landed. That keeps the one-retry cap
  # testable: the next fixture entry absorbs a second refusal on the way back in.
  if [ "$offline" -eq 1 ]; then
    # `ping_at` stays where the fixture put it — a suppressed ping cannot move a
    # timestamp nothing posted — but the run still has to count as pinged, or the
    # startup path would fall through and "post" a second one.
    adopt_ping_at
    echo "offline: ${again}ping suppressed, continuing as if posted"
    return 0
  fi
  sleep "$remaining"
  local created
  created=$(post_ping) || created=""
  if [ -z "$created" ]; then
    echo "refused: rate limited, and the ${again}ping could not be posted"
    return 1
  fi
  # Adopting the new ping's timestamp also advances `since`, which is what keeps
  # the marker that just refused us — still sitting in the old window — from
  # matching on the very next poll.
  ping_at=$created
  adopt_ping_at
  echo "$verb at $(local_time "$(date -u +%s)")" >&2
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
      echo "live rate-limit marker at arm time, $((startup_remaining / 60))m left" >&2
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
      echo "stale rate-limit marker at arm time, deadline lapsed — pinging anyway" >&2
    fi
    ;;
  # Marker present, arithmetic unavailable — so there is no deadline to sleep
  # until. Ping anyway: if the window really is still live the ping comes back
  # refused, and that refusal is the one the retry below absorbs. Staying silent
  # and polling would be the no-op this block exists to remove.
  2) echo "rate-limit marker at arm time, countdown unreadable — pinging anyway" >&2 ;;
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
            echo "review in progress" >&2
          fi
          ;;
      esac
    fi

    if [ "$n" -gt "$base" ]; then
      echo "reviewed: $base -> $n"
      # Findings, not a stop: the reply-and-fix cycle is a real workflow with
      # real wall-clock in it, and ending the run here pushed that whole cycle
      # onto a human running a second `watch-pr.sh --no-review` — the flag
      # this function exists to stop needing.
      post_review_wait
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
    # Same `${x+...}` guard as `read_bodies` uses, and needed for the same
    # reason: `set -u` treats an empty array's expansion as unset on Bash before
    # 4.4, and a poll that turns up no comments in the window is the ordinary
    # case rather than an edge — every quiet fixture reaches here with none.
    for body in ${bodies+"${bodies[@]}"}; do
      case $body in
        # Ahead of "review in progress" within a single body: a clean review
        # never moves the count, so this is the only signal that it finished, and
        # a body carrying both means the review ended while stale progress text
        # was still in it.
        *"No actionable comments were generated"*)
          echo "reviewed clean, count unchanged at $n"
          if arm_auto_merge 0; then
            wait_for_merge "$head_sha"
          fi
          exit 0
          ;;
        *"rate limited by coderabbit.ai"*)
          # A refusal read nothing, so the re-ping is still the *first* review.
          # Only this outcome is worth riding out; the rest are final.
          #
          # Counted here rather than inside the function, which also serves the
          # startup path — where nothing has been refused yet.
          refusals_absorbed=$((refusals_absorbed + 1))
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
            echo "review in progress" >&2
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
