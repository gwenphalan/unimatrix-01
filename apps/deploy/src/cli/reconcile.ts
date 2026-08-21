// A host-local CLI, same reasoning as apps/secrets/src/cli/service-token.ts: reading it holds no
// credential a route would need to protect, and it lives under src/ (not scripts/) because
// tsconfig.build.json excludes scripts/ and the production image has no tsx to run one with.
import type { DeployDesiredState } from "@unimatrix/deploy-config";

import { loadDeployRuntimeConfig } from "../config.js";
import { createDokployClient, loadDokployApiKey, type DokployClient } from "../dokploy/client.js";
import { applyAppSettings } from "../reconcile/apply.js";
import { collectReconcileRun, type ReconcileRun } from "../reconcile/collect.js";
import { DEPLOY_DESIRED_STATE } from "../reconcile/desired-state.gen.js";
import { renderApplyOutcome, renderReconcileRun } from "../reconcile/report.js";

const USAGE = [
  "Usage:",
  "  reconcile report",
  "  reconcile apply <app>",
  "",
  "report diffs apps/deploy/src/reconcile/desired-state.gen.ts against Dokploy and prints the",
  "result. Read-only — creates, updates, and deploys nothing.",
  "",
  "apply writes composePath, branch, and autoDeploy for one declared app when they drift from the",
  "manifest — a single compose.update call, settings only. It never writes env, never calls",
  "compose.create, compose.deploy, or a domain route, and refuses a match outside this repository,",
  "a sourceType disagreement, or this service's own compose entry (a self-apply followed by a",
  "deploy would destroy the process performing the reconciliation). apply's success (exit 0) is not",
  "a sync assertion — it can succeed on an app report still exits 1 on, because report also finds",
  "env drift apply deliberately never touches.",
  "",
  "Exit codes for report:",
  "  0  every declared app is in sync",
  "  1  at least one app needs a decision (missing, ambiguous, or drifted)",
  "  2  the run could not complete (bad usage, or a Dokploy call failed)",
  "",
  "Exit codes for apply — 0 and 1 are deliberately different, so a caller can always tell whether a",
  "write happened:",
  "  0  applied — a write occurred and every written setting was confirmed on the re-read",
  "  1  nothing to apply — settings already matched, so no write occurred",
  "  2  refused or not applicable — bad usage, unknown app, not matched (missing/ambiguous),",
  "     the service's own entry, a foreign-repository match, or sourceType drift",
  "  3  write status unknown — a write was attempted but its outcome could not be confirmed",
  "  4  the run could not complete for another reason (a Dokploy call failed outright)",
  "  5  applied but the post-write state does not match — compose.update returned a 200, but the",
  "     re-read still shows a written setting drifted (Dokploy silently drops an unrecognised field)",
].join("\n");

export interface ReconcileCliDeps {
  readonly client: DokployClient;
  readonly desired: DeployDesiredState;
  readonly write: (line: string) => void;
}

function needsADecision(run: ReconcileRun): boolean {
  return run.results.some(
    (result) =>
      result.outcome === "diffed" && (result.diff.verdict !== "matched" || !result.diff.inSync),
  );
}

/** Exit codes for `apply <app>` — see USAGE for what each means. */
const APPLY_EXIT_CODE = {
  applied: 0,
  "nothing-to-apply": 1,
  "refused-self": 2,
  "unknown-app": 2,
  "not-matched": 2,
  "refused-foreign-repo": 2,
  "refused-source-type": 2,
  "write-status-unknown": 3,
  error: 4,
  "applied-but-drifted": 5,
} as const;

async function runReport(deps: ReconcileCliDeps): Promise<number> {
  let run: ReconcileRun;

  try {
    run = await collectReconcileRun(deps.client, deps.desired);
  } catch (error) {
    deps.write(
      `reconcile report: could not complete — ${error instanceof Error ? error.message : String(error)}`,
    );

    return 2;
  }

  for (const line of renderReconcileRun(run)) {
    deps.write(line);
  }

  if (run.results.some((result) => result.outcome === "error")) {
    return 2;
  }

  return needsADecision(run) ? 1 : 0;
}

async function runApply(deps: ReconcileCliDeps, appDir: string): Promise<number> {
  const outcome = await applyAppSettings(deps.client, deps.desired, appDir);

  for (const line of renderApplyOutcome(outcome)) {
    deps.write(line);
  }

  return APPLY_EXIT_CODE[outcome.outcome];
}

/**
 * Throws nothing — every failure, including a `project.all` call that fails outright, is caught
 * and turned into an exit code and a written line. {@link main} stays thin: this is the function
 * the tests drive.
 */
export async function runReconcileCli(
  argv: readonly string[],
  deps: ReconcileCliDeps,
): Promise<number> {
  const [subcommand] = argv;

  // Exact-length, so `reconcile report --apply` is a usage error rather than a silently ignored
  // flag, and so `reconcile apply` with no app name is a usage error rather than an undefined app.
  if (argv.length === 1 && subcommand === "report") {
    return runReport(deps);
  }

  if (argv.length === 2 && subcommand === "apply") {
    const appDir = argv[1];
    if (appDir !== undefined) {
      return runApply(deps, appDir);
    }
  }

  deps.write(USAGE);

  return 2;
}

async function main(): Promise<void> {
  try {
    const config = loadDeployRuntimeConfig();
    const client = createDokployClient({
      baseUrl: config.dokployBaseUrl,
      apiKey: loadDokployApiKey(),
    });

    process.exitCode = await runReconcileCli(process.argv.slice(2), {
      client,
      desired: DEPLOY_DESIRED_STATE,
      write: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

// Guarded so test/module-graph.test.ts can import this module — and so the coverage denominator
// keeps it — without making a network call.
if (import.meta.main) {
  await main();
}
