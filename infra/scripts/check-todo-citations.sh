#!/usr/bin/env bash
#
# Drives the real resolve-todo-citations.mjs against throwaway git repos built
# here, not against this repo's own .notes/ — that directory is gitignored, so
# a clone (and CI) has none of it, and a check that only reads it would pass
# vacuously over nothing.
#
# Case 2 is the load-bearing one: a pure insertion right after the cited line
# (`@@ -2,0 +3,2 @@`, old count 0) previously shifted a citation the insertion
# never touched, because `a + b - 1 < L` with `b == 0` reads the line the
# insertion follows as the line it changed. A regression here reproduces that
# exact bug.
#
# Fails closed: if no case actually ran, that is a failure, not a vacuous pass.
#
# shellcheck disable=SC2016
# The expected-output strings are markdown: a References entry wraps its path in
# backticks. Single quotes are what keeps those backticks literal, which is the
# whole point — SC2016 reads them as an intended command substitution instead.

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
resolver="${script_dir}/resolve-todo-citations.mjs"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

failures=0
ran=0

fail() {
  failures=$((failures + 1))
  printf '  FAIL  %s\n' "$1"
}

# A fresh repo under $work, git-initialized with a commit identity but no
# commits yet.
new_repo() {
  local dir="${work}/$1"
  mkdir -p "${dir}"
  (cd "${dir}" && git init -q && git config user.email t@t.com && git config user.name t)
  printf '%s' "${dir}"
}

write_todo() {
  local dir=$1 citation=$2
  mkdir -p "${dir}/.notes/01-todo"
  cat >"${dir}/.notes/01-todo/x.todo.md" <<EOF
- **feat(x): thing**

  - **References:**
     a. \`${citation}\`
EOF
}

run_resolver() {
  (cd "$1" && node "${resolver}" .notes/01-todo/x.todo.md)
}

todo_body() {
  tail -n +2 "$1/.notes/01-todo/x.todo.md"
}

# Runs the resolver in $dir and diffs its stdout/exit code against what this
# case says they should be. Expected stdout on stdin.
check() {
  local name=$1 want_rc=$2 dir=$3
  local expected actual rc
  expected=$(cat)
  ran=$((ran + 1))
  actual=$(run_resolver "${dir}")
  rc=$?
  if [ "${actual}" = "${expected}" ] && [ "${rc}" = "${want_rc}" ]; then
    printf '  ok    %s\n' "${name}"
  else
    fail "${name} (exit ${rc}, wanted ${want_rc})"
    diff <(printf '%s\n' "${expected}") <(printf '%s\n' "${actual}") | sed 's/^/        /'
  fi
}

printf 'check-todo-citations: resolve-todo-citations.mjs against synthetic repos\n\n'

# --- case 1: pure insertion above the cited line — citation shifts ---------

dir=$(new_repo case1-insert-above)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

sed -i '1i inserted' "${dir}/f.txt"

check case1-insert-above 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  moved       f.txt:3 -> :4

  1 rewritten
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:4`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case1-insert-above-rewrites-file\n'
else
  fail "case1-insert-above-rewrites-file (citation was not rewritten to :4 in the file)"
fi

# --- case 2: insertion immediately at the citation — citation stays --------
# The regression test: cite f.txt:2, insert two lines *after* line 2
# (`@@ -2,0 +3,2 @@`). A `:4` here is the previously-measured bug reproducing.

dir=$(new_repo case2-insert-at-citation)
printf 'l1\nl2\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:2"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

printf 'l1\nl2\nnew1\nnew2\n' >"${dir}/f.txt"

check case2-insert-at-citation 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  1 citation(s) with line numbers, all confirmed fresh
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:2`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case2-insert-at-citation-unchanged\n'
else
  fail "case2-insert-at-citation-unchanged (citation moved off :2)"
fi

# --- case 3: cited line edited in place — annotated, baseline untouched ----

dir=$(new_repo case3-edited-in-place)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null
sidecar_before=$(cat "${dir}/.notes/.todo-citations.json")

sed -i '3s/.*/l3-edited/' "${dir}/f.txt"

check case3-edited-in-place 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  line changed or removed

  1 needs attention
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:3` — STALE: line changed or removed')" ]; then
  ran=$((ran + 1))
  printf '  ok    case3-edited-in-place-annotated\n'
else
  fail "case3-edited-in-place-annotated (annotation missing or path/line rewritten)"
fi

ran=$((ran + 1))
if [ "$(cat "${dir}/.notes/.todo-citations.json")" = "${sidecar_before}" ]; then
  printf '  ok    case3-baseline-untouched-on-failure\n'
else
  fail "case3-baseline-untouched-on-failure (rev/text changed on an unresolved citation)"
fi

# --- case 4: committed rename with high similarity — annotated, path kept -

dir=$(new_repo case4-renamed)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

(cd "${dir}" && git mv f.txt g.txt && git commit -q -m rename)

check case4-renamed 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  file moved to `g.txt`

  1 needs attention
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:3` — STALE: file moved to `g.txt`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case4-renamed-path-not-rewritten\n'
else
  fail "case4-renamed-path-not-rewritten (path was rewritten to g.txt instead of annotated)"
fi

# --- case 5: file deleted --------------------------------------------------

dir=$(new_repo case5-deleted)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

(cd "${dir}" && git rm -q f.txt && git commit -q -m delete)

check case5-deleted 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  file deleted

  1 needs attention
EOF

# --- case 6: untracked cited file — resolved by content match, not diff ---
# The .notes/ case: the cited file is never `git add`ed, so it never appears
# in `git diff` no matter how it changes on disk.

dir=$(new_repo case6-untracked)
printf 'placeholder\n' >"${dir}/placeholder.txt"
(cd "${dir}" && git add -A && git commit -q -m init)
mkdir -p "${dir}/.notes"
printf 'i1\ni2\ni3\ni4\ni5\n' >"${dir}/.notes/untracked.md"
write_todo "${dir}" ".notes/untracked.md:3"
run_resolver "${dir}" >/dev/null

sed -i '1i x1\nx2' "${dir}/.notes/untracked.md"

check case6-untracked 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  recovered   .notes/untracked.md:3 -> :5  (by content match; diff said :3)

  1 recovered
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `.notes/untracked.md:5`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case6-untracked-recovered-by-content\n'
else
  fail "case6-untracked-recovered-by-content (citation was not rewritten to :5 via content match)"
fi

# --- case 7: idempotence — running twice with no change is a byte-noop ----

dir=$(new_repo case7-idempotent)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null
sed -i '1i inserted' "${dir}/f.txt"
run_resolver "${dir}" >/dev/null

todo_before=$(cat "${dir}/.notes/01-todo/x.todo.md")
sidecar_before=$(cat "${dir}/.notes/.todo-citations.json")
run_resolver "${dir}" >/dev/null
todo_after=$(cat "${dir}/.notes/01-todo/x.todo.md")
sidecar_after=$(cat "${dir}/.notes/.todo-citations.json")

ran=$((ran + 1))
if [ "${todo_before}" = "${todo_after}" ] && [ "${sidecar_before}" = "${sidecar_after}" ]; then
  printf '  ok    case7-idempotent\n'
else
  fail "case7-idempotent (a repeat run with no intervening change altered the file or sidecar)"
fi

# --- case 8: inline path:line in prose — reported, never rewritten ---------
# The gap the References-only resolver can't see: a citation written inline
# outside a References block, rather than as a lettered entry.

dir=$(new_repo case8-inline-citation)
mkdir -p "${dir}/.notes/01-todo"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **Description:**
    See `f.txt:3-5` for the details.
EOF
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
(cd "${dir}" && git add -A && git commit -q -m init)
todo_before_case8=$(cat "${dir}/.notes/01-todo/x.todo.md")

check case8-inline-citation 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  INLINE      f.txt:3-5  (line 4) — move to a References entry

  1 inline
EOF

ran=$((ran + 1))
if [ "$(cat "${dir}/.notes/01-todo/x.todo.md")" = "${todo_before_case8}" ]; then
  printf '  ok    case8-inline-citation-file-unchanged\n'
else
  fail "case8-inline-citation-file-unchanged (inline citation was rewritten or annotated)"
fi

ran=$((ran + 1))
if [ ! -e "${dir}/.notes/.todo-citations.json" ]; then
  printf '  ok    case8-inline-citation-no-sidecar\n'
else
  fail "case8-inline-citation-no-sidecar (a sidecar record was created for an inline-only file)"
fi

# --- case 9: a URL with a port in a References entry — skipped, not read ---
# as path `https://example.com`, line `8080`. Covers both the backticked
# entry form (fails the URL-scheme guard) and the un-backticked form (never
# even matches ENTRY_RE, since that requires a backticked token).

dir=$(new_repo case9-url-with-port)
mkdir -p "${dir}/.notes/01-todo"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **References:**
     a. `https://example.com:8080`
     b. PR #208
EOF
(cd "${dir}" && git add -A && git commit -q -m init)

check case9-url-with-port 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  0 citations with line numbers
EOF

ran=$((ran + 1))
if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `https://example.com:8080`\n     b. PR #208')" ]; then
  printf '  ok    case9-url-with-port-file-unchanged\n'
else
  fail "case9-url-with-port-file-unchanged (URL or PR entry was mistaken for a citation)"
fi

ran=$((ran + 1))
if [ ! -e "${dir}/.notes/.todo-citations.json" ]; then
  printf '  ok    case9-url-with-port-no-sidecar\n'
else
  fail "case9-url-with-port-no-sidecar (a sidecar record was created for a non-citation entry)"
fi

# --- case 10: two entries citing the identical path:line in one file ------
# Both must resolve to the same place, in lockstep, off one sidecar record.
# The regression this reproduces: the first entry used to resolve, re-key
# the sidecar record to its new citation text, and delete the old key; the
# second entry then found no record under the old key, treated itself as
# first-seen, and baselined against whatever now sat at the stale line
# number — silently recording a wrong answer as correct, with no later run
# able to self-correct it.

dir=$(new_repo case10-duplicate-citation)
printf 'A\nB\nTARGET\nD\nE\n' >"${dir}/f.txt"
mkdir -p "${dir}/.notes/01-todo"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **References:**
     a. `f.txt:3`
     b. `f.txt:3`
EOF
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

sed -i '1i x1\nx2' "${dir}/f.txt"

check case10-duplicate-citation 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  moved       f.txt:3 -> :5

  1 rewritten
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:5`\n     b. `f.txt:5`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case10-duplicate-citation-both-rewritten\n'
else
  fail "case10-duplicate-citation-both-rewritten (the two occurrences disagreed, or one was left stale)"
fi

record_count=$(node -e '
  const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log(Object.keys(data.files[".notes/01-todo/x.todo.md"]).length);
' "${dir}/.notes/.todo-citations.json")
ran=$((ran + 1))
if [ "${record_count}" = "1" ]; then
  printf '  ok    case10-duplicate-citation-one-sidecar-record\n'
else
  fail "case10-duplicate-citation-one-sidecar-record (sidecar holds ${record_count} records, wanted 1)"
fi

todo_before_case10=$(cat "${dir}/.notes/01-todo/x.todo.md")
sidecar_before_case10=$(cat "${dir}/.notes/.todo-citations.json")
run_resolver "${dir}" >/dev/null
ran=$((ran + 1))
if [ "$(cat "${dir}/.notes/01-todo/x.todo.md")" = "${todo_before_case10}" ] &&
  [ "$(cat "${dir}/.notes/.todo-citations.json")" = "${sidecar_before_case10}" ]; then
  printf '  ok    case10-duplicate-citation-idempotent\n'
else
  fail "case10-duplicate-citation-idempotent (a repeat run changed the file or sidecar)"
fi

# --- case 11: symlinked .notes/ (the worktree case) — one sidecar key -----
# infra/scripts/link-worktree-dirs.mjs symlinks .notes/ into every new
# worktree. `discoverRepoRoot` resolves that symlink (it shells out to git,
# which does), but the unresolved path used to leak into the sidecar key via
# `relative()`, producing a second, `../`-laden key for the same physical
# file depending on which path the resolver was invoked through.

dir=$(new_repo case11-symlinked-notes)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

worktree_dir="${work}/case11-worktree"
mkdir -p "${worktree_dir}"
ln -s "${dir}/.notes" "${worktree_dir}/.notes"

sed -i '1i inserted' "${dir}/f.txt"

check case11-symlinked-notes 0 "${worktree_dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  moved       f.txt:3 -> :4

  1 rewritten
EOF

key_report=$(node -e '
  const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const keys = Object.keys(data.files);
  console.log(keys.length + "|" + keys.join(","));
' "${dir}/.notes/.todo-citations.json")
ran=$((ran + 1))
if [ "${key_report}" = "1|.notes/01-todo/x.todo.md" ]; then
  printf '  ok    case11-symlinked-notes-one-clean-key\n'
else
  fail "case11-symlinked-notes-one-clean-key (sidecar keys: ${key_report})"
fi

# Invoking directly (through the main checkout, not the symlink) must land
# on the same key and see it as already resolved, not re-baseline it.
check case11-direct-after-symlink 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  1 citation(s) with line numbers, all confirmed fresh
EOF

todo_before_case11=$(cat "${worktree_dir}/.notes/01-todo/x.todo.md")
sidecar_before_case11=$(cat "${dir}/.notes/.todo-citations.json")
run_resolver "${worktree_dir}" >/dev/null
ran=$((ran + 1))
if [ "$(cat "${worktree_dir}/.notes/01-todo/x.todo.md")" = "${todo_before_case11}" ] &&
  [ "$(cat "${dir}/.notes/.todo-citations.json")" = "${sidecar_before_case11}" ]; then
  printf '  ok    case11-symlinked-notes-idempotent\n'
else
  fail "case11-symlinked-notes-idempotent (a repeat run through the symlink changed the file or sidecar)"
fi

# --- case 12: diff.noprefix/mnemonicPrefix in the target repo's own config -
# `diff --git a/... b/...` becomes `diff --git f.txt f.txt` under either
# setting, which DIFF_GIT_RE doesn't match — the diff map comes back empty and
# a rename reads as untouched instead of stale. Pinned via `-c` on every git
# invocation in the wrapper, so it must hold even when the repo being resolved
# sets the opposite locally.

dir=$(new_repo case12-noprefix-config)
(cd "${dir}" && git config diff.noprefix true && git config diff.mnemonicPrefix true)
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
write_todo "${dir}" "f.txt:3"
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

(cd "${dir}" && git mv f.txt g.txt && git commit -q -m rename)

check case12-noprefix-config 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  file moved to `g.txt`

  1 needs attention
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:3` — STALE: file moved to `g.txt`')" ]; then
  ran=$((ran + 1))
  printf '  ok    case12-noprefix-config-rename-detected\n'
else
  fail "case12-noprefix-config-rename-detected (rename went undetected under diff.noprefix/mnemonicPrefix)"
fi

# --- case 13: trailing prose on a References entry survives a rewrite -----
# reconstructLine used to discard ENTRY_RE's captured suffix outright, so any
# owner-written text after the backticked citation was silently deleted the
# first time the cited line moved or went stale.

# (a) trailing prose + a line that merely moved: prose survives, line updates.
dir=$(new_repo case13a-trailing-prose-moves)
mkdir -p "${dir}/.notes/01-todo"
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **References:**
     a. `f.txt:3` — the merge loop
EOF
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

sed -i '1i inserted' "${dir}/f.txt"

check case13a-trailing-prose-moves 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  moved       f.txt:3 -> :4

  1 rewritten
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:4` — the merge loop')" ]; then
  ran=$((ran + 1))
  printf '  ok    case13a-trailing-prose-kept-on-move\n'
else
  fail "case13a-trailing-prose-kept-on-move (trailing prose was dropped when the line moved)"
fi

# (b) trailing prose + a line edited in place: exactly one STALE marker, prose kept.
dir=$(new_repo case13b-trailing-prose-goes-stale)
mkdir -p "${dir}/.notes/01-todo"
printf 'l1\nl2\nl3\nl4\nl5\n' >"${dir}/f.txt"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **References:**
     a. `f.txt:3` — important context
EOF
(cd "${dir}" && git add -A && git commit -q -m init)
run_resolver "${dir}" >/dev/null

sed -i '3s/.*/l3-edited/' "${dir}/f.txt"

check case13b-trailing-prose-goes-stale 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  line changed or removed

  1 needs attention
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:3` — important context — STALE: line changed or removed')" ]; then
  ran=$((ran + 1))
  printf '  ok    case13b-trailing-prose-kept-on-stale\n'
else
  fail "case13b-trailing-prose-kept-on-stale (prose lost, or not exactly one STALE marker)"
fi

# (c) an already-annotated entry (prose + an existing STALE marker) re-run
# must not accumulate a second marker or lose the prose.
dir=$(new_repo case13c-no-marker-accumulation)
mkdir -p "${dir}/.notes/01-todo"
cat >"${dir}/.notes/01-todo/x.todo.md" <<'EOF'
- **feat(x): thing**

  - **References:**
     a. `f.txt:3` — important context — STALE: file not found
EOF
(cd "${dir}" && git add -A && git commit -q -m init)

check case13c-no-marker-accumulation 0 "${dir}" <<'EOF'
resolve-todo-citations: .notes/01-todo/x.todo.md

  STALE       f.txt:3  file not found

  1 needs attention
EOF

if [ "$(todo_body "${dir}")" = "$(printf '\n  - **References:**\n     a. `f.txt:3` — important context — STALE: file not found')" ]; then
  ran=$((ran + 1))
  printf '  ok    case13c-no-marker-accumulation\n'
else
  fail "case13c-no-marker-accumulation (marker accumulated, or prose lost)"
fi

printf '\n'

if ((ran == 0)); then
  fail "no case executed — the check cannot pass vacuously"
fi

if ((failures > 0)); then
  printf 'check-todo-citations: %d/%d case(s) failed\n' "${failures}" "${ran}"
  exit 1
fi

printf 'check-todo-citations: %d case(s), all passing\n' "${ran}"
