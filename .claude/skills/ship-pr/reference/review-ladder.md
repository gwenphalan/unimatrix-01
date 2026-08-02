# The reviewer ladder — full mechanics

Loaded on demand from `ship-pr`. Read this when picking a pre-merge reviewer, and before invoking
the `code-review` workflow or handing off `ultra`.

## Pick by what the change is

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

