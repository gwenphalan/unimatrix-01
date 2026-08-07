#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
cleanup-branches.sh [--dry-run]

Deletes local branches this clone no longer needs: run from the main checkout,
after `ExitWorktree` and only once `gh pr view <pr> --json state` reads
MERGED. Prints what it did, one line per branch, then a summary count.

GitHub deletes a merged branch server-side (`deleteBranchOnMerge`), but
nothing tells this clone — the local branch just sits there, and its
`%(upstream:track)` stays empty forever unless something prunes it. So:

  1. `git fetch --prune` — the enabling step, not hygiene. Without it, no
     branch reports `[gone]` and the squash sweep below selects nothing.
  2. Ancestor sweep: every local branch (except `main` and `HEAD`) that is a
     plain ancestor of `origin/main`, deleted with `git branch -d`. `-d`
     refuses anything not truly merged and anything checked out in another
     worktree, so this step cannot lose work by itself.
  3. Squash sweep: every branch whose upstream reads `[gone]` after the
     prune. A squash-merged branch is never an ancestor of `origin/main` —
     its commits were rewritten into one — so `-d` always refuses it and
     `-D` is the only way to remove it. `-D` has no refusal to fall back on,
     so before using it this rebuilds the squash the merge would have
     produced and compares it to `origin/main` by patch-id:

       probe=$(git commit-tree "refs/heads/$b^{tree}" \
                 -p "$(git merge-base origin/main "refs/heads/$b")" \
                 -m squash-probe)
       git cherry origin/main "$probe"

     A leading `-` on that line means the probe's patch already exists in
     `origin/main` — the branch was genuinely squash-merged, and only then
     is `-D` used. Anything else is left alone and named on stdout for a
     human to look at; the test could not confirm it, which is not the same
     claim as "unmerged". (A branch that went through `gh pr update-branch`
     and was then squash-merged can read this way if `main` touched an
     adjacent line in the same file afterward — patch-id normalises line
     numbers, not surrounding context.)

Every failure direction here is "keep, and say why": a missing merge-base,
a `git commit-tree` that errors, an unreadable `git cherry` — all fall to
the kept-and-unconfirmed bucket rather than to deletion. An offline or
failing `git fetch --prune` makes the squash sweep select nothing, not
everything.

`--dry-run` prints exactly what would happen without deleting anything,
including running the fetch (`git fetch --prune` is not destructive to a
branch, so it still runs).

Recoverable: `git branch -D` prints `Deleted branch X (was <sha>).`, and
`git branch X <sha>` brings it back as long as nothing has since garbage-
collected that commit.

Arguments:
  --dry-run  Report what would be deleted; delete nothing.

Exit codes:
  0  the sweep ran to completion, whether or not anything was deleted
  1  bad usage
EOF
}

dry_run=0
case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  --dry-run)
    dry_run=1
    shift
    ;;
esac

if [ "$#" -gt 0 ]; then
  usage >&2
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "cleanup-branches.sh: not inside a git repository" >&2
  exit 1
fi

if ! git fetch --prune; then
  echo "cleanup-branches.sh: git fetch --prune failed — continuing offline, nothing will read as [gone]" >&2
fi

ancestor_deleted=0
ancestor_kept=0
squash_deleted=0
squash_kept=0

# --- Ancestor sweep ----------------------------------------------------

ancestor_candidates=()
if merged_output=$(git branch --merged origin/main --format='%(refname:short)' 2>&1); then
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    [ "$b" = "main" ] && continue
    [ "$b" = "HEAD" ] && continue
    ancestor_candidates+=("$b")
  done <<<"$merged_output"
else
  echo "cleanup-branches.sh: git branch --merged origin/main failed — skipping the ancestor sweep ($merged_output)" >&2
fi

for b in ${ancestor_candidates+"${ancestor_candidates[@]}"}; do
  if [ "$dry_run" -eq 1 ]; then
    printf 'would delete (ancestor of origin/main): %s\n' "$b"
    ancestor_deleted=$((ancestor_deleted + 1))
    continue
  fi
  if out=$(git branch -d -- "$b" 2>&1); then
    printf '%s\n' "$out"
    ancestor_deleted=$((ancestor_deleted + 1))
  else
    printf 'kept (git refused to delete %s): %s\n' "$b" "$out" >&2
    ancestor_kept=$((ancestor_kept + 1))
  fi
done

# --- Squash sweep --------------------------------------------------------
# Re-read the gone list now, after the ancestor sweep: anything it already
# deleted no longer shows up here, so there is no double-processing.

squash_candidates=()
while IFS=$'\t' read -r name track; do
  [ -z "$name" ] && continue
  [ "$name" = "main" ] && continue
  case "$track" in
    *'[gone]'*) squash_candidates+=("$name") ;;
  esac
done < <(git for-each-ref --format='%(refname:short)%09%(upstream:track)' refs/heads/)

for b in ${squash_candidates+"${squash_candidates[@]}"}; do
  keep_reason=""
  mb=""
  if ! mb=$(git merge-base origin/main "refs/heads/$b" 2>/dev/null); then
    mb=""
  fi
  probe=""
  if [ -n "$mb" ]; then
    if ! probe=$(git commit-tree "refs/heads/$b^{tree}" -p "$mb" -m squash-probe 2>/dev/null); then
      probe=""
    fi
  fi
  if [ -z "$mb" ] || [ -z "$probe" ]; then
    keep_reason="could not rebuild a squash probe to compare"
  else
    cherry_line=$(git cherry origin/main "$probe" 2>/dev/null || true)
    case "$cherry_line" in
      -*) ;; # patch-id matches something already in origin/main — safe to delete
      *) keep_reason="squash probe did not match origin/main — test could not confirm this was merged" ;;
    esac
  fi

  if [ -n "$keep_reason" ]; then
    printf 'kept (%s): %s\n' "$keep_reason" "$b"
    squash_kept=$((squash_kept + 1))
    continue
  fi

  if [ "$dry_run" -eq 1 ]; then
    printf 'would delete (squash-merged into origin/main): %s\n' "$b"
    squash_deleted=$((squash_deleted + 1))
    continue
  fi

  if out=$(git branch -D -- "$b" 2>&1); then
    printf '%s\n' "$out"
    squash_deleted=$((squash_deleted + 1))
  else
    printf 'kept (git refused to delete %s): %s\n' "$b" "$out" >&2
    squash_kept=$((squash_kept + 1))
  fi
done

mode="deleted"
[ "$dry_run" -eq 1 ] && mode="would delete"
printf '\n%s %s branch(es) (ancestor), %s branch(es) (squash-merged); kept %s (ancestor), %s (squash, unconfirmed)\n' \
  "$mode" "$ancestor_deleted" "$squash_deleted" "$ancestor_kept" "$squash_kept"
