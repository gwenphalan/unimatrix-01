#!/usr/bin/env node
//
// Fails when the owner's scratch directory is tracked by git.
//
// This guards a failure that already destroyed `.notes/` once. `setup:worktree`
// links `.notes` into each worktree as a symlink so both checkouts share one
// copy. `.gitignore` listed `.notes/` with a trailing slash, which matches
// directories only — so in a worktree the symlink was not ignored, `git add -A`
// staged it, and the commit shipped a `.notes` symlink pointing at the main
// checkout's own `.notes`. Checking that commit out in the main checkout
// replaced the real directory with a symlink to itself, taking every file in it.
// Git warns about none of this: overwriting an ignored path is silent and exits 0.
//
// Two checks, because neither alone would have caught it:
//
//   1. The scratch roots must not be tracked *at all*. This is the one that
//      fires on the original bug, where the path was tracked precisely because
//      it was not ignored.
//   2. No tracked path may also be ignored. This catches the same accident
//      arriving by any other route once the ignore rule is correct — a force-add,
//      a stale index entry, a rule that starts matching later.
//
// Runs in `pnpm check`, `pnpm verify`, and the repo's pre-commit hook. Exits 0
// where git cannot answer at all (no repository), the same way the other infra
// guards do, so a Docker build that excludes `.git` is unaffected.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directories that exist only in a working tree and must never enter a commit. */
const SCRATCH_ROOTS = [".notes", ".issues"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  // "No repository" is established by its own call, so it is the only condition
  // that skips. Wrapping the `ls-files` calls in the same catch would turn any
  // git or index error into a silent pass — the opposite of what a guard is for.
  try {
    if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
      console.log("check-scratch-not-tracked: no git repository here, skipping.");
      return;
    }
  } catch {
    console.log("check-scratch-not-tracked: no git repository here, skipping.");
    return;
  }

  let trackedScratch;
  let trackedAndIgnored;
  try {
    trackedScratch = git(["ls-files", "--", ...SCRATCH_ROOTS]).trim();
    trackedAndIgnored = git(["ls-files", "-i", "-c", "--exclude-standard"]).trim();
  } catch (error) {
    console.error(
      `check-scratch-not-tracked: FAILED — git could not be queried in a repository it ` +
        `reported being inside: ${error.message}`,
    );
    process.exit(1);
  }

  const failures = [];
  if (trackedScratch) {
    failures.push(
      `These scratch paths are tracked by git and must not be:\n` +
        trackedScratch
          .split("\n")
          .map((p) => `  ${p}`)
          .join("\n") +
        `\n\nUntrack them with \`git rm --cached <path>\` and make sure .gitignore lists the\n` +
        `root without a trailing slash, so a symlink of that name is ignored too.`,
    );
  }
  if (trackedAndIgnored) {
    failures.push(
      `These paths are tracked *and* matched by .gitignore, which means a checkout\n` +
        `can overwrite working-tree content git never warns about:\n` +
        trackedAndIgnored
          .split("\n")
          .map((p) => `  ${p}`)
          .join("\n"),
    );
  }

  if (failures.length > 0) {
    console.error(`check-scratch-not-tracked: FAILED\n\n${failures.join("\n\n")}`);
    process.exit(1);
  }

  console.log("check-scratch-not-tracked: ok");
}

main();
