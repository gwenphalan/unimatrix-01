// A host-local CLI, same reasoning as apps/secrets/src/cli/service-token.ts: reading it holds no
// credential a route would need to protect, and it lives under src/ (not scripts/) because
// tsconfig.build.json excludes scripts/ and the production image has no tsx to run one with.
import type { DeployDesiredState } from "@unimatrix/deploy-config";

import { loadDeployRuntimeConfig } from "../config.js";
import { createDokployClient, loadDokployApiKey, type DokployClient } from "../dokploy/client.js";
import { collectReconcileRun, type ReconcileRun } from "../reconcile/collect.js";
import { DEPLOY_DESIRED_STATE } from "../reconcile/desired-state.gen.js";
import { renderReconcileRun } from "../reconcile/report.js";

const USAGE = [
  "Usage:",
  "  reconcile report",
  "",
  "Diffs apps/deploy/src/reconcile/desired-state.gen.ts against Dokploy and prints the result.",
  "Read-only — creates, updates, and deploys nothing.",
  "",
  "Exit codes:",
  "  0  every declared app is in sync",
  "  1  at least one app needs a decision (missing, ambiguous, or drifted)",
  "  2  the run could not complete (bad usage, or a Dokploy call failed)",
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
  // flag. There is no apply path in this service, and a flag that looks accepted is the wrong way
  // to say so.
  if (argv.length !== 1 || subcommand !== "report") {
    deps.write(USAGE);

    return 2;
  }

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
