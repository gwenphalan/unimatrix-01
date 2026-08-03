// A worktree gets none of the main checkout's gitignored working directories
// — `.notes/` and the untracked contents of `lab/prototypes/` — because git
// worktrees only ever populate tracked files. Copying was considered and
// rejected: a copy diverges from the original and is discarded when the
// worktree is removed, losing whatever was written there. A symlink keeps
// one source of truth in the main checkout.
//
// The two directories are not symmetric.
//
// `.notes/` is entirely untracked (`git ls-files .notes` is empty), so the
// whole directory is symlinked in one piece.
//
// `lab/prototypes/` has two tracked files, `.gitkeep` and `README.md`
// (`.gitignore` ignores `lab/prototypes/*` then negates both), which
// `.github/workflows/prototypes-guard.yml` allowlists as the only things
// `lab/prototypes/` may hold on `main`. Symlinking the directory itself would
// shadow those two tracked files with the main checkout's copies, and git in
// the worktree would report both as deleted. So each untracked entry inside
// it is symlinked individually, leaving the two tracked files as real files.
//
// Prototype *creation* is a main-checkout-only workflow (its own skill); a
// worktree only ever needs to read one a PR references. So this only reads
// from the main checkout into the worktree, never the reverse — nothing here
// syncs a prototype created inside a worktree back out.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// The whole-directory case (symlink the directory itself) and the
// per-entry case (symlink everything inside it except these tracked names).
const LINK_TARGETS = [
  { relPath: ".notes", mode: "whole-directory" },
  { relPath: "lab/prototypes", mode: "entries", excludeNames: new Set([".gitkeep", "README.md"]) },
];

function toRepoRelativePath(absPath) {
  return relative(REPO_ROOT, absPath).replaceAll("\\", "/");
}

/**
 * The main checkout's root, found via the git-common-dir every worktree
 * shares — a worktree's own `--show-toplevel` names the worktree, not the
 * main checkout, so that route would just symlink a directory to itself.
 * Returns `null` when git cannot answer (not a repo at all), which the
 * caller treats the same as "nothing to link" rather than an error.
 */
function findMainCheckoutRoot() {
  let commonDir;
  try {
    commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
  return dirname(resolve(REPO_ROOT, commonDir));
}

function entryKind(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return "none";
  }
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function isSameRealPath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Symlinks `targetPath` -> `sourcePath`, skipping (never overwriting) whatever is already there. */
function linkOne(sourcePath, targetPath, relLabel) {
  const kind = entryKind(targetPath);

  if (kind === "symlink") {
    if (isSameRealPath(targetPath, sourcePath)) {
      return { relLabel, status: "already-linked" };
    }
    return {
      relLabel,
      status: "skipped",
      detail: `already a symlink to ${readlinkSync(targetPath)}`,
    };
  }
  if (kind !== "none") {
    return { relLabel, status: "skipped", detail: `a real ${kind} is already there` };
  }

  const sourceIsDir = lstatSync(sourcePath).isDirectory();
  symlinkSync(sourcePath, targetPath, sourceIsDir ? "dir" : "file");
  return { relLabel, status: "linked" };
}

function linkWholeDirectory(mainRoot, relPath) {
  const sourcePath = join(mainRoot, relPath);
  const targetPath = join(REPO_ROOT, relPath);
  if (!existsSync(sourcePath)) {
    return [{ relLabel: relPath, status: "source-missing" }];
  }
  return [linkOne(sourcePath, targetPath, relPath)];
}

function linkDirectoryEntries(mainRoot, relPath, excludeNames) {
  const sourceDir = join(mainRoot, relPath);
  const targetDir = join(REPO_ROOT, relPath);
  if (!existsSync(sourceDir)) {
    return [{ relLabel: relPath, status: "source-missing" }];
  }
  // The two tracked scaffolding files already put a real directory here in
  // the worktree; this only exists as a fallback if that ever stops holding.
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const results = [];
  for (const name of readdirSync(sourceDir)) {
    if (excludeNames.has(name)) continue;
    const relLabel = `${relPath}/${name}`;
    results.push(linkOne(join(sourceDir, name), join(targetDir, name), relLabel));
  }
  return results;
}

/**
 * Links every gitignored working directory this repo knows about from the
 * main checkout into the current one. Returns an empty array — doing
 * nothing, never erroring — when the current checkout *is* the main
 * checkout (nothing to link) or git cannot identify one at all.
 */
export function linkGitignoredWorktreeDirs() {
  const mainRoot = findMainCheckoutRoot();
  if (mainRoot === null || resolve(mainRoot) === resolve(REPO_ROOT)) {
    return [];
  }

  const results = [];
  for (const target of LINK_TARGETS) {
    if (target.mode === "whole-directory") {
      results.push(...linkWholeDirectory(mainRoot, target.relPath));
    } else {
      results.push(...linkDirectoryEntries(mainRoot, target.relPath, target.excludeNames));
    }
  }
  return results;
}

export function printLinkGitignoredWorktreeDirs(results) {
  if (results.length === 0) {
    console.log("Not a worktree (or no git-common-dir found) — nothing to link.");
    return;
  }

  for (const result of results) {
    switch (result.status) {
      case "linked":
        console.log(`Linked ${result.relLabel} -> main checkout`);
        break;
      case "already-linked":
        console.log(`Already linked ${result.relLabel}`);
        break;
      case "skipped":
        console.log(`Left untouched ${result.relLabel} (${result.detail})`);
        break;
      case "source-missing":
        console.log(`Skipped ${result.relLabel} (main checkout has none)`);
        break;
      default:
        console.log(`Unknown status for ${result.relLabel}: ${result.status}`);
    }
  }
}
