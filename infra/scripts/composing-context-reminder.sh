#!/usr/bin/env bash
#
# PostToolUse hook: surface the `composing-context` skill when a session first
# edits agent-facing context — a skill body, an `AGENTS.md`, or a `CLAUDE.md`.
#
# These files are not read by people; they are loaded into a finite context and
# acted on, and every line is paid for on every session that loads them. The
# decisions that matter there are structural — does this line belong here at
# all, in this layer, as a rule rather than judgement — and they are invisible
# while editing prose one paragraph at a time.
#
# The `writing-docs` hook also fires on these paths, because they are `.md`.
# That is deliberate and the two are scoped not to collide: `writing-docs` owns
# how a line is written, `composing-context` owns whether it should exist and
# which file holds it. The message below states that split, because two hooks
# firing on one edit with overlapping advice is the exact reconciliation cost
# this skill exists to avoid.
#
# Once per session and never fatal, for the same reasons as
# `writing-docs-reminder.sh`.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat)

path=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$path" ] || exit 0

# Agent-facing context only. A README or a design doc is documentation and
# belongs to `writing-docs` alone.
case "$path" in
*/AGENTS.md | AGENTS.md | */CLAUDE.md | CLAUDE.md) ;;
*/.claude/skills/*/*.md) ;;
*) exit 0 ;;
esac

session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)
sentinel="${TMPDIR:-/tmp}/claude-composing-context-reminder-${session//[^A-Za-z0-9._-]/_}"
[ -e "$sentinel" ] && exit 0
: >"$sentinel" 2>/dev/null || exit 0

jq -nc '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: (
      "You are editing agent-facing context, which loads into every session that reads it. "
      + "Invoke the `composing-context` skill before continuing — it does not auto-activate. "
      + "It decides whether a line should exist and which layer holds it: prefer judgement to "
      + "rules except where a mistake fails silently, do not restate what another file already "
      + "says, and trim before splitting — deferral only pays when content is conditional "
      + "rather than merely later. "
      + "If the `writing-docs` reminder also fired, they do not conflict: `writing-docs` governs "
      + "how a line is written, `composing-context` governs whether it belongs here."
    )
  }
}'
