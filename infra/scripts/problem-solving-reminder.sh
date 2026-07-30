#!/usr/bin/env bash
#
# UserPromptSubmit hook: surface the `problem-solving` skill when the prompt is a
# problem rather than an instruction.
#
# Skills activate on explicit invocation only, so a skill nobody remembers to call
# is inert however good it is — the `writing-docs` skill went unloaded across forty
# documentation edits in one session for exactly that reason. The difference here is
# that a documentation edit is a tool call a `PostToolUse` hook can see, while
# "should we do X or Y" is only ever visible in the prompt itself.
#
# Deliberately narrow. It fires on prompts that ask for a judgement — how/why/should
# /options/alternatives/trade-offs — and not on instructions ("rename this", "run the
# tests", "fix the failing check"), because a reminder that fires on everything is
# one that gets tuned out and re-pays its own context cost after every compaction.
#
# Never blocks and never rewrites the prompt: every exit path is 0 and the only
# output is `additionalContext`.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat)
prompt=$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null)
[ -n "$prompt" ] || exit 0

# Long enough to be a question rather than a command. A five-word prompt is an
# instruction even when it contains "how".
words=$(printf '%s' "$prompt" | wc -w)
[ "$words" -ge 8 ] || exit 0

lower=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')

# Asks for a judgement. Anchored phrases, not bare keywords: "how" alone matches
# "how do I run the tests", which is not a problem to work.
case "$lower" in
*"how should"* | *"how do we"* | *"how would we"* | *"how can we"* | *"what is the best"* | \
  *"what's the best"* | *"which approach"* | *"should we"* | *"should i"* | *"is it worth"* | \
  *"what are the options"* | *"what options"* | *"what else"* | *"trade-off"* | *"tradeoff"* | \
  *"why does"* | *"why is"* | *"what would you"* | *"do you think"* | *"better approach"* | \
  *"alternatives"* | *"recommend"*) ;;
*) exit 0 ;;
esac

# One reminder per session. The stages are a way of working, not a per-prompt
# checklist, and once loaded the skill is in context anyway.
session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)
sentinel="${TMPDIR:-/tmp}/claude-problem-solving-reminder-${session//[^A-Za-z0-9._-]/_}"
[ -e "$sentinel" ] && exit 0
: >"$sentinel" 2>/dev/null || exit 0

jq -nc '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: (
      "This reads as a problem to work rather than an instruction to carry out. "
      + "Invoke the `problem-solving` skill with the Skill tool before answering — it does not "
      + "auto-activate. In short: separate the concerns, name the binding constraint, research the "
      + "web and the repo before inventing anything, fan out to options including problems that were "
      + "not raised, then converge on one recommendation with what would change your mind and what "
      + "you could not verify."
    )
  }
}'
