#!/usr/bin/env bash
#
# SessionEnd hook: append one JSON line per session to
# `$HOME/.claude/unimatrix-session-log.jsonl`.
#
# Answering "is this rule being followed?" otherwise means parsing the raw
# transcripts under `~/.claude/projects/` — hundreds of megabytes, the largest
# single file ~49 MB, none of which an agent can read whole. One line per
# session makes the questions cheap.
#
# Every exit path is 0 and no failure is fatal: a hook that errors must not
# break session teardown. `set -e` is deliberately absent for the same reason.
#
# The log is machine-global rather than in-repo on purpose — it accumulates
# across worktrees and must not be a file a branch can revert.
set -uo pipefail

log="${HOME}/.claude/unimatrix-session-log.jsonl"
mkdir -p "${HOME}/.claude" 2>/dev/null || :

# Every timestamp here needs `TZ=UTC`. Bare `printf '%(...Z)T'` renders *local*
# time and still labels it `Z`, which is wrong in a way nothing surfaces.
now() { TZ=UTC printf '%(%Y-%m-%dT%H:%M:%SZ)T' -1; }

# Builtins only — this is the path taken when `jq` is missing, which is exactly
# the case where `PATH` may be broken, so no `date`, no `printf(1)`.
degraded() {
	TZ=UTC printf '{"v":1,"date":"%(%Y-%m-%dT%H:%M:%SZ)T","degraded":"%s"}\n' -1 "$1" >>"$log" 2>/dev/null
	exit 0
}

payload=$(cat)

# Unlike the reminder hooks, a missing `jq` must still produce a line. Silence
# in a log is indistinguishable from "no sessions ever ran".
command -v jq >/dev/null 2>&1 || degraded jq-missing

session=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)
end_reason=$(printf '%s' "$payload" | jq -r '.reason // empty' 2>/dev/null)
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)

# `jq -n` builds the whole line, and a single `>>` appends it. Two sessions can
# end milliseconds apart; an O_APPEND write under 4096 bytes is atomic on Linux
# and a sequence of writes is not, and the resulting interleave is silent.
emit() {
	line=$(jq -nc "$@" 2>/dev/null) || degraded jq-build-failed
	[ -n "$line" ] || degraded jq-build-failed
	printf '%s\n' "$line" >>"$log" 2>/dev/null
	exit 0
}

# A missing transcript still gets a line — with the fields it could not produce
# as null rather than as a zero, so a gap stays diagnosable.
if [ -z "$transcript" ] || [ ! -r "$transcript" ]; then
	# shellcheck disable=SC2016  # `$date` and friends are jq bindings from `--arg`, not shell vars.
	emit --arg date "$(now)" --arg session "$session" --arg reason "$end_reason" --arg cwd "$cwd" '{
	  v: 1,
	  date: $date,
	  session_id: ($session | if . == "" then null else . end),
	  end_reason: ($reason | if . == "" then null else . end),
	  cwd: ($cwd | if . == "" then null else . end),
	  degraded: "transcript-unreadable",
	  transcript_bytes: null,
	  compactions: null,
	  skills_loaded: null,
	  skill_tool_calls: null,
	  agent_dispatches: null,
	  touched_browser_surface: null,
	  browser_surfaces_touched: null,
	  dispatched_browser_verifier: null,
	  touched_lab_only: null
	}'
fi

bytes=$(stat -c %s "$transcript" 2>/dev/null)
[ -n "$bytes" ] || bytes=0

# One streaming pass. Never `cat` the transcript and never `jq -s` it: slurping
# is no faster (measured 0.218s vs 0.189s streaming on a 48.5 MB file) and it
# holds the parsed file in memory for nothing.
#
# Compactions are counted from the `isCompactSummary` field, *not* by grepping
# for the phrase Claude Code prints when it compacts. Transcripts discuss
# compaction in prose, so the grep overcounts by up to 33x — measured across
# four transcripts, grep vs field vs truth: 3/1/1, 66/2/2, 4/4/4, 10/10/10.
#
# `agent_dispatches` is a per-session *total*, not concurrency. Parallel and
# sequential dispatch are indistinguishable in a transcript after the fact: no
# assistant entry ever carries more than one `tool_use` block (re-measured over
# three sessions with real parallel batches — 77/58, 96/138, 118/134 entries,
# none with two or more).
jq_program='
  select(type == "object")
  | (if .isCompactSummary == true then "compaction\t1" else empty end),
    (select(.type == "assistant")
     | .message.content[]?
     | select(.type == "tool_use")
     | if (.name == "Write" or .name == "Edit" or .name == "NotebookEdit")
       then "file\t" + ((.input.file_path // "") | tostring)
       elif .name == "Agent"
       then "agent\t" + ((.input.subagent_type // "") | tostring)
       elif .name == "Skill"
       then "skill\t" + ((.input.skill // "") | tostring)
       else empty end)
'

compactions=0
skill_tool_calls=0
agent_dispatches=0
browser_verifier=0
edited=()

# Process substitution, not a pipe. A pipe puts the loop in a subshell and every
# counter below is silently discarded, producing a line full of zeros.
while IFS=$'\t' read -r kind value; do
	case "$kind" in
	compaction) compactions=$((compactions + 1)) ;;
	skill) skill_tool_calls=$((skill_tool_calls + 1)) ;;
	agent)
		agent_dispatches=$((agent_dispatches + 1))
		[ "$value" = "browser-verifier" ] && browser_verifier=$((browser_verifier + 1))
		;;
	file) [ -n "$value" ] && edited+=("$value") ;;
	esac
done < <(jq -r "$jq_program" "$transcript" 2>/dev/null)

# Skill *body-loads*, which is a different number from `Skill` tool calls: a
# body can arrive by hook injection with no tool call at all, so counting calls
# alone undercounts. Both are recorded because the gap between them is itself
# the measurement.
#
# Two caveats. This marker is an upstream-format dependency — if the wording
# changes the count silently drops to zero rather than failing. And a skill
# invoked inside a subagent never appears here; it lives in
# `<session-dir>/subagents/agent-*.jsonl`. Main-thread-only is deliberate.
#
# The marker is anchored to the two positions a real body-load occupies: the
# start of a JSON string, or an escaped newline inside one. Unanchored, prose
# that merely quotes the marker counts as a load — measured, a transcript
# discussing a skill path inside backticks contributed a phantom `effort-probe`.
#
# The value class must exclude a literal backslash. `[^ \"]` does not, despite
# looking like it should: names ran on as `problem-solving\n\n#`, which then
# failed to dedupe against the clean `problem-solving` and inflated the count.
skills_loaded=$(grep -o '\(["]\|\\n\)Base directory for this skill: [^ "\\]*' "$transcript" 2>/dev/null |
	sed 's|.*/||' | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))' 2>/dev/null)
[ -n "$skills_loaded" ] || skills_loaded='[]'

# Browser surfaces are derived from `cwd` at hook time rather than hardcoded,
# so adding an app does not silently stop being measured. The rule they encode
# is `AGENTS.md`'s: anything with a `vite.config.ts`, plus `packages/ui` and
# `packages/chrome`, which have no browser of their own.
surfaces=()
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
	for config in "$cwd"/apps/*/vite.config.ts "$cwd"/packages/*/vite.config.ts "$cwd"/lab/vite.config.ts; do
		[ -f "$config" ] || continue
		dir=${config%/vite.config.ts}
		surfaces+=("${dir#"$cwd"/}")
	done
	for extra in packages/ui packages/chrome; do
		[ -d "$cwd/$extra" ] || continue
		case " ${surfaces[*]} " in
		*" $extra "*) ;;
		*) surfaces+=("$extra") ;;
		esac
	done
fi

touched=()
if [ ${#surfaces[@]} -gt 0 ] && [ ${#edited[@]} -gt 0 ]; then
	for file in "${edited[@]}"; do
		rel=${file#"$cwd"/}
		case "$rel" in /*) continue ;; esac
		for surface in "${surfaces[@]}"; do
			# The trailing slash is the whole point: without it `apps/webhooks`
			# would match the surface `apps/web`.
			case "$rel" in
			"$surface"/*)
				case " ${touched[*]} " in
				*" $surface "*) ;;
				*) touched+=("$surface") ;;
				esac
				;;
			esac
		done
	done
fi

touched_json=$(printf '%s\n' "${touched[@]}" |
	jq -Rsc 'split("\n") | map(select(length > 0)) | sort' 2>/dev/null)
[ -n "$touched_json" ] || touched_json='[]'

# An empty `cwd` means the surface list could not be built, which is a gap, not
# a "no". A false zero here is worse than a hole.
if [ -z "$cwd" ]; then
	touched_browser_surface=null
	touched_json=null
	lab_only=null
elif [ ${#touched[@]} -gt 0 ]; then
	touched_browser_surface=true
	# `lab` has a `vite.config.ts`, so the literal rule makes it a browser
	# surface — but nobody dispatches `browser-verifier` for a local-only
	# prototype. Flagged separately so the compliance ratio stays computable
	# with lab in or out.
	if [ "${#touched[@]}" -eq 1 ] && [ "${touched[0]}" = "lab" ]; then
		lab_only=true
	else
		lab_only=false
	fi
else
	touched_browser_surface=false
	lab_only=false
fi

# `v` is the schema version. Fields get added to this line later, and without it
# nobody can tell which lines predate which field.
#
# shellcheck disable=SC2016  # `$date` and friends are jq bindings from `--arg`, not shell vars.
emit \
	--arg date "$(now)" \
	--arg session "$session" \
	--arg reason "$end_reason" \
	--arg cwd "$cwd" \
	--argjson bytes "$bytes" \
	--argjson compactions "$compactions" \
	--argjson skills "$skills_loaded" \
	--argjson skill_calls "$skill_tool_calls" \
	--argjson agents "$agent_dispatches" \
	--argjson touched "$touched_browser_surface" \
	--argjson touched_list "$touched_json" \
	--argjson verifier "$browser_verifier" \
	--argjson lab_only "$lab_only" '{
	  v: 1,
	  date: $date,
	  session_id: ($session | if . == "" then null else . end),
	  end_reason: ($reason | if . == "" then null else . end),
	  cwd: ($cwd | if . == "" then null else . end),
	  transcript_bytes: $bytes,
	  compactions: $compactions,
	  skills_loaded: $skills,
	  skill_tool_calls: $skill_calls,
	  agent_dispatches: $agents,
	  touched_browser_surface: $touched,
	  browser_surfaces_touched: $touched_list,
	  dispatched_browser_verifier: $verifier,
	  touched_lab_only: $lab_only
	}'
