---
name: ship-pr
description: Run a task end to end and ship it — commit in logical steps as you go, and once the owner confirms the work is in order, open a PR with a body a fresh reader can review from, ping CodeRabbit, fall back to a reviewer subagent if it is rate-limited, escalate to the owner for /code-review ultra when the change is large or security-sensitive, watch the required checks, triage findings, merge once genuinely green, and clear the originating .notes/issues todo entry. Invoked at the start of a session with either the task itself or a pointer to a .todo.md.
---

# Ship a PR

The owner invokes or implies this instead of typing "pr, merge, monitor, respond to review comments, then merge
when ready" every session. Read that as: take it all the way to merged, come back only when you need
a decision or when something is actually wrong.

## How this is invoked

**This is normally called at the *start* of a session, not the end.** The argument is either the
task in the owner's own words, or a pointer to a `.notes/issues/*.todo.md` — sometimes just the file,
meaning "the first unfinished item on it". Resolve that before doing anything: read the file, and if
the target is ambiguous, name the line you are about to implement and say so rather than guessing.

Because you are invoked before the work exists, the whole arc is yours: implement, then ship. Two
things follow from that.

**Commit in logical steps as you go, not in one lump at the end.** Each commit should be a coherent
unit a reviewer could read on its own — the rename, then the test fixtures, then the doc correction.
Conventional commits throughout. This is what makes a large diff reviewable and what lets a single
bad decision be reverted without unpicking the rest. Do not batch unrelated work into one commit to
save time; do not split one change across commits that each leave the tree broken.

**The PR waits for the owner's confirmation.** Finish the work, run the checks, report what you did
and what you could not verify — then stop. When the owner confirms everything is in order, open the
PR and take it through review and merge without further checkpoints. "Confirmed" means they said so;
a lack of objection is not confirmation.

## Before opening anything

`main` accepts changes by pull request only. If the work is sitting on `main`, branch first — do not
push to `main` under any circumstances.

Run the narrowest relevant checks for what changed before opening the PR, not after. `pnpm check` is
the normal gate; `pnpm verify` when the change spans workspaces or touches runtime/build behavior.
A PR opened red wastes a CI cycle and buries the real signal.

**If the change touches `apps/web`, `apps/cflop`, `apps/auth`, `apps/admin`,
`packages/ui` or `packages/chrome`,
it must be live-tested in a real browser before the PR is opened**, not after CI goes green. Launch
Chromium if none is running.

## Opening it

**Write the title and body for a person, not for a changelog generator.** The owner works in
PM-mode and does not read diffs line by line, and — see the next section — the pre-merge review is
done by a reader with no access to this conversation. Both of them get the PR body and nothing else.
A body that only lists what changed is unreviewable: it gives them no way to tell correct from
plausible.

Conventional commit for the title, and the scope after the type is the workspace or surface, not a
file. The rest of the title should read as a sentence a human would say — what the change makes
true, not which symbols moved.

```
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

End the commit message with the attribution header for the acting agent.

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

So the pre-merge check goes to a reader with no path back to this conversation. Pick the reviewer by
what the change is, not by what is cheapest:

1. **CodeRabbit is the default, and you request it yourself.** Ping it once the diff is final *and*
   the required checks are green (see the section below for the exact mechanics and why timing
   matters). It is the only reviewer that is a *different tool* rather than a different context, so it
   does not share your model's blind spots — that is what makes it the first choice rather than the
   consolation prize.

   Its cost is *latency*, not the owner's budget: the plan is free but rate-limited, so a wasted slot
   delays the next review instead of billing anything. That is the opposite trade from `ultra` below,
   and it is why CodeRabbit is the default even on a small PR.
2. **If CodeRabbit is rate-limited, fall back to a reviewer subagent from this session.** Do not sit
   and wait out the window, and do not merge with no review at all. Give the subagent the diff and
   the PR body — not your reasoning, which is the thing that would contaminate it. Say in the merge
   report that the review came from a subagent and why.
3. **For a large or security-sensitive change, hand off to the owner for `/code-review ultra`.** It
   is user-triggered and billed and **you cannot launch it**, so this is a handoff, not a task.

   **`ultra` is not the default.** Its cost is not money — it is the owner's rolling five-hour
   session window and weekly limit, neither of which reports a precise remaining balance. So the cost
   is real, paid by them, and hard for either of you to see: a fleet of agents spent on an ordinary PR
   can eat into shipping the next one, for findings CodeRabbit already had. Reserve it for two cases:

   - a **large** diff — many files, or a change spanning workspaces, where no single reader holds all
     of it at once
   - a **security-sensitive** one: auth or session handling, permission or role checks, the redirect
     allowlist, request validation at an input boundary, secrets and env plumbing, upload or quota
     limits, CI/CD and ruleset config, or the rendering of user-supplied content

   Neither of those is a judgement call you get to skip when unsure — escalate, the cost of asking is
   one message. `/code-review` also takes cheaper levels (`low` through `max`) if a middle option
   fits better than either extreme, and `/review` is the local alternative that spends nothing in the
   cloud. Adding `--fix` makes the cloud review apply its own findings locally — offer it only when
   the owner wants the fixes taken on trust, since it removes the step where you check each one.

   **The handoff is one pasteable line and nothing else:**

   ````
   ```
   /code-review ultra <pr-number>
   ```
   ````

   with the real number substituted in, never the placeholder. The bare `/code-review ultra` reviews
   the current branch, which is the form to give when there is no PR yet.

   **Do not write "look hardest at X" in the chat message.** The command's only argument is a PR
   number — it cannot carry instructions, so anything you say in chat reaches the reviewer only if
   the owner retypes it. Put the focus in the PR body instead, under a `## Review focus` heading,
   because the body *is* the reviewer's input. Write it as claims to check, not as emphasis:

   - "Confirm `<file>` still states X after the trim; nothing mechanical reads it."
   - "Verify the guard fails closed when Y is absent — it was only tested passing."

   not "pay attention to `<file>`", which tells a reviewer nothing it was not already going to do.

A fresh session on the branch is a fine substitute for 2 when you have one available: same property,
one model instead of a fleet.

Whichever runs, its input is the PR body — which is why the section above matters. Triage its
findings the same way as CodeRabbit's below: verify each against the code before acting.

The residual risk to state rather than paper over: a subagent or a fresh Claude session shares your
model priors and therefore your blind spots. Independence of *tool* is a different axis from
independence of *context*, and only CodeRabbit and `/code-review ultra` supply the first.

## Watching the checks

Every required check on `main` must report before merge is possible. Read the list from the ruleset
rather than from memory:

```
gh api repos/<owner>/<repo>/rulesets/<id> \
  --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
```

`Images` exists because `Verify` is Vite and tsc only and never touches a Dockerfile — a dependency
can pass every other check while making the deployable image unbuildable.

A PR branched before a merge to `main` reports `BEHIND` and cannot merge until updated. `gh pr
update-branch <pr>` fixes it and re-runs every required check, so it is another full CI cycle —
budget for it rather than treating the first green as the last.

Poll with a real wait, not a tight loop:

```
gh pr checks <pr> --watch
```

**A red check is the signal, not an obstacle.** Never merge around one, never re-run it hoping for a
different answer, and never disable it. Read the failure, fix the cause, push. If a check fails for
a reason unrelated to the diff (flake, infrastructure), say so explicitly rather than silently
re-running.

## CodeRabbit comments

CodeRabbit is **advisory and non-blocking**, and it is **not a required check** — it must never gate
a merge. Its comments are leads to verify against primary sources, never conclusions to act on.

"Non-blocking" never licenses merging with no review at all: if it is late or rate-limited, take the
subagent fallback above and merge on the required checks rather than waiting the window out. Waiting
on CodeRabbit specifically is worth it only when a bad merge is expensive to unwind: auth, the API
contract, `packages/*`.

### Ask for the review — it does not run automatically

`.coderabbit.yaml` sets `reviews.auto_review.enabled: false`. Comment `@coderabbitai review`
**once, when the diff is finished and every required check is green** — not while you are still
pushing, and not while CI is still running. A ping at PR-open is the common mistake: the checks have
not reported yet, so a red one arrives afterwards and the review you just spent covers code you are
about to change.

**One CodeRabbit review per PR** — not one per push. Once you have pinged it, that PR's CodeRabbit
budget is normally spent: fix what it found, push the fixes, and merge on the required checks
**without** asking it to look again. A finding too large to fix inside this PR's scope becomes a
follow-up PR with its own single review, not a second ping here.

**Unless the findings were severe.** If the first review surfaced a real defect — silent data loss,
a security or auth hole, a correctness bug that ships wrong output — and the fix for it is
substantial rather than a one-liner, then the fix is itself new code that nothing has reviewed, and
a second ping is the right call. Say in the merge report why you spent the second slot. The bar is
the severity of what was *found*, not the number of comments: seven nitpicks earn no second review,
one data-loss bug with a real fix does.

Every run spends a per-developer rate-limit slot, and Pro Plus limits are adaptive — sustained
pinging makes them *tighter*.

So the ping has to be worth its one shot: **batch every fix into one push before it**, and do not
ping while anything is still in flight. Getting this wrong does not cost you a slow PR — it costs you
the review.

### Rate limits, when you do hit one

**A passing CodeRabbit check does not mean the PR was reviewed.** A rate-limited run reports `pass`
with the literal text `Review rate limited` in the checks list — indistinguishable from "reviewed
clean" at a glance.

1. Check the summary comment for the marker
   (`gh pr view <pr> --json comments`, grep `rate limited`).
2. **The "Next review available in: N minutes" countdown is not a live clock.** It is rewritten only
   when CodeRabbit *runs*, so polling for the marker to vanish can wait forever, and the number is
   whatever was true at the comment's last edit. Compute the deadline as the comment's
   **`updated_at` + N**, not `created_at`, and not "now + N":

   ```
   gh api repos/<owner>/<repo>/issues/<pr>/comments --jq '
     [.[] | select(.user.login=="coderabbitai[bot]" and (.body | contains("rate limited by coderabbit.ai")))]
     | last
     | (.body | capture("Next review available in:[^0-9]*(?<n>[0-9]+) (?<u>[a-z]+)")) as $c
     | "updated=\(.updated_at) countdown=\($c.n) \($c.u)"'
   ```

   A window that has already lapsed still reads "rate limited" — check the arithmetic before
   assuming you must keep waiting.
3. The "✅ Review finished" ack lands seconds after **any** ping and proves nothing. A ping inside
   the window gets the ack and no review.

### Confirming a review actually ran

Do not count inline comments. Findings can arrive as **"outside diff range" body text with no inline
comment at all**. Use instead:

- the CodeRabbit **review count** rising above the baseline you recorded before pinging
  (`gh api repos/<owner>/<repo>/pulls/<pr>/reviews`), and
- **unresolved review threads** (`reviewThreads` via GraphQL, `isResolved == false`), and
- the summary comment showing neither `rate limited by coderabbit.ai` nor
  `review in progress by coderabbit.ai`.

Read the newest review's **body** as well as its inline comments.

**Poll until one of exactly two things is certain: the review completed, or it was rate-limited.**
Nothing else ends the wait. A zero read once is not an answer — the review count sits at the baseline
for as long as the review takes, so an early zero is indistinguishable from "never ran" and reporting
it as the latter is simply wrong. The `Review finished` acknowledgement is not the signal either; it
lands seconds after any ping, including one that reviewed nothing.

Two states in particular look like completion and are not: an "✅ Action performed / Review finished"
comment on a repository with auto-review disabled, and a `pass` check whose summary says
`Review rate limited`. Distinguish them with the three signals above, not the checks list. And do not
report the outcome of a review still in flight — say it is still running, or wait.

For each comment:

1. Check the claim against the actual code yourself.
2. If it is right, fix it and say so in a reply.
3. If it is wrong, reply with the evidence and move on. Do not apply a change you cannot justify
   independently just to clear a comment. It concedes to a demonstrated counterexample, so the reply
   is worth writing properly rather than just dismissing.
4. If it is a matter of taste that contradicts a documented convention in `AGENTS.md`, the
   convention wins — link it in the reply.

Do not let an unresolved advisory comment block a merge. Do let a real defect it surfaced block one.

## Merging

Merge once every required check is green, **a fresh reader has reviewed the branch**, and review
comments are handled. Report what actually happened: which checks ran, who reviewed and how, what
was raised and how each was resolved, and anything left undone.

Name the reviewer in the report: CodeRabbit, a subagent because CodeRabbit was rate-limited, or
`/code-review ultra` because the change was large or security-sensitive. If none of the three
happened, say so outright rather than letting "checks green" stand in for "reviewed". Also say it if you spent a
second CodeRabbit review, and why the findings were severe enough to earn it.

Merge on the **required** checks. Do not hold a green PR waiting on an advisory review that is
rate-limited — fall back to the subagent, say what was and was not reviewed, and merge.

`gh pr merge` may print `fatal: 'main' is already used by worktree at ...` when run from a worktree.
That is `gh` failing to check out `main` locally *after* merging; confirm with
`gh pr view <pr> --json state` rather than assuming the merge failed.

## After the merge: clear the todo entry

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
