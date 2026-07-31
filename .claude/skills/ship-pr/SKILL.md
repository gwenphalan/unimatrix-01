---
name: ship-pr
description: Take a task all the way to merged. Use at the start of any session whose end state is a merge — given the task itself, or a pointer to a .notes/issues/*.todo.md. Carries the ordered steps — plan through a subagent, attack the plan, get approval, implement through a subagent, check in, then PR, review and merge — plus the PR body a fresh reader can review from, the review ladder and its costs, and striking the shipped line from .notes/.
---

# Ship a PR

## How this is invoked

**The owner types this at the *start* of a session, not the end.** The argument is either the
task in their own words, or a pointer to a `.notes/issues/*.todo.md` — sometimes just the file,
meaning "the first unfinished item on it". Resolve that before doing anything: read the file, and if
the target is ambiguous, name the line you are about to implement and say so rather than guessing.

Because you are invoked before the work exists, the whole arc is yours: plan, build, then ship. Take
it to merged. Come back for the two stops below, for a decision that is theirs to make, or when
something is actually wrong — not for progress reports.

## The steps

Run them in order. The two stops are real stops — work does not continue past them on an assumption,
and a lack of objection is not approval.

0. **If this is a problem rather than a change, load `problem-solving` first.** "Make the picker
   choose the pool" is a change. "Why does the drill list go stale" or "how should we handle X" is a
   problem, and going straight to a plan produces a confident answer to the wrong question. When
   unsure, it is a problem.
1. **Dispatch `monorepo-planner` to investigate and report.** It reads the code rather than
   remembering it, and it cannot edit. Give it the task in the owner's words plus anything settled
   verbally — not your own theory of the fix, which is the thing that would contaminate it.
2. **Attack the plan before believing it.** A plan you only read is a plan you approved, and you
   framed the task the planner worked from — so auditing it yourself is the same self-review this
   skill forbids for code.

   **Dispatch `plan-adversary` when the change is more than mechanical**, meaning any of: it spans
   more than one workspace; it moves runtime, build, auth, data or CI behaviour; it touches more than
   about five files; or the planner left an open question or an unverified claim. Otherwise check the
   claims yourself — a one-file constant change does not repay a round trip. Either way, call
   `advisor` when the *shape* of the change is in doubt rather than its details.

   A `DO NOT PROCEED` goes back to step 1 with the finding, not around it.
3. **Present it so it can be skimmed, then wait.** What becomes true, the files grouped by
   workspace, the reasoning that is not visible in a diff, what you rejected, and what would make it
   wrong — in that order, scannable. **Once the owner approves, build the task list.**
4. **Dispatch `monorepo-implementer` with the approved plan.** It builds exactly that, commits in
   logical steps, and stops rather than improvising if the plan turns out wrong. If the change
   touches a browser surface, **dispatch `browser-verifier` before you report done** — it holds the
   Chrome tooling so this context does not have to, which is what makes honouring that rule cheaper
   than skipping it.
5. **Check in — in the owner's terms, not the code's.** What was done and why, the decisions the
   plan left open, what you ran and what it printed, what you could not verify. It must be
   understandable without opening the diff, because it will be read without opening the diff. Then
   stop, unless they have said not to.
6. **Once they are satisfied, open the PR.** Body per the section below.
7. **Watch the checks, then review once green** — every required check, then `pr-signal-collector`
   for the findings that never reach the checks list, then a fresh reader.
8. **Merge once everything clears,** then strike the shipped line from `.notes/`.

Steps 1 and 4 are delegated on purpose: a fresh context re-derives from the code, where you would
re-derive from your own earlier reasoning. Skip a delegation only for a change small enough that the
handover costs more than the work — a typo, a one-line constant — and say that you skipped it. When
you skip it, every rule in the agent's own file binds you instead, commit shape included. Dispatch
and keep working: the synchronous form is almost never the right one, because checking the planner's
claims against the code and reading what it reports on both run alongside it.

**A subagent is opaque while it runs.** You get its final report, not its progress, so a *delegated*
task's status moves at the delegation boundaries: mark it in progress before dispatching, update it
when the report lands. Do not write status you cannot see — a task list that reports a subagent's
internal state is inventing it. This is a limit on delegated tasks only; the work you do yourself
closes when it is done.

**One dispatch is one task, however many pieces it covers.** Five tasks flipped together report five
workstreams you cannot see; the pieces you will check afterwards are verification checkpoints and
stay pending until you have checked them.

## Before opening anything

Run the narrowest relevant checks for what changed before opening the PR, not after. `pnpm check` is
the normal gate; `pnpm verify` when the change spans workspaces or touches runtime/build behaviour.
In root `package.json` those two differ by exactly one word — `verify` adds `build` to the turbo run
— so the question is only ever "could this break a build". A PR opened red wastes a CI cycle and
buries the real signal.

**The browser check happens before the PR is opened**, not after CI goes green — a green PR is what
makes it feel skippable. Which surfaces need it, and how, belong to the root `AGENTS.md` rule and to
`browser-verifier`; what this skill adds is only the timing and the dispatch.

## Opening it

**Write the title and body for a person, not for a changelog generator.** The owner works in
PM-mode and does not read diffs line by line, and — see the next section — the pre-merge review is
done by a reader with no access to this conversation. Both of them get the PR body and nothing else.
A body that only lists what changed is unreviewable: it gives them no way to tell correct from
plausible.

Conventional commit for the title, and the scope after the type is the workspace or surface, not a
file. The rest of the title should read as a sentence a human would say — what the change makes
true, not which symbols moved.

```text
feat(cflop): make Drill's picker choose the pool instead of filtering the list   ← yes
feat(cflop): refactor case-selection.ts and add setCasesEnabled                  ← no
```

The body must carry three things, in this order:

1. **The requirement.** What the owner actually asked for, in their terms — including anything that
   was settled verbally and exists nowhere in the code. Wording they rejected and the wording they
   chose. Behaviour they specified that a reader would otherwise assume was your invention. **This
   is load-bearing**: a fresh reviewer can check "is this sound" from the diff alone, but can only
   check "is this what was asked" if the ask is written down here. If it came from a
   `.notes/issues/*.todo.md` line, quote the line.
2. **Why, before what.** Lead with the problem — what was wrong, what it cost, why the obvious
   alternative was not taken. The *what* follows from it and is usually the shorter half. If a
   decision has a non-obvious reason (an ordering that prevents a silent no-op, a hook owned by one
   component because two copies would desync), that reason belongs in the body; it is exactly what
   a reviewer cannot reconstruct and will otherwise flag as arbitrary.
3. **What you could not verify.** Plainly. An unmentioned gap reads as a confirmed result. If a fix
   is precautionary rather than demonstrated, say so — do not let it read as a proven fix.

## Gather what the reviewer cannot see

Some findings never reach a reviewer because they live in GitHub rather than in the diff, and the PR
body is the reviewer's whole input — so a finding left in a dashboard is a finding nobody reviews.
**Dispatch `pr-signal-collector` once the checks are green**, and put anything real into the body.
Nothing else collects these for you; `/code-review` does not.

## Review before merge — hand off to a fresh reader

**Do not review your own work and call that a review.** By the time the PR is open you have already
convinced yourself the code is correct, and any reviewer whose input passes through your summary
inherits that conviction. A subagent spawned from this session gets a fresh *context* but not a
fresh *framing* — you still write its prompt, choose what it looks at, and decide what is settled.

**Every required check must be green before you request any review.** Not merely reported — green. A
reviewer pointed at a branch that then goes red reviews code you are about to change, and the fix
either wastes the review or costs a second one. This is not a formality: CodeQL and the `Images`
matrix both land well after the PR opens, and CodeQL can fail on a *new* alert introduced by the diff
even when its own workflow succeeds, so "the PR opened without complaint" tells you nothing yet. Wait
for green, then ping.

So the pre-merge check goes to a reader with no path back to this conversation. Pick by what the
change is:

1. **CodeRabbit is the default, and you request it yourself.** Ping it once the diff is final *and*
   the required checks are green (see the section below for the exact mechanics and why timing
   matters). It is the only reviewer that is a *different tool* rather than a different context, so it
   does not share your model's blind spots — that is what makes it the first choice rather than the
   consolation prize.

   Its cost is *latency*, not the owner's budget: the plan is free but rate-limited, so a wasted slot
   delays the next review instead of billing anything. That is the opposite trade from `ultra` below,
   and it is why CodeRabbit is the default even on a small PR.
2. **If CodeRabbit is rate-limited, run the workflow-backed review yourself.** The owner has
   pre-authorized this skill's review step to spend it without asking each time — which is what
   separates it from `ultra` below. Do not sit out the window with no review at all.

   **You do not type the slash command; you invoke the workflow.** `/code-review
   [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<target>]` is the *owner's* surface. Yours
   is the `code-review` skill, and it resolves to exactly one call:

   ```text
   Workflow({ name: "code-review", args: "<level> <target>" })
   ```

   **`args` carries the level and the target and nothing else.** Verified in the binary: the command
   strips `--fix` and `--comment` before building `args`, and honours them by appending instructions
   to *its own caller* — they never reach the workflow. So there is no `--comment` to pass; posting
   findings onto the PR is something you do afterwards, by hand.

   **Your floor is `high`.** The level picks between two engines rather than turning one dial. `low`
   and `medium` return an inline review — this context, this model, your own work — which is the
   thing the top of this section forbids; they cannot satisfy the fresh-reader requirement however
   the findings read. Only `high`, `xhigh` and `max` route to the background workflow, and the fresh
   contexts it spawns are what make it a review at all. The gate also requires an interactive
   session, workflows enabled, and `Workflow` in the caller's own toolset — fail any one and it
   silently reviews inline instead, so a review that comes back instantly did not run.

   So choose the lowest of those three that fits the diff, not the one that sounds thorough. Measured
   on `high`: 688.6k tokens by the fifth of seventeen agents, ~2M for one PR. Upstream calls a run
   "large" at 25 agents or 1.5M projected tokens; `high`
   is already there. **One at a time, never as a batch**, and say the five-hour figure out loud before
   launching — read it rather than inferring it from the absence of a complaint. The `PreToolUse`
   budget guard matches the `Workflow` tool only, not `Agent` dispatches, and it fails open when it
   cannot read the budget; the `PostToolUse` advisor reports the figure periodically, not on every
   call. If the guard fires, that is the answer and not an obstacle to route around. On an
   already-merged PR the right answer is usually neither: the spend is real and the code has shipped.

   **The target is free text and carries instructions** — `focus on error handling`, `only review
   src/foo.ts` — as well as a PR number, branch, ref range or path. Everything after the level in
   `args` is passed through, so a scope restriction belongs there rather than in a follow-up message.

   It runs in the background: keep working, and report what survives with `ReportFindings`, once,
   most severe first — not as prose.

   **A subagent cannot run this for you.** `Workflow` is stripped from every subagent's toolset
   unconditionally — upstream documents it in the same filter as `AskUserQuestion` and `ExitPlanMode`
   — so no arrangement exists where a spawned reviewer invokes it. Only the main thread keeps it.
3. **A reviewer subagent** is the cheap option, and the one to prefer on a small diff. Give it the
   diff and the PR body — not your reasoning, which is the thing that would contaminate it.

   Dispatch from the roster you actually have, not from a name you remember: a plugin's agents
   register at session start, so one installed mid-session is absent here and present next session.
   Where no specialist fits, `general-purpose` with a specific brief does the job. Breadth is not the
   point; a second opinion on the part that could be wrong is.
4. **For a large or security-sensitive change, hand off to the owner for `/code-review ultra`.** It
   is user-triggered and billed and **you cannot launch it**, so this is a handoff, not a task.

   **Do not try anyway.** An agent that attempts `ultra` does not get an error — the fallback forces
   the level to `max` *and* turns off workflow routing, so you get a plain inline review that never
   touched the cloud. It looks like it worked. Report `ultra` as run and you are reporting something
   that did not happen.

   **`ultra` is not the default, and its cost is money.** It runs on Claude Code's web infrastructure
   in a remote sandbox and bills usage credits — roughly $5–$25 a review, after three free runs on
   Pro/Max and none free on Team or Enterprise. That is a different currency from everything above,
   which spends the rolling five-hour window instead. A fleet of cloud agents on an ordinary PR buys
   findings CodeRabbit already had. Reserve it for two cases:

   - a **large** diff — many files, or a change spanning workspaces, where no single reader holds all
     of it at once
   - a **security-sensitive** one: auth or session handling, permission or role checks, the redirect
     allowlist, request validation at an input boundary, secrets and env plumbing, upload or quota
     limits, CI/CD and ruleset config, or the rendering of user-supplied content

   Neither of those is a judgement call you get to skip when unsure — escalate, the cost of asking is
   one message. Adding `--fix` makes the cloud review apply its own findings locally — offer it only
   when the owner wants the fixes taken on trust, since it removes the step where you check each one.

   **The handoff is one pasteable line and nothing else:**

   ````
   ```
   /code-review ultra <pr-number>
   ```
   ````

   with the real number substituted in, never the placeholder. Bare `/code-review ultra` reviews the
   current branch against the default one and needs no GitHub remote — that is the form to give when
   there is no PR yet, and it takes a plain-words note: `/code-review ultra check my auth changes`.

   **A PR number takes no note alongside it.** Multi-word text is attached as a note only when it is
   not a branch name or PR reference; combine the two and the command is *rejected*, asking the owner
   to rerun with just the number or without it. So a PR handoff is the bare line above and nothing
   else. Put the focus in the PR body instead, under a `## Review focus` heading — the body is the
   reviewer's input either way, and a note never changes what gets reviewed, only what the findings
   are related to. Write it as claims to check, not as emphasis:

   - "Confirm `<file>` still states X after the trim; nothing mechanical reads it."
   - "Verify the guard fails closed when Y is absent — it was only tested passing."

   not "pay attention to `<file>`", which tells a reviewer nothing it was not already going to do.

**Options 1 to 3 are yours to run unaided; only 4 is a handoff.** Do not ask the owner to open a
fresh session and read the branch by hand — it buys nothing option 3 does not, same fresh context and
same model, and it costs them a session.

Whichever runs, its input is the PR body — which is why the section above matters. Triage its
findings the same way as CodeRabbit's below: verify each against the code before acting.

## Watching the checks

Every required check on `main` must report before merge is possible. Read the list from the ruleset
rather than from memory:

```sh
.claude/skills/ship-pr/scripts/required-checks.sh
```

`Images` exists because `Verify` is Vite and tsc only and never touches a Dockerfile — a dependency
can pass every other check while making the deployable image unbuildable.

A PR branched before a merge to `main` reports `BEHIND` and cannot merge until updated. `gh pr
update-branch <pr>` fixes it and re-runs every required check, so it is another full CI cycle —
budget for it rather than treating the first green as the last.

**Do not block the turn waiting.** `gh pr checks <pr> --watch` is one notification after *everything*
reports, so a `Verify` failure two minutes in stays invisible until the slowest job finishes ten
minutes later — you sit on a fixable red the whole time. Arm this under `Monitor` instead, which
notifies per occurrence; `--help` for its outputs and exit codes:

```sh
.claude/skills/ship-pr/scripts/watch-checks.sh <pr>
```

**Run them in parallel.** The checks watch and the CodeRabbit wait below are separate monitors armed
at the same time; neither has to finish before the other starts.

If a check fails for a reason unrelated to the diff (flake, infrastructure), say so explicitly rather
than silently re-running.

## CodeRabbit comments

CodeRabbit is **advisory and non-blocking**, and it is **not a required check** — it must never gate
a merge. Its comments are leads to verify against primary sources, never conclusions to act on.

"Non-blocking" never licenses merging with no review at all — when it is rate-limited, see "Wait out
the cooldown and re-ping" below.

### Ask for the review — it does not run automatically

`.coderabbit.yaml` sets `reviews.auto_review.enabled: false`. Comment **`@coderabbitai full review`**
once, when the diff is finished and every required check is green — batch every outstanding fix into
one push first, and never ping while CI is still running. A ping at PR-open is the common mistake:
the checks have not reported yet, so a red one arrives afterwards and the review you just spent
covers code you are about to change.

**The "✅ Action performed / Review finished" ack carries no information — not that a review ran, and
not that one failed.** It lands within seconds of *any* ping, identical every time, and CodeRabbit
then **edits that same comment** minutes later into the real outcome: the review, or a rate-limit
warning. Reading a fast ack as failure is how a real review gets missed; reading it as success is how
an unreviewed PR gets merged. **Confirm by state**, using the table under "Confirming a review
actually ran".

**CodeRabbit will not review a merged PR — there is no second chance.** A ping on one gets
`✅ Action performed` / `Full review finished.`, with no rate-limit marker and the count still at
baseline, while the walkthrough comment carries the real outcome in a collapsed block:

```text
Caution
Review failed
The pull request is closed.
```

So "Full review finished" is the text for a review that never started. A PR merged unreviewed is
unreviewed permanently — only `/code-review` or a fresh session on the merge commit is left — which
is the real cost of merging past a cooldown, and why the default below is to wait. Observed on a
merged PR; closing without merging, and reopening, are untested.

**The command form does not decide whether a review happens — the rate limit does.** `review` and
`full review` both trigger, and both are refused by the limit with `Review limit reached` on a window
that has not refilled. Do not go hunting for the magic wording when a ping produces nothing; check the
limit.

**One CodeRabbit review per PR**, not one per push. Once it has *reviewed*, that PR's budget is
spent: fix what it found, push, and merge on the required checks **without** asking it to look again.
A finding too large to fix inside this PR's scope becomes a follow-up PR with its own single review.
Every run spends a per-developer slot and Pro Plus limits are adaptive, so sustained pinging makes
them *tighter* — a wasted slot is not recoverable for minutes to hours.

**A refused ping does not count as the review.** Rate-limited means nothing was read, so re-pinging
after the cooldown is still the *first* review, not a second one. Only a ping that actually produced
a review spends the budget.

**A second ping is earned only by severity.** If the first review surfaced a real defect — silent
data loss, a security or auth hole, a correctness bug that ships wrong output — and its fix is
substantial rather than a one-liner, that fix is new code nothing has reviewed, and the second ping
is right. Seven nitpicks earn nothing; one data-loss bug with a real fix does. Say in the merge
report why you spent the slot.

### Rate limits, when you do hit one

**A passing CodeRabbit check does not mean the PR was reviewed.** A rate-limited run reports `pass`
with the literal text `Review rate limited` in the checks list — indistinguishable from "reviewed
clean" at a glance.

1. Check the summary comment for the marker
   (`gh pr view <pr> --json comments`, grep `rate limited`).
2. **The "Next review available in: N minutes" countdown is not a live clock**, so polling for the
   marker to vanish can wait forever and the deadline is the comment's **`updated_at` + N**, not
   `created_at` and not "now + N":

   ```sh
   .claude/skills/ship-pr/scripts/coderabbit-deadline.sh <owner/repo> <pr>
   ```

   A window that has already lapsed still reads "rate limited" — check the arithmetic before
   assuming you must keep waiting.

#### Wait out the cooldown and re-ping — do not merge unreviewed just because you were refused

A refusal is not a review. **Default to waiting**, and merge unreviewed only when waiting is the
thing that costs something. Two cases where waiting is clearly right:

- **The cooldown is short.** Under about 30 minutes, wait — that is cheaper than merging blind and
  cheaper than the follow-up PR a missed finding turns into.
- **The owner is asleep or away, or you are working an overnight batch.** Then wall-clock is free and
  there is nobody the delay inconveniences. Wait however long the window takes, even hours. Nothing
  merges into a review the owner will read in the morning anyway, so trading time for a real review
  is pure gain.

Merge unreviewed when the owner is actively waiting on this PR, or when it blocks other work, or the
window is long and the diff is trivial. Say which in the merge report.

To wait: compute the deadline with the `updated_at` + countdown arithmetic above, then **arm a
`Monitor` and carry on working.** This is the case `Monitor` is for — an outcome that arrives on
someone else's schedule, with no way to know which of five endings it will be.

```sh
.claude/skills/ship-pr/scripts/wait-coderabbit.sh <owner/repo> <pr>
```

Start it **before** posting the ping: it records the review-count baseline and the `since=` timestamp
first, and both have to predate the ping. `--help` carries why, and every terminal outcome it prints.

Then re-ping **once**, after the deadline has actually passed, and confirm with the three signals
below. If that ping is refused again, the window was longer than advertised: recompute from the new
comment's `updated_at` and wait again. Two refusals in a row on a lengthening window is the point to
stop waiting and merge with the gap stated — which is choosing an unreviewed merge permanently, not
deferring one.

Cooldowns here have run to minutes, not hours, and a five-minute wait has bought a review that found a
real defect. Waiting is usually the cheap side of this trade.

### Confirming a review actually ran

**Do not count inline comments.** Findings can arrive as "outside diff range" body text with no
inline comment at all, so read the newest review's **body** too. Read instead: the review count
against the baseline you recorded before pinging (`scripts/review-count.sh`), unresolved threads
(`reviewThreads` via GraphQL, `isResolved == false`), and the summary comment's markers.

**Every outcome a ping can have.** The count rises for exactly one of them, so a loop keyed on the
count alone hangs on all the others. The first five are measured here; the rest are read from
upstream and marked as such.

| Outcome | How you know | Ends the wait? |
| --- | --- | --- |
| Reviewed, findings | count > baseline | yes — triage them |
| Rate-limited | `rate limited by coderabbit.ai` | yes — cool down, re-ping |
| Merged PR | `Review failed` / `The pull request is closed` | yes — CodeRabbit is done, forever |
| Head moved mid-review | `Review failed` / `The head commit changed during the review from <a> to <b>` | yes — see below |
| Ping never registered | `Review skipped` / `Auto reviews are disabled` posted *after* your ping | yes — re-ping, nothing was spent |
| Nothing reviewable | `did not have any reviewable changes` | yes — that *is* the review |
| Still running | `review in progress by coderabbit.ai` | no — keep waiting |
| Reviewed clean | count > baseline, no findings *(unobserved — assumed to raise the count like any other review)* | yes |
| Draft PR | *(unverified: `drafts` defaults false, so drafts are excluded from auto-review; whether an explicit ping overrides that is untested — mark the PR ready before pinging)* | — |

**A ping can be swallowed with no marker at all.** Observed here: `@coderabbitai review` drew no ack
and no review, while the PR-open `Review skipped` notice sat above it looking like a reply. The
discriminator is whether a CodeRabbit comment's `updated_at` moves *after* your ping — filter on
that, not on the comment list. Re-pinging costs nothing when the count never rose, because nothing
was read.

**Do not push while a review may still be finishing.** The review body can land minutes before
CodeRabbit is actually done, and a push in that window aborts the rest with
`Review failed / The head commit changed during the review from <a> to <b>`. Confirm the findings you
have match the body's `Actionable comments posted: N` before pushing anything.

`Review skipped` carries opposite meanings on its two surfaces. In the **checks list** it is the
nothing-happened state; in the **summary comment**, followed by `did not have any reviewable
changes`, it is a finished review of a diff with nothing in it — a pure deletion earns that, and its
count never moves.

The rest of `.coderabbit.yaml`'s skip triggers cannot fire here: no `path_filters`, `base_branches`
or `ignored_titles` are configured, and the auto-pause after N reviewed commits applies to
incremental auto-review, which is off.

**A zero read once is not an answer.** The count sits at the baseline for as long as the review takes,
so an early zero is indistinguishable from "never ran". Do not report the outcome of a review still in
flight — say it is still running, or wait.

**Reply to every item** — the ones you fixed, the ones you refuted, and the ones you are deliberately
not acting on. A thread with no reply is indistinguishable from a thread nobody read, and the owner
cannot tell which from the outside.

1. Check the claim against the actual code yourself.
2. If it is right, fix it and say so in the reply.
3. If it is wrong, reply with the evidence. Do not apply a change you cannot justify independently
   just to clear a comment. It concedes to a demonstrated counterexample, so the reply is worth
   writing properly rather than just dismissing.
4. If it is a matter of taste that contradicts a documented convention in `AGENTS.md`, the
   convention wins — link it in the reply.

**Then push the fixes and watch the threads — do not ping again.** The push earns no new review, but
CodeRabbit *does* answer replies on individual threads, and that answer is where it either concedes
or produces a counterexample you have not seen. A reply that raises something new is a finding in its
own right. The thread you argued and then stopped reading is the one that costs you.

```sh
.claude/skills/ship-pr/scripts/watch-threads.sh <owner/repo> <pr> <since>
```

`<since>` is a UTC timestamp from before you replied, e.g. `2026-07-31T18:04:00Z`. It reads
`pulls/.../comments` — review-thread replies, a different endpoint from the `issues/.../comments` the
summary comment lives in. Arm it as a `Monitor` if you would rather the reply found you; `--help` for
the rest.

Do not let an unresolved advisory comment block a merge. Do let a real defect it surfaced block one.

## Merging

Merge once every required check is green, **a fresh reader has reviewed the branch**, and review
comments are handled. Report what actually happened: which checks ran, who reviewed and how, what
was raised and how each was resolved, and anything left undone.

The fresh-reader precondition has exactly three exceptions, every one of them about a reviewer being
*unavailable* rather than unnecessary: the owner is actively waiting on this PR, the PR blocks other
work, or CodeRabbit's cooldown is long and the diff trivial. A rate-limited CodeRabbit on its own is
not one of them — that is a reason to *wait*, and the arithmetic is under "Wait out the cooldown and
re-ping". Taking an exception means naming which in the report.

Name the reviewer too: CodeRabbit, `/code-review` or a subagent because CodeRabbit was rate-limited,
or `/code-review ultra` because the change was large or security-sensitive. If none happened, say so
outright rather than letting "checks green" stand in for "reviewed" — and say it if you spent a
second CodeRabbit review, with why the findings earned it.

**Merging is the point of no return for CodeRabbit** — "review now or not at all", never "review now
or review later" (see "Ask for the review"). That is what makes the exceptions above narrow.

`gh pr merge` may print `fatal: 'main' is already used by worktree at ...` when run from a worktree.
That is `gh` failing to check out `main` locally *after* merging; confirm with
`gh pr view <pr> --json state` rather than assuming the merge failed.

## After the merge: strike the shipped line from `.notes/`

This is the owner's scratch file on disk, not the harness task list — that one is yours and is
already finished by now.

If the owner started this session by pointing at a `*.todo.md` in `.notes/issues/`, delete the
line(s) the merged work completed from that file once the PR is merged — not before. Leaving a
shipped item on the list is what makes the list stop being trusted.

Scope rules:

- Only when the task was **initiated from** a todo file. Do not go hunting for entries that happen
  to resemble what you shipped.
- Delete only what the merge actually finished. If the item was partially addressed, leave the line
  in place and add an indented sub-bullet under it recording the status — what shipped, what is
  left, and the PR number. Never rewrite the original line — the owner wrote it and it stays their
  wording.
- `.notes/` is gitignored, so this is a local scratch edit with nothing to commit or push. Do not
  add it to the PR and do not stage it.
- Name the exact line(s) you removed or annotated in your final report.

## When to stop and ask

- A required check is red for a reason you cannot fix inside the PR's scope.
- CodeRabbit surfaced something that implies a design decision rather than a fix.
- The change turns out to need a dependency, tooling, or architectural choice — those are the
  owner's call, presented as options with a recommendation.
- Merging would land something the owner has not seen and would plausibly object to.
