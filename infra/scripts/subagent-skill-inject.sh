#!/usr/bin/env bash
#
# SubagentStart hook: put the skill text governing a subagent's work in front of it
# before its first turn, rather than relying on the agent to fetch it.
#
# A subagent that lists `Skill` in `tools` can invoke skills; one that does not gets
# `No such tool available: Skill. Skill exists but is not enabled in this context.`
# Measured both directions. **Never establish this by asking a subagent what tools it
# has** — it answers from injected text as readily as from its own function list, and
# that route has produced the wrong answer here twice. Have it attempt the call.
#
# `SubagentStart` fires per Agent call with
# `agent_type` in its payload, and stdout JSON `additionalContext` is delivered to
# the subagent. So the skill file stays the single source and the agent that needs
# it gets it inlined at start.
#
# Only agents that write prose get an injection, because the text is not free —
# it lands in that subagent's context every dispatch. A read-only reviewer paying
# for documentation rules is pure overhead.
#
# **Verified working, in a fresh session.** The subagent transcript under
# `~/.claude/projects/*/subagents/agent-*.jsonl` carries a `hook_success` record
# named `SubagentStart:monorepo-implementer` followed by a `hook_additional_context`
# record holding this script's output — the harness parsed it and handed it over.
# `plan-adversary` dispatched alongside had neither. Read those records rather than
# asking a subagent what it received: an agent answers "yes, I have documentation
# rules" from the root `AGENTS.md` whether or not this fired.
#
# **A hook event key added mid-session does not register**, which is the trap that
# made it look broken: wired and unit-tested, it logged no invocation at all in the
# session that added it, while the `PostToolUse` hooks in the same file kept firing
# because they predated it. Adding an event needs `/hooks` or a restart. Editing
# *this script* does not.
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  printf 'subagent-skill-inject: jq not on PATH; injection is inert\n' >&2
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-.}"
payload=$(cat)
agent=$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null)

# An unmapped agent is the normal case and exits quietly. A payload that arrived
# but carries no `agent_type` is not — it means the shape changed underneath this,
# and the injection would then be silently dead for *every* agent while the hook
# still reported success. Say so on stderr, which surfaces under `--debug` without
# blocking the dispatch. Never exit non-zero here: this hook must not be able to
# stop an Agent call.
if [ -z "$agent" ]; then
  [ -n "$payload" ] && printf 'subagent-skill-inject: payload has no agent_type; injection is inert\n' >&2
  exit 0
fi

# agent_type -> skills to inline. Deliberately narrow.
#
# `monorepo-implementer` is the only agent here that can write a file, and it
# writes prose on every run regardless: commit messages and code comments. It does
# *not* get `composing-context` — that governs agent-facing context, which it is
# told to hand back to the caller rather than edit, and injecting it would cost
# every implementation run for a case that should not arise.
case "$agent" in
monorepo-implementer) skills="writing-docs" ;;
*) exit 0 ;;
esac

body=""
for skill in $skills; do
  file="$root/.claude/skills/$skill/SKILL.md"
  if [ ! -f "$file" ]; then
    printf 'subagent-skill-inject: %s missing; %s gets no %s text\n' "$file" "$agent" "$skill" >&2
    continue
  fi
  # Strip the YAML frontmatter: it is routing metadata for a tool this reader does
  # not have, and `description` re-states the body.
  text=$(awk 'BEGIN { fm = 0 }
              NR == 1 && $0 == "---" { fm = 1; next }
              fm == 1 && $0 == "---" { fm = 2; next }
              fm != 1 { print }' "$file")
  [ -n "$text" ] || continue
  body+="The \`$skill\` skill governs work you are about to do, so its text is inlined
here in full — you do not need to invoke it. Treat it as binding.

$text

"
done

[ -n "$body" ] || exit 0

printf '%s' "$body" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: .
  }
}'
