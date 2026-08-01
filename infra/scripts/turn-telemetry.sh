#!/usr/bin/env bash
#
# Stop hook: append one JSON line per turn to
# `$HOME/.claude/unimatrix-session-log.jsonl`, the same log
# `infra/scripts/session-telemetry.sh` writes one line per session to. The two
# record shapes are told apart by `"event":"turn"`; a line with no `event` key
# is a session-end line.
#
# It measures and never blocks. `AGENTS.md` forbids reporting work verified
# without running the check, and the question that decides whether enforcement
# is worth building is how often a done-claim is even made — which a claim count
# alone cannot answer. So each line records the claim families found in the
# final assistant message *and* whether a matching command actually ran, as a
# pair, in the main transcript or in a subagent's.
#
# Every exit path is 0 and nothing reaches stdout: a `Stop` hook that errors or
# speaks interferes with every turn of the session. `set -e` is deliberately
# absent for the same reason.
#
# Evidence is turn-scoped, which is what excludes a CI family. CI state is
# legitimately knowable from a prior turn or from output the user pasted, so a
# turn window structurally cannot see that evidence and scoring it would
# manufacture unbacked verdicts. Do not add one.
#
# The log is machine-global rather than in-repo on purpose — it accumulates
# across worktrees and must not be a file a branch can revert.
set -uo pipefail

# `${HOME}` unset would abort under `set -u` before any of the exit-0 handling
# below is reachable. There is no sensible fallback path for a log nobody would
# find, so an unset HOME exits quietly.
[ -n "${HOME:-}" ] || exit 0

log="${HOME}/.claude/unimatrix-session-log.jsonl"
mkdir -p "${HOME}/.claude" 2>/dev/null || :

# Every timestamp here needs `TZ=UTC`. Bare `printf '%(...Z)T'` renders *local*
# time and still labels it `Z`, which is wrong in a way nothing surfaces.
now() { TZ=UTC printf '%(%Y-%m-%dT%H:%M:%SZ)T' -1; }

# Builtins only, and `"event":"turn"` hardcoded rather than built — this is the
# path taken when `jq` is missing, which is exactly the case where `PATH` may be
# broken, so no `date`, no `printf(1)`, and nothing that shells out.
degraded() {
	TZ=UTC printf '{"v":1,"event":"turn","date":"%(%Y-%m-%dT%H:%M:%SZ)T","degraded":"%s"}\n' -1 "$1" >>"$log" 2>/dev/null
	exit 0
}

payload=$(cat)

# Unlike the reminder hooks, a missing `jq` must still produce a line. Silence
# in a log is indistinguishable from "no turns ever ran".
command -v jq >/dev/null 2>&1 || degraded jq-missing

session=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
prompt_id=$(printf '%s' "$payload" | jq -r '.prompt_id // empty' 2>/dev/null)
message=$(printf '%s' "$payload" | jq -r '.last_assistant_message // empty' 2>/dev/null)
stop_active=$(printf '%s' "$payload" | jq -r 'if .stop_hook_active == true then "true" else "false" end' 2>/dev/null)
[ "$stop_active" = "true" ] || stop_active=false

# Currently dead code, kept as cheap insurance. Across 312 measured payloads
# `isSidechain` was false every time and none carried a `/subagents/` path, so
# `Stop` has never been observed firing per-subagent here — but if it ever does,
# a subagent's turn would be logged as if it were the main thread's.
case "$transcript" in
*/subagents/*) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Claim side: what the final assistant message said.
# ---------------------------------------------------------------------------

# A unit counts only if it matches a family regex *and* survives the narrative
# veto. The forward and reverse alternatives differ on purpose: `pass` is
# forward-only, so "195 unit tests pass" matches (noun then verb) while "for a
# Dockerfile build ... pass `null`" does not (verb then noun, imperative).
#
# `pass_rev` opens on `\b` and deliberately does not close on one. Without the
# leading boundary the tail of "bypassing the exception test" reads as a passing
# test; with a trailing one, `clean` stops matching "cleanly" and takes real
# claims like "All 27 tasks pass cleanly — lint, typecheck, and tests" with it.
pass_fwd='(pass|passes|passed|passing|green|clean|succeed|succeeds|succeeded|no errors|zero errors)'
pass_rev='\b(passes|passed|passing|green|clean|succeeds|succeeded)'
narrative='\b(if|would|were|was|had been|stays?|stayed|left|despite|even though|still|should|could|might|but|yet|never|didn.t|does not|doesn.t|failed to|missed)\b'

claim_regex() {
	# The `gate` branch's backticks are markdown, quoting `pnpm check` the way a
	# message writes it — the interpolations here are the double-quoted segments.
	# shellcheck disable=SC2016
	case "$1" in
	build) printf '%s' '\bbuilds?\b[^.]{0,40}'"$pass_fwd"'|'"$pass_rev"'[^.]{0,25}\bbuild\b' ;;
	gate) printf '%s' '`?pnpm (check|verify)`?[^.]{0,40}'"$pass_fwd"'|'"$pass_rev"'[^.]{0,25}`?pnpm (check|verify)' ;;
	lint) printf '%s' '\blint(ing|er)?\b[^.]{0,40}'"$pass_fwd"'|'"$pass_rev"'[^.]{0,25}\blint\b' ;;
	test) printf '%s' '\b(tests?|test suite|suite|smoke|unit tests?)\b[^.]{0,40}'"$pass_fwd"'|'"$pass_rev"'[^.]{0,25}\b(tests?|suite)\b' ;;
	typecheck) printf '%s' '\b(typechecks?|type-checks?|tsc)\b[^.]{0,40}'"$pass_fwd"'|'"$pass_rev"'[^.]{0,25}\btypecheck' ;;
	esac
}

# Matched against `Bash` command text, one command per line.
#
# `test` requires a runner token on the same command. A bare ` test ` matched
# 162 of 2,073 real commands, 18 of them with no runner at all — `ls test e2e`,
# a heredoc writing a `.test.ts` file, a commit message containing the word.
# Every one of those biases the unbacked count *down*, which is the flattering
# direction. `gate` is anchored for the same class of reason: unanchored,
# `pnpm check:doc-script-refs` — a two-second filename grep — would satisfy a
# `pnpm check` claim, and this repo ships eight `check:*` scripts.
evidence_regex() {
	case "$1" in
	build) printf '%s' 'vite build|docker build|tsc -b|(pnpm|turbo)[^&;|]*[[:space:]]build($|[[:space:]])' ;;
	gate) printf '%s' 'pnpm (run )?(check|verify)($|[^:a-z-])' ;;
	lint) printf '%s' 'eslint|shellcheck|prettier|format:check|(pnpm|turbo|npx)[^&;|]*[[:space:]]lint($|[[:space:]])' ;;
	test) printf '%s' 'vitest|playwright|node --test|--test[[:space:]]|(pnpm|turbo|npx)[^&;|]*[[:space:]]test(:unit|:smoke)?($|[[:space:]])' ;;
	typecheck) printf '%s' 'tsc|typecheck' ;;
	esac
}

# Fenced blocks go first: pasted terminal output ("Done in 1.2s") is a real
# source of false claims. An odd number of fences truncates the rest of the
# message, which loses claims rather than inventing them.
#
# The split is one *sentence* per line, not one line per line. Every family
# regex already forbids crossing a `.` via `[^.]{0,40}`, so a coarser unit only
# widens the narrative veto — "195 tests pass. I would have run lint too" would
# lose a true claim to a `would` in the following sentence.
#
# A unit ending in `?` is dropped whole: it is asking, not claiming. The veto is
# per-sentence, so "Tests pass. Merge it?" keeps its claim, while a single
# sentence that both reports and asks — "Tests pass — want me to merge?" — loses
# one. That form is absent from the transcript corpus this was measured against.
units=$(printf '%s\n' "$message" |
	awk '/^[[:space:]]*```/ { fence = !fence; next } !fence' |
	sed 's/\([.!?]\)[[:space:]]/\1\n/g' |
	grep -viE "$narrative" |
	grep -vE '[?][[:space:]]*$')

claim_list=""
for family in build gate lint test typecheck; do
	grep -qiE "$(claim_regex "$family")" <<<"$units" || continue
	claim_list+="${family}"$'\n'
done

# ---------------------------------------------------------------------------
# Evidence side: what actually ran during the turn.
# ---------------------------------------------------------------------------

measured=true
degraded_reason=""
main_commands=0
subagent_dispatches=0
subagent_commands=0
guidance_skill=false
backed_main=""
backed_sub=""

# `stop_hook_active` still gets a line, marked, with the transcript work
# skipped. Emitting nothing on a `true` would punch a silent hole in the
# denominator, and the flag is unreliable when a `UserPromptSubmit` hook injects
# context (anthropics/claude-code#54360) — which this repo's two such hooks
# reproduce. It was false in all 312 measured payloads, so the spurious case is
# inferred rather than observed.
if [ "$stop_active" = "true" ]; then
	measured=false
elif [ -z "$transcript" ] || [ ! -r "$transcript" ]; then
	measured=false
	degraded_reason="transcript-unreadable"
fi

if [ "$measured" = "true" ]; then
	# The turn window is the span of lines carrying this turn's `promptId`.
	# Only `user` records carry it, and a tool result is a `user` record, so
	# every `tool_use` the turn issued falls inside the span.
	#
	# `grep -F`: a prompt id is a fixed string and must not be read as a
	# pattern. An absent or unmatched id widens the window to the whole
	# session, which makes evidence far too easy to find — so it is declared
	# rather than silently accepted.
	window_first=""
	window_last=""
	if [ -n "$prompt_id" ]; then
		hits=$(grep -Fn "\"promptId\":\"${prompt_id}\"" "$transcript" 2>/dev/null | cut -d: -f1)
		window_first=$(printf '%s\n' "$hits" | head -1)
		window_last=$(printf '%s\n' "$hits" | tail -1)
	fi
	if [ -z "$window_first" ] || [ -z "$window_last" ]; then
		window_first=1
		window_last=$(wc -l <"$transcript" 2>/dev/null)
		[ -n "$window_last" ] || window_last=1
		degraded_reason="turn-window-unresolved"
	fi

	# Newlines are flattened to spaces so one command is one line: the
	# evidence regexes anchor on `$`, and a heredoc would otherwise split a
	# command across lines and defeat the anchor.
	turn_program='
	  select(type == "object" and .type == "assistant")
	  | .message.content[]?
	  | select(.type == "tool_use")
	  | if .name == "Bash"
	    then "cmd\t" + ((.input.command // "") | tostring | gsub("\n"; " "))
	    elif .name == "Agent"
	    then "agent\t" + ((.id // "") | tostring)
	    else empty end
	'

	# A pipeline inside a command substitution *does* propagate its status
	# under `pipefail`, unlike the process substitution `session-telemetry.sh`
	# warns about — so a `jq` that died on a malformed transcript is caught
	# rather than reported as a turn with no tool calls.
	turn_rows=$(sed -n "${window_first},${window_last}p" "$transcript" | jq -r "$turn_program" 2>/dev/null)
	turn_status=$?
	[ "$turn_status" -eq 0 ] || degraded turn-parse-failed

	main_cmds=$(printf '%s\n' "$turn_rows" | awk '/^cmd\t/ { sub(/^cmd\t/, ""); print }')
	agent_ids=$(printf '%s\n' "$turn_rows" | awk '/^agent\t/ { sub(/^agent\t/, ""); print }' | grep -v '^$' | sort -u)
	main_commands=$(printf '%s\n' "$turn_rows" | awk '/^cmd\t/ { n++ } END { print n + 0 }')
	subagent_dispatches=$(printf '%s\n' "$agent_ids" | grep -c .)

	# Delegated verification is the normal case here, so a check run inside a
	# subagent has to count. The join is the main transcript's `Agent`
	# `tool_use.id` against the sidecar's `.toolUseId` (verified equal). One
	# `jq` over every meta in the session dir, not one per file: a long
	# session accumulates dozens.
	sub_cmds=""
	subdir="${transcript%.jsonl}/subagents"
	if [ -n "$agent_ids" ] && [ -d "$subdir" ]; then
		# shellcheck disable=SC2016  # `$ids` is a jq binding from `--arg`, not a shell var.
		metas=$(jq -r --arg ids "$agent_ids" '
		  select(type == "object")
		  | .toolUseId as $tid
		  | select($tid != null)
		  | select(($ids | split("\n")) | index($tid))
		  | input_filename
		' "$subdir"/agent-*.meta.json 2>/dev/null | sort -u)
		sub_program='
		  select(type == "object" and .type == "assistant")
		  | .message.content[]?
		  | select(.type == "tool_use" and .name == "Bash")
		  | ((.input.command // "") | tostring | gsub("\n"; " "))
		'
		while IFS= read -r meta; do
			[ -n "$meta" ] || continue
			sub_transcript="${meta%.meta.json}.jsonl"
			[ -r "$sub_transcript" ] || continue
			rows=$(jq -r "$sub_program" "$sub_transcript" 2>/dev/null) || continue
			[ -n "$rows" ] || continue
			sub_cmds+="${rows}"$'\n'
		done <<<"$metas"
	fi
	subagent_commands=$(printf '%s' "$sub_cmds" | grep -c .)

	# One `grep -E` per family over the whole joined blob, never one per
	# command. Measured on the corpus's heaviest turn (249 `Bash` calls):
	# per-command 5.351s against `timeout: 10`, whole-blob 0.007s. The
	# difference is not cosmetic — a timeout kill writes nothing at all,
	# because the record is a single `printf` at the very end, so no
	# `degraded` line for it is reachable by construction.
	while IFS= read -r family; do
		[ -n "$family" ] || continue
		re=$(evidence_regex "$family")
		grep -qiE "$re" <<<"$main_cmds" && backed_main+="${family}"$'\n'
		grep -qiE "$re" <<<"$sub_cmds" && backed_sub+="${family}"$'\n'
	done <<<"$claim_list"

	# Session-scoped, not turn-scoped: the guidance skills govern prose drafted
	# across a whole session, and a `Stop` hook is the only place a draft that
	# never became a file is visible at all. The `<command-name>` alternative
	# catches the slash-command form, which issues no `Skill` tool call.
	skill_program='
	  select(type == "object" and .type == "assistant")
	  | .message.content[]?
	  | select(.type == "tool_use" and .name == "Skill")
	  | (.input.skill // "" | tostring)
	'
	if jq -r "$skill_program" "$transcript" 2>/dev/null |
		grep -qxE '(writing-docs|composing-context)'; then
		guidance_skill=true
	elif grep -qE '<command-name>/?(writing-docs|composing-context)<' "$transcript" 2>/dev/null; then
		guidance_skill=true
	fi
fi

# A family claimed with no matching command anywhere. This is the number the
# enforcement decision turns on, and it is only interpretable beside
# `claim_families` — neither is meaningful alone.
unbacked=""
while IFS= read -r family; do
	[ -n "$family" ] || continue
	case $'\n'"${backed_main}${backed_sub}" in
	*$'\n'"$family"$'\n'*) ;;
	*) unbacked+="${family}"$'\n' ;;
	esac
done <<<"$claim_list"

# `jq -n` builds the whole line and a single `>>` appends it. Two worktrees log
# to this file; an O_APPEND write under 4096 bytes is atomic on Linux and a
# sequence of writes is not, and the resulting interleave is silent. That is
# also why no field here carries free text — no claim excerpt, no command text,
# no message snippet.
#
# `v` is the schema version. Fields get added to this line later, and without it
# nobody can tell which lines predate which field.
#
# shellcheck disable=SC2016  # `$date` and friends are jq bindings from `--arg`, not shell vars.
line=$(jq -nc \
	--arg date "$(now)" \
	--arg session "$session" \
	--arg prompt_id "$prompt_id" \
	--arg cwd "$cwd" \
	--arg claims "$claim_list" \
	--arg backed_main "$backed_main" \
	--arg backed_sub "$backed_sub" \
	--arg unbacked "$unbacked" \
	--arg deg "$degraded_reason" \
	--argjson measured "$measured" \
	--argjson main_commands "$main_commands" \
	--argjson subagent_dispatches "$subagent_dispatches" \
	--argjson subagent_commands "$subagent_commands" \
	--argjson stop_active "$stop_active" \
	--argjson guidance "$guidance_skill" '
	def list: split("\n") | map(select(length > 0)) | sort;
	{
	  v: 1,
	  event: "turn",
	  date: $date,
	  session_id: ($session | if . == "" then null else . end),
	  prompt_id: ($prompt_id | if . == "" then null else . end),
	  cwd: ($cwd | if . == "" then null else . end),
	  claim_families: ($claims | list),
	  backed_in_main: (if $measured then ($backed_main | list) else null end),
	  backed_in_subagent: (if $measured then ($backed_sub | list) else null end),
	  unbacked_families: (if $measured then ($unbacked | list) else null end),
	  main_commands: (if $measured then $main_commands else null end),
	  subagent_dispatches: (if $measured then $subagent_dispatches else null end),
	  subagent_commands: (if $measured then $subagent_commands else null end),
	  stop_hook_active: $stop_active,
	  guidance_skill_invoked: (if $measured then $guidance else null end),
	  degraded: ($deg | if . == "" then null else . end)
	}' 2>/dev/null) || degraded jq-build-failed
[ -n "$line" ] || degraded jq-build-failed
printf '%s\n' "$line" >>"$log" 2>/dev/null
exit 0
