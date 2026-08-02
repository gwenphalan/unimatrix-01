#!/usr/bin/env bash
#
# PostToolUse hook: append one JSONL line per tool call to
# `.notes/agent-tool-calls.jsonl`.
#
# Cost here is tool calls x accumulated context, not model tier — on PR #194
# every research agent ran 61-111 calls at roughly 2,200-2,500 tokens each.
# Nothing recorded that, so "did the brief-reuse rule cut planner calls from 72
# to 40" was unanswerable and every rule resting on it was an assertion.
# Counting is `wc -l` and a group-by; no SubagentStop event is involved, which
# avoids depending on an event name nobody here has verified.
#
# It logs and nudges nothing. A hook that speaks on every call puts its text in
# context on every call, which is the cost being measured, and a PreToolUse hook
# fires at the first call, when the calls it would batch do not exist yet.
#
# Silent by construction: it writes nothing to stdout, so it costs zero model
# tokens. PostToolUse stdout reaches the model only through the
# `hookSpecificOutput.additionalContext` JSON form — read from the hooks
# reference, not measured here.
#
# `agent_type` and `agent_id` are documented as present only when the hook fires
# inside a subagent, so a null `agent_type` is the main thread. Unverified:
# whether a session-scoped registration fires inside a subagent at all. It
# cannot be tested in the session that adds it — a newly registered hook event
# first fires in the following one. If every line comes back with a null
# `agent_type`, this is main-thread-only and the registration belongs in each
# agent's `hooks:` frontmatter instead.
#
# Every exit path is 0: a logger must never fail a tool call.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

payload=$(cat)

# `.notes/` is gitignored scratch and a fresh clone has none. Absent means log
# nothing, not fail.
log_dir="${CLAUDE_PROJECT_DIR:-.}/.notes"
[ -d "$log_dir" ] || exit 0

line=$(printf '%s' "$payload" | jq -c '{
  ts: (now | todateiso8601),
  session: (.session_id // null),
  agent_type: (.agent_type // null),
  agent_id: (.agent_id // null),
  tool: (.tool_name // null)
}' 2>/dev/null) || exit 0
[ -n "$line" ] || exit 0

# One line, one `>>`. `O_APPEND` makes the offset-update-plus-write one atomic
# operation per `write(2)`, which is what stops concurrent agents interleaving
# halves of a line — this is a regular file, not a pipe, so PIPE_BUF does not
# apply here.
printf '%s\n' "$line" >>"$log_dir/agent-tool-calls.jsonl" 2>/dev/null || exit 0
