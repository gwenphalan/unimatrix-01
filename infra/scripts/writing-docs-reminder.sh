#!/usr/bin/env bash
#
# PostToolUse hook: surface the `writing-docs` skill on the first documentation
# edit of a session.
#
# `AGENTS.md` requires documentation edits to go through that skill. Nothing
# enforced it, and nothing signalled that: across roughly forty documentation
# edits in one session the skill never loaded, because skills activate on
# explicit invocation only. The instruction was true and inert at the same time,
# which is the worst state for an agent-facing rule.
#
# Fires once per session, not once per edit. A hook that speaks on every `.md`
# write is the nuisance pattern this repo warns about — it gets tuned out, and
# it re-pays its own context cost after every compaction. The sentinel is keyed
# by session id so a new session gets one reminder and a long one gets no more.
#
# `PostToolUse` rather than `PreToolUse` deliberately: the model has already
# composed the edit by the time either fires, so `PreToolUse` would gain nothing
# for the first edit and could block edits if it ever misbehaved. This hook
# cannot fail an edit — every exit path is 0.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat)

path=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$path" ] || exit 0

case "$path" in
*.md | *.mdx) ;;
*) exit 0 ;;
esac

# `.notes/` is gitignored scratch — todo lists and working notes, not repo
# documentation. Reminding an agent about doc standards there is pure noise.
case "$path" in
*/.notes/* | .notes/*) exit 0 ;;
esac

session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)
sentinel="${TMPDIR:-/tmp}/claude-writing-docs-reminder-${session//[^A-Za-z0-9._-]/_}"
[ -e "$sentinel" ] && exit 0
: >"$sentinel" 2>/dev/null || exit 0

jq -nc '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: (
      "This repo requires documentation edits to follow the `writing-docs` skill. "
      + "Invoke it with the Skill tool before continuing if it is not already loaded — "
      + "it does not auto-activate. In short: current state and live constraints only, "
      + "no narration of past work, no restating what `ls` or the code already answers, "
      + "and label anything you did not verify."
    )
  }
}'
