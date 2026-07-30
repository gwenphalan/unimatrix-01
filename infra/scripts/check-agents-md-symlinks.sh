#!/usr/bin/env bash
#
# Every AGENTS.md needs a sibling CLAUDE.md symlink pointing at it.
#
# Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and it discovers nested files
# on demand — a `CLAUDE.md` in a subdirectory is injected when a file in that
# directory is read. An `AGENTS.md` with no sibling symlink is therefore invisible
# to the tool: it reaches an agent only if something opens it deliberately.
#
# That is the failure this check exists to prevent, and it is silent. Nothing
# else notices. Lint, typecheck, tests and every image build pass while a
# workspace's constraints simply never arrive, and the symptom is an agent that
# violates a rule the repo believes it stated.
#
# Verified rather than assumed (2026-07-30, Claude Code 2.1.219): a plain nested
# CLAUDE.md and a nested `ln -s AGENTS.md CLAUDE.md` both load on reading a file
# in their directory. The one gap worth knowing is that nested files are not
# re-injected after `/compact` — they reload on the next read in that directory.
#
# Fails closed in every direction: a missing symlink, a regular file where the
# symlink should be, a symlink pointing somewhere other than its sibling
# AGENTS.md, and a CLAUDE.md with no AGENTS.md beside it are all failures.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"

cd "${repo_root}"

failures=0
checked=0

fail() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

printf 'check-agents-md-symlinks: every AGENTS.md needs a sibling CLAUDE.md\n\n'

# Direction 1: every AGENTS.md has a correct sibling symlink.
while IFS= read -r agents_file; do
  checked=$((checked + 1))
  dir="$(dirname "${agents_file}")"
  claude_file="${dir}/CLAUDE.md"
  rel_dir="${dir#./}"

  if [[ ! -e "${claude_file}" && ! -L "${claude_file}" ]]; then
    fail "${rel_dir}: no CLAUDE.md — this AGENTS.md never loads (fix: ln -s AGENTS.md ${claude_file})"
    continue
  fi

  if [[ ! -L "${claude_file}" ]]; then
    fail "${rel_dir}: CLAUDE.md is a regular file, not a symlink to AGENTS.md — the two will drift"
    continue
  fi

  target="$(readlink "${claude_file}")"
  if [[ "${target}" != "AGENTS.md" ]]; then
    fail "${rel_dir}: CLAUDE.md points at '${target}', not its sibling AGENTS.md"
    continue
  fi

  # A relative symlink can be well-formed and still dangle.
  if [[ ! -f "${claude_file}" ]]; then
    fail "${rel_dir}: CLAUDE.md -> AGENTS.md does not resolve to a file"
  fi
done < <(find . -name AGENTS.md -not -path '*/node_modules/*' | sort)

# Direction 2: no CLAUDE.md without an AGENTS.md beside it. Catches a rename
# that moved the content and left the symlink dangling, which direction 1 cannot
# see because it iterates AGENTS.md files.
while IFS= read -r claude_file; do
  dir="$(dirname "${claude_file}")"
  rel_dir="${dir#./}"
  if [[ ! -f "${dir}/AGENTS.md" ]]; then
    fail "${rel_dir}: CLAUDE.md with no AGENTS.md beside it — was the AGENTS.md renamed or deleted?"
  fi
done < <(find . -name CLAUDE.md -not -path '*/node_modules/*' | sort)

if ((checked == 0)); then
  fail "no AGENTS.md found anywhere — the check cannot pass vacuously"
fi

printf '\n'

if ((failures > 0)); then
  printf 'check-agents-md-symlinks: %d failure(s)\n' "${failures}"
  exit 1
fi

printf 'check-agents-md-symlinks: %d AGENTS.md files, all with a sibling CLAUDE.md symlink\n' "${checked}"
