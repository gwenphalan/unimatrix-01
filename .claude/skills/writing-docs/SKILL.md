---
name: writing-docs
description: How this repo wants documentation written — any .md file, AGENTS.md, README, code comment, docstring, or PR body. Use when adding or changing prose that a human or an agent will read as guidance, and when auditing existing docs for drift, noise, or claims that are no longer true.
---

# Writing docs in this repo

Two audiences, one failure mode: a human who skims and an agent that loads the file into a
finite context and acts on it. Both are hurt by stale claims, by narration of past work, and by
prose that costs attention without changing a decision.

The test for a line is **would deleting it change what someone does?**

## What this repo is opinionated about

**Current state and live constraints only.** Not what it used to be, not who found the bug, not
which PR changed it — git holds that. The exception is a rule whose reason is only visible in
what went wrong: a compatibility fallback, a dependency ceiling, an upstream workaround. Write
the constraint and what breaks without it, not the incident.

**Don't restate what can't drift.** The dependency list, the script names, the schema, the
workspace roster. A committed copy of something `ls` answers is worse than nothing: it goes
stale silently and gets believed anyway. Point at the source.

**Don't document absence,** and don't write a doc about another doc — no file explaining what a
neighbouring file contains, no instructions for maintaining the index being read.

**Prefer the thing that will bite** over the accurate summary. "Two resolved copies of the
router means `useRouterState` reads a context the provider never wrote to" earns its line;
"this package holds the shared UI components" does not.

**Label what you did not verify.** An unmarked guess about *why* something behaves as it does is
the most damaging thing a reference doc can contain. If you did not run it, say so.

**Delete stale text; don't append a correction beside it.**

For code comments, follow the surrounding file's comment density and idiom. Where a comment is
worth writing, it earns its place by saying what the code cannot say about itself. An invariant
worth explaining is usually worth asserting instead.

## Length is a per-session cost

Terseness here is empirical, not taste. Anthropic removed over 80% of Claude Code's system
prompt for the Claude 5 generation with no measurable loss on their coding evals, and found that
overlapping or conflicting instructions make a model reason about reconciling them before it can
act. [Gloaguen et al.](https://arxiv.org/abs/2602.11988) measured agents on real tasks with no
context file, a generated one, and a human-written one: generated files made agents *worse*
(−2% resolution on their benchmark, 2.5× more repo-tool calls, over-exploration of the tree),
while hand-written ones gave about +4%. Their conclusion was to carry only indispensable
operational constraints and skip architectural overviews.

So: put gotchas in `AGENTS.md`, push detail into a skill that loads when it is relevant, and
resist the urge to make any one file the place where everything lives.

## Structure

[Diátaxis](https://diataxis.fr/) is the reference if a file's shape is unclear — it separates
tutorial, how-to, reference, and explanation by what the reader is doing. `AGENTS.md` files and
most READMEs here are reference plus constraints: scannable, factual, with the *why* attached in
one sentence to the rule it justifies.
