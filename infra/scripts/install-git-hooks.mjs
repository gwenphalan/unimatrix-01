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
// Must exit 0 with no `.git` present at all: `.dockerignore` excludes `.git`,
// so this runs during every app's Docker build (`COPY . .` then
// `pnpm install --frozen-lockfile`), and a non-zero exit there fails the
// image.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_ENV_VAR = "UNIMATRIX_SKIP_GIT_HOOKS";
const MARKER =
  "# unimatrix-01 pre-commit hook (infra/scripts/install-git-hooks.mjs) — do not hand-edit";
const HOOK_BODY = `#!/bin/sh
${MARKER}
if [ -f infra/scripts/generate-deploy-config.mjs ]; then
  node ./infra/scripts/generate-deploy-config.mjs --stage
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

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
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
