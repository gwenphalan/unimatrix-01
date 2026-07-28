import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapLocalEnvFiles, printBootstrapLocalEnvFiles } from "./setup-local.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// Derived from `.node-version` rather than duplicated. This guard used to carry
// its own literal `"22"`, which means a toolchain bump that missed this line
// would have rejected the very runtime the repo had just standardised on.
function requiredNodeMajor() {
  return readFileSync(resolve(REPO_ROOT, ".node-version"), "utf8").trim().split(".")[0];
}

function ensureSupportedNodeVersion() {
  const required = requiredNodeMajor();
  const nodeMajor = process.versions.node.split(".")[0];

  if (nodeMajor === required) {
    return;
  }

  console.error(
    `pnpm dev requires Node ${required}.x (running ${process.versions.node}). See .node-version or run ./infra/scripts/pnpm-with-pinned-node.sh dev.`,
  );
  process.exit(1);
}

function ensureWorkspaceDependenciesInstalled() {
  const nodeModulesPath = resolve(REPO_ROOT, "node_modules");
  const turboPackagePath = resolve(REPO_ROOT, "node_modules/turbo/package.json");

  if (existsSync(nodeModulesPath) && existsSync(turboPackagePath)) {
    return;
  }

  console.error(
    "Workspace dependencies are not installed. Run `pnpm install` from the repo root before `pnpm dev`.",
  );
  process.exit(1);
}

async function main() {
  ensureSupportedNodeVersion();
  ensureWorkspaceDependenciesInstalled();

  try {
    const bootstrapResults = await bootstrapLocalEnvFiles();
    printBootstrapLocalEnvFiles(bootstrapResults);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const child = spawn(
    PNPM_COMMAND,
    [
      "exec",
      "turbo",
      "run",
      "dev",
      "--parallel",
      "--filter=@unimatrix/api",
      "--filter=@unimatrix/web",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );

  child.on("error", (error) => {
    console.error(`Failed to start pnpm dev workflow: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

await main();
