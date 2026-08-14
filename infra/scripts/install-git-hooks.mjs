#!/usr/bin/env node
//
// Installs the repo's pre-commit hook, run by the root `prepare` script on
// every `pnpm install`.
//
// Resolves the real hooks directory with `git rev-parse --git-path hooks`
// rather than joining the working directory with `.git/hooks`. That join is
// the bug this script exists to avoid: in a linked git worktree, `.git` is a
// file holding a `gitdir:` pointer, not a directory, so the join throws
// ENOTDIR and the hook never installs. `--git-path hooks` follows the
// pointer instead, and prints a path relative to the current directory from
// a plain checkout but an absolute one from a worktree — `path.resolve`
// against the repo root handles both without a branch on which form it is.
//
// The Docker build stage installs from a `turbo prune --docker` tree, which
// never carries `infra/`, so this script no longer runs inside a build at
// all — the root `prepare` script guards the call on this file's own
// existence (see the root `package.json`) rather than relying on this
// script's own no-`.git` handling below.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_ENV_VAR = "UNIMATRIX_SKIP_GIT_HOOKS";
const MARKER =
  "# unimatrix-01 pre-commit hook (infra/scripts/install-git-hooks.mjs) — do not hand-edit";
// The scratch guard runs here as well as in `pnpm check` because the commit it
// exists to stop is made in a worktree, where `.notes` is a symlink — and a
// commit reaches `main` without anyone running `pnpm check` in that worktree.
// Blocking at commit time is the only layer between the mistake and a merge.
const HOOK_BODY = `#!/bin/sh
${MARKER}
if [ -f infra/scripts/generate-deploy-config.mjs ]; then
  node ./infra/scripts/generate-deploy-config.mjs --stage
fi
if [ -f infra/scripts/check-scratch-not-tracked.mjs ]; then
  node ./infra/scripts/check-scratch-not-tracked.mjs || exit 1
fi
`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function main() {
  if (process.env[SKIP_ENV_VAR]) {
    console.log(`install-git-hooks: skipped (${SKIP_ENV_VAR} is set).`);
    return;
  }

  let hooksPathOutput;
  try {
    hooksPathOutput = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.log(
      "install-git-hooks: no .git found here, skipping (expected inside a Docker build).",
    );
    return;
  }

  const hooksDir = resolve(repoRoot, hooksPathOutput);
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = resolve(hooksDir, "pre-commit");

  // Read straight through rather than testing existsSync first: "no hook yet"
  // and "hook deleted between the two calls" are the same case, and the
  // check-then-read pair is a race CodeQL flags (js/file-system-race).
  let existing = null;
  try {
    existing = readFileSync(hookPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (existing !== null) {
    if (existing === HOOK_BODY) {
      return;
    }
    if (!existing.includes(MARKER)) {
      console.log(
        `install-git-hooks: ${hookPath} already exists and was not written by this script; leaving it ` +
          `alone. Set ${SKIP_ENV_VAR}=1 to silence this message on future installs.`,
      );
      return;
    }
  }

  writeFileSync(hookPath, HOOK_BODY);
  chmodSync(hookPath, 0o755);
  console.log(`install-git-hooks: wrote ${hookPath}`);
}

main();
