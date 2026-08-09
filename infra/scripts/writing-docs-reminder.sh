#!/usr/bin/env bash
#
# PostToolUse hook: surface the `writing-docs` skill on the first documentation
# edit of a session, and on the first code comment.
#
# `AGENTS.md` requires documentation edits to go through that skill. Nothing
# enforced it, and nothing signalled that: across roughly forty documentation
# edits in one session the skill never loaded, because skills activate on
# explicit invocation only. The instruction was true and inert at the same time,
# which is the worst state for an agent-facing rule.
#
# The skill governs code comments too, and a path filter alone cannot see one —
# so the comment branch below reads the edit's added text instead. It is a
# deny-list rather than an extension allow-list on purpose: a new file type
# should produce one surplus nudge, not a silently skipped one.
#
# Fires once per session per branch, not once per edit — at most two. A hook
# that speaks on every write is the nuisance pattern this repo warns about: it
# gets tuned out, and it re-pays its own context cost after every compaction.
# The two branches keep separate sentinels because they carry different advice;
# a code edit early in a session must not consume the documentation reminder.
#
# Stays silent instead when the skill is already loaded in the session's
# context, and writes no sentinel on that path — the sentinel means "already
# said this", but a suppressed reminder said nothing, so the reminder is due
# again if the skill later leaves context (a compaction, most likely).
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

# Read for the loaded-skill check in `remind()` below. Same idiom as
# turn-telemetry.sh:56 and session-telemetry.sh:49.
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)

# `.notes/` is gitignored scratch — todo lists and working notes, not repo
# documentation. Reminding an agent about doc standards there is pure noise.
case "$path" in
*/.notes/* | .notes/*) exit 0 ;;
esac

# Generated and machine-owned files, ahead of *both* branches: a README under
# `dist/` is not documentation anyone reviews, and a `*.gen.*` file's comments
# were not authored by the person editing it. `.json` is deliberately absent —
# every `tsconfig.json` here carries `//` comments.
case "$path" in
*-lock.yaml | *-lock.json | *.lock | *.snap | *.gen.* | *.min.* | */node_modules/* | */dist/*) exit 0 ;;
esac

session=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)

# Whether `writing-docs` is already loaded in this session's context, so an
# already-informed session gets no repeat reminder. Two independent copies of
# this upstream-format dependency already exist for a different purpose —
# turn-telemetry.sh:271-282 matches the `Skill` tool-call record,
# session-telemetry.sh:171 matches the body-load marker — grep there first if
# this ever needs to change for a transcript format change.
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
	# jq's exit code is ignored on purpose. The transcript is flushed
	# asynchronously and its last line is routinely half-written, so jq prints
	# a parse error and exits 5 while still emitting every complete record
	# before it on stdout — piping into `grep -q` would read that exit code as
	# "no match" even when the match already succeeded (measured against a
	# truncated fixture). Capturing into a variable and matching with `case`
	# reads what did make it to stdout and never looks at the exit code.
	names=$(jq -r "$loaded_program" "$transcript" 2>/dev/null)
	names=${names##*--boundary--}
	case $'\n'"$names"$'\n' in
	*$'\n'writing-docs$'\n'*) return 0 ;;
	esac
	return 1
}

remind() {
	sentinel="${TMPDIR:-/tmp}/claude-writing-docs-reminder-$1-${session//[^A-Za-z0-9._-]/_}"
	[ -e "$sentinel" ] && exit 0
	skill_loaded && exit 0
	: >"$sentinel" 2>/dev/null || exit 0
	jq -nc --arg message "$2" '{
	  hookSpecificOutput: {
	    hookEventName: "PostToolUse",
	    additionalContext: $message
	  }
	}'
	exit 0
}

case "$path" in
*.md | *.mdx)
	remind docs \
		"This repo requires documentation edits to follow the \`writing-docs\` skill. \
Invoke it with the Skill tool before continuing if it is not already loaded — it does not \
auto-activate. In short: current state and live constraints only, no narration of past work, \
no restating what \`ls\` or the code already answers, and label anything you did not verify."
	;;
esac

# Anything that is not documentation may still carry a code comment, which the
# skill also governs.
#
# The added text, not the file: `new_string` for an Edit, `content` for a Write.
# Line-leading openers only, which is what keeps `https://` inside a string from
# reading as a comment. A bare `#` is the spacer line of a shell or YAML comment
# block and counts; `#!` is a shebang and does not. `-- ` needs its space, or
# every CSS custom property and every `--i` would match.
added=$(printf '%s' "$payload" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null)
printf '%s\n' "$added" | grep -Eq '^[[:space:]]*(//|/\*|\*[ /]|\{/\*|<!--|#($|[^!])|-- )' || exit 0

remind comments \
	"You just wrote a code comment, which the \`writing-docs\` skill governs — invoke it with \
the Skill tool if it is not already loaded. In short: follow the surrounding file's comment density \
and idiom; a comment earns its place by saying what the code cannot say about itself, and an \
invariant worth explaining is usually worth asserting instead. Comments outlive what they describe, \
so when you remove a mechanism, grep for its name."
