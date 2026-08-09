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
# checklist. Once `problem-solving` is loaded the skill is in context anyway
# — the check below detects exactly that and stays silent, writing no
# sentinel, so the reminder is due again once the skill leaves context.
session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)

# Read for the loaded-skill check below. Same idiom as turn-telemetry.sh:56
# and session-telemetry.sh:49.
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)

# Whether `problem-solving` is already loaded in this session's context. Two
# independent copies of this upstream-format dependency already exist for a
# different purpose — turn-telemetry.sh:271-282 matches the `Skill` tool-call
# record, session-telemetry.sh:171 matches the body-load marker — grep there
# first if this ever needs to change for a transcript format change.
#
# Matches two shapes: the `invoked_skills` attachment (observed after *some*
# compactions, not all — its absence must fail safe, not stale-suppress) and
# the marker line that opens a skill's body. The scan stops at the last
# `compact_boundary` so a load from before a compaction — no longer in
# context — cannot suppress a reminder that is due again.
loaded_program='
  select(type == "object")
  | if .type == "system" and .subtype == "compact_boundary" then
      "--boundary--"
    else
      (
        (.attachment | objects | select(.type == "invoked_skills")
          | .skills | arrays | .[] | .name | strings),
        (select(.type == "user") | .message | objects | .content | arrays | .[]
          | objects | select(.type == "text") | .text | strings
          | split("\n")[0]
          | select(startswith("Base directory for this skill: "))
          | sub("^.*/"; ""))
      )
    end
'

skill_loaded() {
	[ -n "$transcript" ] && [ -r "$transcript" ] || return 1
	# jq's exit code is ignored on purpose — see writing-docs-reminder.sh for
	# the measured truncated-transcript reason this is not `| grep -q`.
	names=$(jq -r "$loaded_program" "$transcript" 2>/dev/null)
	names=${names##*--boundary--}
	case $'\n'"$names"$'\n' in
	*$'\n'problem-solving$'\n'*) return 0 ;;
	esac
	return 1
}

sentinel="${TMPDIR:-/tmp}/claude-problem-solving-reminder-${session//[^A-Za-z0-9._-]/_}"
[ -e "$sentinel" ] && exit 0
skill_loaded && exit 0
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
