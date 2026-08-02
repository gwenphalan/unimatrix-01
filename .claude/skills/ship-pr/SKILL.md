---
name: ship-pr
description: Take a task all the way to merged. Use at the start of any session whose end state is a merge — given the task itself, or a pointer to a .notes/todo/*.todo.md. Carries the ordered steps — plan through a subagent, attack the plan, get approval, implement through a subagent, check in, then PR, review and merge — plus the PR body a fresh reader can review from, the review ladder and its costs, and striking the shipped line from .notes/.
---

# Ship a PR

## How this is invoked

**The owner types this at the *start* of a session, not the end.** The argument is either the
task in their own words, or a pointer to a `.notes/todo/*.todo.md` — sometimes just the file,
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
7. **Arm `watch-pr.sh`** — it waits for every required check, pings CodeRabbit once they are green,
   and arms auto-merge on a clean review. Dispatch `pr-signal-collector` alongside it for the
   findings that never reach the checks list. **Wait for the watcher to report before handing the
   PR to a fresh reader** — it runs under `Monitor`, so it is still working while you read this
   line, and a reader dispatched now gets a branch whose checks have not reported. If that fresh
   reader *is* the pre-merge review, run with `SHIP_PR_AUTO_MERGE=0`, or the PR can merge out from
   under it.
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

**To move an agent off its default tier, name an effort skill in the dispatch prompt.** Each agent's
`effort:` frontmatter is fixed for every dispatch — the `Agent` tool takes a `model` parameter but no
`effort` one — so "tell it to invoke `effort-xhigh` first" is the only per-dispatch lever, and a
skill's effort outranks the agent's. Raising it is the case worth remembering: `monorepo-implementer`
sits at `medium`, which is right for following an approved plan and thin for a large one.

`CLAUDE_CODE_EFFORT_LEVEL` outranks both, so where it is set the knob is inert and nothing says so —
check the environment before concluding a dispatch ran at the level you asked for.

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
   `.notes/todo/*.todo.md` line, quote the line.
2. **Why, before what.** Lead with the problem — what was wrong, what it cost, why the obvious
   alternative was not taken. The *what* follows from it and is usually the shorter half. If a
   decision has a non-obvious reason (an ordering that prevents a silent no-op, a hook owned by one
   component because two copies would desync), that reason belongs in the body; it is exactly what
   a reviewer cannot reconstruct and will otherwise flag as arbitrary.
3. **What you could not verify.** Plainly. If a fix is precautionary rather than demonstrated, say
   so — do not let it read as a proven fix.

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
even when its own workflow succeeds, so "the PR opened without complaint" tells you nothing yet. For
CodeRabbit that wait belongs to `watch-pr.sh` and you arm it straight away; for any of the other three
readers below, it is on you.

So the pre-merge check goes to a reader with no path back to this conversation. Pick by what the
change is:

1. **CodeRabbit is the default, and you request it yourself** — by arming `watch-pr.sh`, which waits
   for the required checks to go green and then posts the ping. Arm it once the diff is final; the
   waiting for green is the script's job, not yours (see the section below for the exact mechanics
   and why the timing matters). It is the only reviewer that is a *different tool*
   rather than a different context, so it
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
   call. Both are registered in the owner's `~/.claude/settings.json`, not in this repo — a fresh
   clone has neither, and nothing here verifies they are installed. If the guard fires, that is the
   answer and not an obstacle to route around. On an
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

Every required check on `main` must report before merge is possible. Read the list from the rules
GitHub says apply to the branch rather than from memory:

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
minutes later — you sit on a fixable red the whole time. **Arm this under `Monitor`, not `Bash` with
`run_in_background`** — background Bash notifies once, when the script exits, which is the same
blindness by a different route. `Monitor` is a deferred tool, so its own guidance on which to pick is
not in context until you fetch it; that is why the choice is stated here rather than left to it. One
stream now carries both the check results and the review outcome, which makes that choice matter
more, not less. `--help` for the script's outputs and exit codes:

```sh
.claude/skills/ship-pr/scripts/watch-pr.sh <owner/repo> <pr>
```

**The checks come before the ping, and that is the script's property rather than your instruction.**
A ping fired while CI is still running spends a slot on code a red check is about to change, so
`watch-pr.sh` refuses to post one until every context `required-checks.sh` names has reported green.
The gate is the *required* list specifically: `gh pr checks` reports only what exists on the head
commit, so a fast third-party app answering first makes a partial list look complete, and a red
non-required check would hold back a ping that should go out. A red required check, a `BEHIND` or
`DIRTY` branch, and a draft PR each end the run without pinging.

It stops watching the checks at the ping. A required check that goes red *after* auto-merge is armed
means GitHub holds the merge indefinitely, and nothing reports that — so a PR that has been armed and
has gone quiet is worth one look at.

If a check fails for a reason unrelated to the diff (flake, infrastructure), say so explicitly rather
than silently re-running.

## CodeRabbit comments

CodeRabbit is **advisory and non-blocking**, and it is **not a required check** — it must never gate
a merge. Its comments are leads to verify against primary sources, never conclusions to act on.

"Non-blocking" never licenses merging with no review at all — when it is rate-limited, see "Wait out
the cooldown and re-ping" below. The four cases that do license one are listed there, along with the
flag that carries them out.

### Ask for the review — it does not run automatically

`.coderabbit.yaml` sets `reviews.auto_review.enabled: false`, so a review happens only when asked
for. **Ask by arming `watch-pr.sh` — it posts `@coderabbitai full review` itself.** Do not type the
ping as well; the section below covers what a second ping costs.

Arm it once, when the diff is finished — batch every outstanding fix into one push first. Arming
before the diff is settled is the mistake that survives: the script will not ping ahead of green, but
it will happily ping a diff you are about to change again, and that slot is spent.

**The "✅ Action performed / Review finished" ack carries no information — not that a review ran, and
not that one failed.** It lands within seconds of *any* ping, identical every time, and it is **not**
edited afterwards: measured on PR #185, the ack body was byte-identical before and after the review,
and the outcome landed in a separate summary comment. So watching the ack for a change waits forever.
Reading a fast ack as failure is how a real review gets missed; reading it as success is how an
unreviewed PR gets merged. **Confirm by state**, using the tables under "Confirming a review actually
ran".

The one thing the ack does carry is a receipt: `<!-- CodeRabbit review command invocation: <uuid> -->`
in its body, one per ping. Two acks with different uuids are two pings.

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
Every run spends a per-developer slot, and a wasted slot is not recoverable for minutes to hours.
(*Unverified*: that this installation is on Pro Plus, and that its limits are adaptive so sustained
pinging makes them tighter. `@coderabbitai configuration` on an open PR reports the plan; nobody has
run it here.)

**A refused ping does not count as the review.** Rate-limited means nothing was read, so re-pinging
after the cooldown is still the *first* review, not a second one. Only a ping that actually produced
a review spends the budget.

**A second ping is earned only by severity.** If the first review surfaced a real defect — silent
data loss, a security or auth hole, a correctness bug that ships wrong output — and its fix is
substantial rather than a one-liner, that fix is new code nothing has reviewed, and the second ping
is right. Seven nitpicks earn nothing; one data-loss bug with a real fix does. Say in the merge
report why you spent the slot.

### Rate limits, when you do hit one

**A passing CodeRabbit check does not mean the PR was reviewed — the bucket never tells you.** It is
`pass` either way. The signal lives in the check's *description*, and only there. Measured on the
same PR, before and after a manual ping:

| Description | What actually happened |
| --- | --- |
| `Review skipped: automatic reviews are disabled` | nothing ran — `.coderabbit.yaml` sets `auto_review.enabled: false`, so this is every PR's resting state |
| `Review completed` | a review ran |

This is the same commit status tabled in full under "Confirming a review actually ran" below, seen
through the checks list instead of the API.

So a green `CodeRabbit` row read at a glance is the thing most likely to wave an unreviewed merge
through, and reading it *early* is how you conclude the check is meaningless — it is not, it is just
stale until a review finishes. `watch-pr.sh` prints the description alongside the bucket for this
reason. Every other check here has an empty one, so the annotation appears only where it carries
information. The `CodeRabbit` row is deliberately not part of that script's green gate — it is `pass`
on every PR, so gating on it would be reading the signal the review wait exists to discriminate.

Confirm a review from the review itself regardless; the description says one ran, not what it found.

(A rate-limited run is documented upstream as reporting `pass` with the text `Review rate limited`.
That exact string has not been observed here — treat it as read, not measured.)

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

Merge unreviewed when the owner is actively waiting on this PR, when it blocks other work, when the
window is long and the diff is trivial, or when the owner asks for an unreviewed merge outright. Say
which in the merge report.

**Carry that out with `watch-pr.sh --no-review`, never with a merge you assemble yourself.** It waits
for the required checks and then arms auto-merge with no ping and no review wait — and it still ends
on a `BEHIND` or `DIRTY` branch, still declines on a draft PR, on unresolved review threads and on a
PR state it could not read, and still pins the arm to the head sha it saw. A hand-rolled `gh pr
merge` skips every one of those, which is the actual risk of leaving this path unsupported: the
review gets skipped either way, and the improvised version drops the guards as well.

So the flag is not a fifth case, and it excuses nothing. It is how the four above are done, and it
prints `auto-merge armed UNREVIEWED on <sha>` rather than the clean-review line, because an
unreviewed merge is unreviewed permanently. `SHIP_PR_AUTO_MERGE=0` outranks it, for when you want the
wait skipped but the merge left to a person.

To wait: **arm a `Monitor` and carry on working.** This is the case `Monitor` is for — an outcome that
arrives on someone else's schedule, with no way to know which of five endings it will be.

```sh
.claude/skills/ship-pr/scripts/watch-pr.sh <owner/repo> <pr>
```

**Arm it and do not ping — it pings for you.** It waits for the required checks first, then pins the
head sha and takes the review-count baseline, then posts `@coderabbitai full review` and records
GitHub's own timestamp for it. The baseline is taken after the wait rather than at arm time, so a
review that lands during CI cannot be read as one the ping produced. That
timestamp is the whole discriminator afterwards, which is why the ping has to be the script's: a
manual one alongside it is a second slot spent, and it moves the marker the script does its cooldown
arithmetic on, so the automatic re-ping then fires early into a live window and burns the retry cap
on a refusal.

A cooldown that is already live when you arm it is ridden out *before* the first ping, so the ping is
spent on the far side of it. That first ping does not consume the retry: the cap counts refusals
absorbed, not pings posted. If its one automatic re-ping is refused too, it stops and says so — the
window was longer than advertised. Two refusals in a row on a lengthening window is the point to stop
*waiting*; it is not itself a reason to merge. That still turns on the exceptions above, and where
none of them holds it is the owner's call, because merging forfeits the review permanently rather
than deferring it.

The one case where the ping is yours: `SHIP_PR_AUTO_REPING=0` on a PR whose cooldown is live at arm
time. It says so and exits without posting anything. `--help` carries every outcome it prints.

Cooldowns here have run to minutes, not hours, and a five-minute wait has bought a review that found a
real defect. Waiting is usually the cheap side of this trade.

### Confirming a review actually ran

**Do not count inline comments.** Findings can arrive as "outside diff range" body text with no
inline comment at all, so read the newest review's **body** too. Read instead: the review count
against the baseline taken before the ping
(`.claude/skills/ship-pr/scripts/review-count.sh`), unresolved threads
(`reviewThreads` via GraphQL, `isResolved == false`), and the summary comment's markers.

**Replying to findings inflates the count, and `review-count.sh` filters that out.** CodeRabbit
files a review object for every thread reply it posts, so its acknowledgement of your reply raises
the raw count without any review having run. Measured on PR #187: the raw count read 11 where three
reviews had actually happened, and a genuinely **clean** third review was reported as
`reviewed: 10 -> 11` — the arm that means "it found something", which is why auto-merge never fired.
The script now counts only reviews carrying a body. If you read the count by hand, apply the same
filter.

**The count only moves when there were findings.** A review that comes back clean leaves it exactly
where it was, so `count == baseline` is ambiguous between "still running", "never ran" and "ran and
found nothing" — and only the summary comment tells them apart. Never treat a flat count as evidence
either way.

**Every outcome a ping can have.** The count rises for exactly one of them, so a loop keyed on the
count alone hangs on all the others. Everything but the last row is measured here; that one is read
from upstream and marked as such.

| Outcome | How you know | Ends the wait? |
| --- | --- | --- |
| Reviewed, findings | count > baseline — counting only reviews with a **body**, see above | yes — triage them |
| Reviewed clean | `No actionable comments were generated in the recent review` — **count stays at baseline** | yes |
| Rate-limited | `rate limited by coderabbit.ai` | yes — cool down, re-ping |
| Merged PR | `Review failed` / `The pull request is closed` | yes — CodeRabbit is done, forever |
| Head moved mid-review | `Review failed` / `The head commit changed during the review from <a> to <b>` | yes — see below |
| Ping never registered | the commit status below reads `Review skipped: ...` with an `updated_at` **later than** the ping | yes — re-ping, nothing was spent |
| Nothing reviewable | `did not have any reviewable changes` | yes — that *is* the review |
| Still running | `review in progress by coderabbit.ai` | no — keep waiting |
| Draft PR | *(unverified: `drafts` defaults false, so drafts are excluded from auto-review; whether an explicit ping overrides that is untested — mark the PR ready before pinging)* | — |

**The best signal in this section is a commit status, and it is not in the checks list you read from
`required-checks.sh`.** CodeRabbit posts one on the head sha through the legacy status API, context
`CodeRabbit`. Read it combined, which returns the latest per context:

```sh
gh api "repos/<owner>/<repo>/commits/<head-sha>/status" \
  --jq '.statuses[] | select(.context=="CodeRabbit") | "\(.updated_at) \(.description)"'
```

| Description | What it means |
| --- | --- |
| `Review queued` | accepted, nothing started |
| `Review in progress` | running |
| `Review skipped: automatic reviews are disabled`, `updated_at` **before** your ping | this repo's resting state, on every PR from the moment it opens |
| `Review skipped: ...`, `updated_at` **after** your ping | the ping was swallowed |
| `Review completed` | it stopped — read the summary comment for what it found |

Three traps. **`state` is useless**: measured `success` for both the skip and the completion, so
never branch on it — the `updated_at` is the whole discriminator. **Statuses are per head sha**, so
pin the sha you pinged on; a push landing after the review leaves the new head carrying only the
resting skip. And the vocabulary is **undocumented** — four descriptions across two PRs, absent from
the yaml reference, the commands guide and the plans page — so treat an absent context as "fall back
to the summary comment", not as an answer.

**The waiter can merge for you on the clean row, and only that row.** It arms GitHub's native
auto-merge by default when the review comes back clean, pinned with `--match-head-commit` to the sha
that was reviewed; GitHub then squashes once every required check passes, so nothing here re-verifies
green or races a branch that goes `BEHIND`. A push landing between the review and the arm makes the
arm fail outright — measured, see below — but a push landing *after* a successful arm is a case
nothing here has established, so do not read this as a standing guarantee. It declines to arm on a
draft PR, on any unresolved review
thread, and on a PR state it could not read. `SHIP_PR_AUTO_MERGE=0` turns it off. No other row
qualifies: a refusal read nothing, a review with findings is not clean, and `did not have any
reviewable changes` is an unreviewed merge in a clean one's clothes.

**That `--match-head-commit` pin is the whole safety argument for the default being on, and both its
paths are now measured.** Controlled pair on PR #187 — same command, same PR state (checks pending,
`BLOCKED`), only the sha differing. Pinned to a **stale** sha it was refused, `GraphQL: Pull Request
is not mergeable`, with `autoMergeRequest` left `null`; pinned to the **current** head it armed. So
`expectedHeadOid` is enforced when auto-merge is *enabled*, and an arm attempted after a push simply
does not take.

What that does **not** settle is a push landing *after* a successful arm — enable-time enforcement
says nothing about merge time, and GitHub's docs promise an auto-disable only for a pusher **without**
write permission, which is never us. Treat a long-armed PR as worth a glance rather than trusted.
Also unmeasured: whether GitHub's auto-merge updates an
out-of-date branch by itself. Read as no, and the failure direction is benign either way — a
self-update moves the head sha, which cancels the arm rather than merging anything.

**And the watcher stops reading the checks at the ping.** Once auto-merge is armed, a required check
going red leaves GitHub holding the merge indefinitely with nothing reporting it. An armed PR that
has gone quiet for longer than a CI cycle is worth `gh pr checks` by hand.

**A ping can be swallowed with no marker at all.** Observed here: `@coderabbitai review` drew no ack
and no review, while the PR-open `Review skipped` notice sat above it looking like a reply. The
discriminator is time, not position — whether the status or a CodeRabbit comment was written *after*
your ping. Re-pinging costs nothing when the count never rose, because nothing was read.

**Do not push while a review may still be finishing.** The review body can land minutes before
CodeRabbit is actually done, and a push in that window aborts the rest with
`Review failed / The head commit changed during the review from <a> to <b>`. Confirm the findings you
have match the body's `Actionable comments posted: N` before pushing anything.

`Review skipped` carries opposite meanings on its two surfaces. In the **checks list** it is the
nothing-happened state; in the **summary comment**, followed by `did not have any reviewable
changes`, it is a finished review of a diff with nothing in it — a pure deletion earns that, and its
count never moves.

`did not have any reviewable changes` is therefore **reachable on a normal PR**, not only on a pure
deletion: `.coderabbit.yaml` sets `reviews.path_filters` excluding generated paths, so a PR touching
only those has nothing left for CodeRabbit to read. Read that outcome as a real answer, not a fault.
The other skip triggers still cannot fire here — no `base_branches` or `ignored_titles` are
configured, and the auto-pause after N reviewed commits applies to incremental auto-review, which is
off.

**A zero read once is not an answer — and a zero read forever is not one either.** The count sits at
the baseline for as long as the review takes, so an early zero is indistinguishable from "never ran".
But a clean review never moves it, so waiting for it to rise can outlast the review by the whole
timeout. Both readings are settled the same way: by the summary comment, not the count. Do not report
the outcome of a review still in flight — say it is still running, or wait.

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

The fresh-reader precondition has exactly four exceptions. Three are about a reviewer being
*unavailable* rather than unnecessary: the owner is actively waiting on this PR, the PR blocks other
work, or CodeRabbit's cooldown is long and the diff trivial. The fourth is the owner asking for an
unreviewed merge outright — theirs to ask for, and the reason `watch-pr.sh --no-review` exists rather
than a merge command an agent invents on the spot. A rate-limited CodeRabbit on its own is not one of
them — that is a reason to *wait*, and the arithmetic is under "Wait out the cooldown and re-ping".
Taking an exception means naming which in the report, and running it through `--no-review`, which
keeps the merge preconditions the review path applies.

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

If the owner started this session by pointing at a `*.todo.md` in `.notes/todo/`, delete the
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
