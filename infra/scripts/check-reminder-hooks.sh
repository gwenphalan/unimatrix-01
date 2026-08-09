#!/usr/bin/env bash
#
# Drives the three doc-skill reminder hooks (writing-docs-reminder.sh,
# composing-context-reminder.sh, problem-solving-reminder.sh) against
# synthetic payloads and synthetic transcript fixtures built here, not
# against a live session — nothing in this repo can produce a real
# `PostToolUse`/`UserPromptSubmit` payload to test against.
#
# `TMPDIR` is exported to a throwaway directory before any script under test
# runs, so a fixture sentinel never collides with a live session's. All three
# scripts derive their sentinel path from `${TMPDIR:-/tmp}`, and `TMPDIR` is
# unset on this machine, so a real session's sentinels sit in bare `/tmp` —
# leaving `TMPDIR` unset here would let a fixture run read or write one.
#
# Each case is a stand-in for one branch of the loaded-skill detection in each
# script; see the comment above `skill_loaded()` in any of them for why the
# detection has the shape it does (two record shapes, cut at the last
# `compact_boundary`, jq's exit code ignored).
#
# Fails closed: if no case actually ran, that is a failure, not a vacuous pass.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
writing_docs="${script_dir}/writing-docs-reminder.sh"
composing_context="${script_dir}/composing-context-reminder.sh"
problem_solving="${script_dir}/problem-solving-reminder.sh"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
export TMPDIR="${work}"

failures=0
ran=0

fail() {
  failures=$((failures + 1))
  printf '  FAIL  %s\n' "$1"
}

# --- transcript record builders --------------------------------------------
# One jq invocation per line, so every record is well-formed JSON without
# hand-escaping. `base_marker` writes the exact opening line a skill body
# starts with — the shape `skill_loaded()` greps for in a real transcript.

line_boundary() {
  jq -nc '{type: "system", subtype: "compact_boundary"}'
}

# The `invoked_skills` attachment shape.
line_invoked_skills() {
  local skill=$1
  jq -nc --arg s "$skill" '{type: "system", attachment: {type: "invoked_skills", skills: [{name: $s}]}}'
}

# A top-level `user`/`text` block whose first line is the skill's own opening
# marker line — the shape a skill body-load actually produces.
line_user_marker() {
  local skill=$1
  jq -nc --arg s "$skill" \
    '{type: "user", message: {content: [{type: "text", text: ("Base directory for this skill: /home/x/.claude/skills/" + $s + "\n\n# body text")}]}}'
}

# Same marker, but inside a `tool_result` block (an agent having `Read` a
# transcript) rather than a top-level `text` block — must NOT count.
line_user_marker_tool_result() {
  local skill=$1
  jq -nc --arg s "$skill" \
    '{type: "user", message: {content: [{type: "tool_result", text: ("Base directory for this skill: /home/x/.claude/skills/" + $s)}]}}'
}

line_noise() {
  jq -nc '{type: "assistant", message: {content: [{type: "text", text: "hello"}]}}'
}

write_transcript() {
  local path=$1
  shift
  : >"$path"
  for line in "$@"; do
    printf '%s\n' "$line" >>"$path"
  done
}

# --- payload builders --------------------------------------------------------

# $1 file_path  $2 new_string  $3 session  $4 transcript_path (empty = field omitted)
payload_edit() {
  local file_path=$1 new_string=$2 session=$3 transcript=$4
  if [ -n "$transcript" ]; then
    jq -nc --arg fp "$file_path" --arg ns "$new_string" --arg sess "$session" --arg tp "$transcript" \
      '{tool_input: {file_path: $fp, new_string: $ns}, session_id: $sess, transcript_path: $tp}'
  else
    jq -nc --arg fp "$file_path" --arg ns "$new_string" --arg sess "$session" \
      '{tool_input: {file_path: $fp, new_string: $ns}, session_id: $sess}'
  fi
}

# $1 prompt  $2 session  $3 transcript_path (empty = field omitted)
payload_prompt() {
  local prompt=$1 session=$2 transcript=$3
  if [ -n "$transcript" ]; then
    jq -nc --arg p "$prompt" --arg sess "$session" --arg tp "$transcript" \
      '{prompt: $p, session_id: $sess, transcript_path: $tp}'
  else
    jq -nc --arg p "$prompt" --arg sess "$session" \
      '{prompt: $p, session_id: $sess}'
  fi
}

# --- sentinel paths, matching each script's own formula ---------------------

wd_sentinel() { printf '%s/claude-writing-docs-reminder-%s-%s' "$work" "$1" "$2"; }
cc_sentinel() { printf '%s/claude-composing-context-reminder-%s' "$work" "$1"; }
ps_sentinel() { printf '%s/claude-problem-solving-reminder-%s' "$work" "$1"; }

# --- assertion -----------------------------------------------------------
# $1 name  $2 script  $3 payload  $4 want_rc  $5 want_stdout (empty|nonempty)
# $6 sentinel_path  $7 want_sentinel (present|absent)
run_case() {
  local name=$1 script=$2 payload=$3 want_rc=$4 want_stdout=$5 sentinel=$6 want_sentinel=$7
  local stdout rc ok=1

  ran=$((ran + 1))
  stdout=$(printf '%s' "$payload" | bash "$script")
  rc=$?

  [ "$rc" = "$want_rc" ] || ok=0
  case "$want_stdout" in
  empty) [ -z "$stdout" ] || ok=0 ;;
  nonempty) [ -n "$stdout" ] || ok=0 ;;
  esac
  case "$want_sentinel" in
  present) [ -e "$sentinel" ] || ok=0 ;;
  absent) [ ! -e "$sentinel" ] || ok=0 ;;
  esac

  if [ "$ok" = 1 ]; then
    printf '  ok    %s\n' "$name"
  else
    fail "${name} (rc=${rc}, wanted ${want_rc}; stdout $([ -n "$stdout" ] && echo nonempty || echo empty), wanted ${want_stdout}; sentinel $([ -e "$sentinel" ] && echo present || echo absent), wanted ${want_sentinel})"
  fi
}

printf 'check-reminder-hooks: reminder scripts against synthetic payloads\n\n'

# --- case 1: writing-docs, .md edit, no skill records in transcript --------

t1="${work}/t1.jsonl"
write_transcript "$t1" "$(line_noise)"
p1=$(payload_edit "docs/foo.md" "" "case1" "$t1")
run_case "case1-writing-docs-no-records-fires" "$writing_docs" "$p1" 0 nonempty "$(wd_sentinel docs case1)" present

# --- case 2: writing-docs, .md edit, top-level user/text marker -----------

t2="${work}/t2.jsonl"
write_transcript "$t2" "$(line_user_marker writing-docs)"
p2=$(payload_edit "docs/foo.md" "" "case2" "$t2")
run_case "case2-writing-docs-marker-suppresses" "$writing_docs" "$p2" 0 empty "$(wd_sentinel docs case2)" absent

# --- case 3: marker before a boundary, invoked_skills after ---------------

t3="${work}/t3.jsonl"
write_transcript "$t3" \
  "$(line_user_marker writing-docs)" \
  "$(line_boundary)" \
  "$(line_invoked_skills writing-docs)"
p3=$(payload_edit "docs/foo.md" "" "case3" "$t3")
run_case "case3-loaded-after-boundary-suppresses" "$writing_docs" "$p3" 0 empty "$(wd_sentinel docs case3)" absent

# --- case 4: marker before a boundary, nothing after — stale, fires -------

t4="${work}/t4.jsonl"
write_transcript "$t4" \
  "$(line_user_marker writing-docs)" \
  "$(line_boundary)" \
  "$(line_noise)"
p4=$(payload_edit "docs/foo.md" "" "case4" "$t4")
run_case "case4-stale-marker-before-boundary-fires" "$writing_docs" "$p4" 0 nonempty "$(wd_sentinel docs case4)" present

# --- case 5: transcript_path points at a nonexistent file — fires ---------

p5=$(payload_edit "docs/foo.md" "" "case5" "${work}/does-not-exist.jsonl")
run_case "case5-unreadable-transcript-fires" "$writing_docs" "$p5" 0 nonempty "$(wd_sentinel docs case5)" present

# --- case 6: no transcript_path field at all — fires ----------------------

p6=$(payload_edit "docs/foo.md" "" "case6" "")
run_case "case6-no-transcript-path-fires" "$writing_docs" "$p6" 0 nonempty "$(wd_sentinel docs case6)" present

# --- case 7: valid marker records, then a truncated final line ------------
# Proves jq's exit 5 on the truncated last line is ignored rather than
# propagated — jq still emits the complete marker record on stdout before it
# dies on the incomplete one.

t7="${work}/t7.jsonl"
write_transcript "$t7" "$(line_user_marker writing-docs)"
printf '{"type":"user","message":{"content":[{"type":"text","tex' >>"$t7"
p7=$(payload_edit "docs/foo.md" "" "case7" "$t7")
run_case "case7-truncated-final-line-still-suppresses" "$writing_docs" "$p7" 0 empty "$(wd_sentinel docs case7)" absent

# --- case 8: .ts edit whose new_string opens with `//`, transcript loaded -

t8="${work}/t8.jsonl"
write_transcript "$t8" "$(line_user_marker writing-docs)"
p8=$(payload_edit "src/foo.ts" "// a comment" "case8" "$t8")
run_case "case8-comment-branch-suppressed" "$writing_docs" "$p8" 0 empty "$(wd_sentinel comments case8)" absent

# --- case 9: pre-existing sentinel + loaded transcript ---------------------
# Exits on the sentinel check, before the transcript is even scanned.

sentinel9=$(wd_sentinel docs case9)
: >"$sentinel9"
t9="${work}/t9.jsonl"
write_transcript "$t9" "$(line_user_marker writing-docs)"
p9=$(payload_edit "docs/foo.md" "" "case9" "$t9")
run_case "case9-preexisting-sentinel-short-circuits" "$writing_docs" "$p9" 0 empty "$sentinel9" present

# --- case 10: marker inside a tool_result block only, not a text block ----

t10="${work}/t10.jsonl"
write_transcript "$t10" "$(line_user_marker_tool_result writing-docs)"
p10=$(payload_edit "docs/foo.md" "" "case10" "$t10")
run_case "case10-tool-result-marker-excluded-fires" "$writing_docs" "$p10" 0 nonempty "$(wd_sentinel docs case10)" present

# --- case 11: composing-context, AGENTS.md edit, transcript loads ONLY
# writing-docs — proves per-skill matching, not "any skill loaded".

t11="${work}/t11.jsonl"
write_transcript "$t11" "$(line_user_marker writing-docs)"
p11=$(payload_edit "AGENTS.md" "" "case11" "$t11")
run_case "case11-composing-context-wrong-skill-fires" "$composing_context" "$p11" 0 nonempty "$(cc_sentinel case11)" present

# --- case 12: composing-context, same edit, transcript loads composing-context

t12="${work}/t12.jsonl"
write_transcript "$t12" "$(line_user_marker composing-context)"
p12=$(payload_edit "AGENTS.md" "" "case12" "$t12")
run_case "case12-composing-context-right-skill-suppresses" "$composing_context" "$p12" 0 empty "$(cc_sentinel case12)" absent

# --- case 13: problem-solving, judgement-shaped prompt, skill loaded ------

judgement_prompt="How should we approach this given the trade-offs involved here"
t13="${work}/t13.jsonl"
write_transcript "$t13" "$(line_user_marker problem-solving)"
p13=$(payload_prompt "$judgement_prompt" "case13" "$t13")
run_case "case13-problem-solving-loaded-suppresses" "$problem_solving" "$p13" 0 empty "$(ps_sentinel case13)" absent

# --- case 14: problem-solving, same prompt, no skill records --------------

t14="${work}/t14.jsonl"
write_transcript "$t14" "$(line_noise)"
p14=$(payload_prompt "$judgement_prompt" "case14" "$t14")
run_case "case14-problem-solving-no-records-fires" "$problem_solving" "$p14" 0 nonempty "$(ps_sentinel case14)" present

printf '\n'

if ((ran == 0)); then
  fail "no case executed — the check cannot pass vacuously"
fi

if ((failures > 0)); then
  printf 'check-reminder-hooks: %d/%d case(s) failed\n' "${failures}" "${ran}"
  exit 1
fi

printf 'check-reminder-hooks: %d case(s), all passing\n' "${ran}"
