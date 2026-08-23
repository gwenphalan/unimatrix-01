import type { SecretEnvStatus } from "./status.js";

/**
 * Lives here rather than `src/reconcile/report.ts` because `src/reconcile/` must not import this
 * module's types — see `test/reconcile-value-isolation.test.ts`. Every line carries a name, a
 * declared store name, and one of `resolved`/`unresolved`/`error` (plus `singleLine` for a resolved
 * name) — never a value, a length, or a prefix.
 */
export function renderSecretEnvStatus(status: SecretEnvStatus): readonly string[] {
  switch (status.outcome) {
    case "refused-self":
      return [`${status.appDir}: REFUSED — secrets-status refuses this service's own compose entry`];
    case "unknown-app":
      return [`${status.appDir}: UNKNOWN — not declared in the desired-state manifest`];
    case "no-declarations":
      return [`${status.appDir}: this app declares no secrets-store values`];
    case "results": {
      const lines = [`${status.appDir}:`];

      for (const result of status.results) {
        if (result.outcome === "resolved") {
          lines.push(
            `  ${result.name} (${result.secretName}): RESOLVED — singleLine=${String(result.singleLine)}`,
          );
        } else {
          lines.push(
            `  ${result.name} (${result.secretName}): ${result.outcome.toUpperCase()} — ${result.message}`,
          );
        }
      }

      return lines;
    }
  }
}
