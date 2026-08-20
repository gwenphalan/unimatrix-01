import type { AppDiff, EnvFindingState } from "./diff.js";
import type { ReconcileRun } from "./collect.js";

const ENV_STATE_LABEL: Record<EnvFindingState, string> = {
  set: "set",
  blank: "blank",
  missing: "missing",
  "optional-absent": "optional, absent",
  undeclared: "undeclared",
};

function renderAppDiff(appDir: string, diff: AppDiff): string[] {
  if (diff.verdict === "missing") {
    return [`${appDir}: MISSING — no Dokploy compose service named "${appDir}"`];
  }

  if (diff.verdict === "ambiguous") {
    return [
      `${appDir}: AMBIGUOUS — ${String(diff.matchCount)} Dokploy compose services named "${appDir}"`,
    ];
  }

  if (diff.inSync) {
    return [`${appDir}: IN SYNC`];
  }

  const lines = [`${appDir}: DRIFT`];

  for (const finding of diff.envFindings) {
    if (finding.state === "set" || finding.state === "optional-absent") continue;
    lines.push(`  env ${finding.key}: ${ENV_STATE_LABEL[finding.state]}`);
  }

  for (const finding of diff.settingFindings) {
    lines.push(`  ${finding.setting}: declared ${finding.declared}, actual ${finding.actual}`);
  }

  return lines;
}

/**
 * Never carries an env value, only a key and one of {@link EnvFindingState}'s five states — the
 * type this renders holds no field that could carry one. Pure: no I/O.
 */
export function renderReconcileRun(run: ReconcileRun): readonly string[] {
  const lines: string[] = [];

  for (const result of run.results) {
    if (result.outcome === "error") {
      lines.push(`${result.appDir}: ERROR — ${result.errorMessage}`);
      continue;
    }

    lines.push(...renderAppDiff(result.appDir, result.diff));
  }

  return lines;
}
