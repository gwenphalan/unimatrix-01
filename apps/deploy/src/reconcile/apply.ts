import type { DeployDesiredState } from "@unimatrix/deploy-config";

import type { DokployClient, DokployComposeSettingsUpdate } from "../dokploy/client.js";
import type { DokployCompose } from "../dokploy/schemas.js";
import {
  RECONCILE_AUTO_DEPLOY,
  RECONCILE_BRANCH,
  diffApp,
  findComposeMatches,
  type AppDiff,
  type SettingFinding,
} from "./diff.js";

/**
 * `compose.update` followed by any deploy of this service's own compose entry would destroy the
 * process performing the reconciliation mid-run, and Dokploy has no rollback for a Compose service
 * (`docs/deployment.md`). `applyAppSettings` refuses this `appDir` before any network call — see
 * its first branch.
 */
export const RECONCILE_SELF_APP_DIR = "deploy";

/**
 * Measured against the running instance 2026-08-20: every repo-declared compose service carries
 * `owner: "unimatrixcore"`, `repository: "unimatrix-01"`. `findComposeMatches` matches on service
 * *name* alone, across every project the instance holds, and reads no `projectId` — so a name that
 * happens to collide with a service in a foreign project would otherwise be written to.
 */
export const RECONCILE_EXPECTED_OWNER = "unimatrixcore";
export const RECONCILE_EXPECTED_REPOSITORY = "unimatrix-01";

/**
 * A strict subset of `diff.ts`'s `ReconcileSetting`: `sourceType` is deliberately excluded, because
 * it selects which sibling column group drives the clone and this repo declares none of them — see
 * `refused-source-type` below.
 */
export type ReconcileWritableSetting = "composePath" | "branch" | "autoDeploy";

type WritableSettingFinding = SettingFinding & { readonly setting: ReconcileWritableSetting };

/** Never `true` when called: `applyAppSettings` returns `refused-source-type` before reaching
 *  {@link settingsUpdateFor}, so `sourceType` never appears in its input. */
function isWritableFinding(finding: SettingFinding): finding is WritableSettingFinding {
  return finding.setting !== "sourceType";
}

/**
 * Pure. Exhaustive `switch` over {@link ReconcileWritableSetting} so a new member is a compile
 * error rather than a silently-ignored finding. `autoDeploy`'s written value always comes from the
 * {@link RECONCILE_AUTO_DEPLOY} policy constant, never from `finding.declared` — `declared` is a
 * `string`, and the fork's `coerceSchema` treats `autoDeploy` as `z.coerce.boolean()`, under which
 * the string `"false"` coerces to `true`. That is the one input shape that could silently enable
 * auto-deploy on every push, so this function never reads `declared` for that setting at all.
 */
function settingsUpdateFor(
  findings: readonly SettingFinding[],
): DokployComposeSettingsUpdate | null {
  const update: DokployComposeSettingsUpdate = {};
  let wroteAny = false;

  for (const finding of findings.filter(isWritableFinding)) {
    switch (finding.setting) {
      case "composePath":
        update.composePath = finding.declared;
        wroteAny = true;
        break;
      case "branch":
        update.branch = RECONCILE_BRANCH;
        wroteAny = true;
        break;
      case "autoDeploy":
        update.autoDeploy = RECONCILE_AUTO_DEPLOY;
        wroteAny = true;
        break;
      default: {
        const exhaustive: never = finding.setting;
        throw new Error(`settingsUpdateFor: unhandled writable setting "${String(exhaustive)}".`);
      }
    }
  }

  return wroteAny ? update : null;
}

export interface RefusedSelfOutcome {
  readonly outcome: "refused-self";
  readonly appDir: string;
}

export interface UnknownAppOutcome {
  readonly outcome: "unknown-app";
  readonly appDir: string;
}

export interface NotMatchedOutcome {
  readonly outcome: "not-matched";
  readonly appDir: string;
  readonly matchCount: number;
}

export interface RefusedForeignRepoOutcome {
  readonly outcome: "refused-foreign-repo";
  readonly appDir: string;
  readonly owner: string | null;
  readonly repository: string | null;
}

export interface RefusedSourceTypeOutcome {
  readonly outcome: "refused-source-type";
  readonly appDir: string;
}

export interface NothingToApplyOutcome {
  readonly outcome: "nothing-to-apply";
  readonly appDir: string;
  /** The diff that led here — settings already agree, so only env drift (if any) is left to show
   *  an operator who might otherwise assume apply resolved everything `report` found. */
  readonly diff: AppDiff;
}

export interface AppliedOutcome {
  readonly outcome: "applied";
  readonly appDir: string;
  readonly written: readonly ReconcileWritableSetting[];
  /** True only when `composePath` or `branch` was written — Dokploy's clone step reads these only
   *  at deploy time. An `autoDeploy` flip is live immediately: the webhook handler queries the row
   *  directly on every push. */
  readonly needsDeploy: boolean;
  /** The post-write diff, from a fresh `getCompose` read — never the pre-write finding. Every
   *  setting in `written` is confirmed absent from `diff.settingFindings` here; when one is not,
   *  the outcome is {@link AppliedButDriftedOutcome} instead, never this one. */
  readonly diff: AppDiff;
}

export interface AppliedButDriftedOutcome {
  readonly outcome: "applied-but-drifted";
  readonly appDir: string;
  readonly written: readonly ReconcileWritableSetting[];
  /** The post-write diff, from a fresh `getCompose` read. At least one setting in `written` is
   *  still present in `diff.settingFindings` — Dokploy's `compose.update` returned a 200 that did
   *  not take, or silently dropped an unrecognised field. */
  readonly diff: AppDiff;
}

export interface WriteStatusUnknownOutcome {
  readonly outcome: "write-status-unknown";
  readonly appDir: string;
  /** What the caller most needs after a POST timeout is the state that actually landed. `null`
   *  means the re-read itself failed too — say so, don't collapse to `error`. */
  readonly diff: AppDiff | null;
  readonly writeErrorMessage: string;
  readonly rereadErrorMessage: string | null;
}

export interface ErrorOutcome {
  readonly outcome: "error";
  readonly appDir: string;
  readonly errorMessage: string;
}

export type ApplyOutcome =
  | RefusedSelfOutcome
  | UnknownAppOutcome
  | NotMatchedOutcome
  | RefusedForeignRepoOutcome
  | RefusedSourceTypeOutcome
  | NothingToApplyOutcome
  | AppliedOutcome
  | AppliedButDriftedOutcome
  | WriteStatusUnknownOutcome
  | ErrorOutcome;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findingsFor(diff: AppDiff): readonly SettingFinding[] {
  return diff.verdict === "matched" ? diff.settingFindings : [];
}

/**
 * `applied` means every setting in `written` is confirmed present on the re-read — Dokploy's
 * `compose.update` input schema silently strips a field it does not recognise, so a legal 200 that
 * changed nothing is exactly the case this guards against. A `written` setting still listed in
 * `postDiff`'s findings means the re-read still disagrees with what was declared written.
 */
function writeConfirmed(postDiff: AppDiff, written: readonly ReconcileWritableSetting[]): boolean {
  if (postDiff.verdict !== "matched") return false;

  const stillDrifted = new Set(postDiff.settingFindings.map((finding) => finding.setting));

  return written.every((setting) => !stillDrifted.has(setting));
}

/**
 * Applies at most one `compose.update` call, in the order documented on {@link ApplyOutcome}'s
 * members: self-refusal before any network call, then the app must be declared, matched exactly
 * once, anchored to this repository, and carry no `sourceType` drift, before there is anything to
 * write at all.
 */
export async function applyAppSettings(
  client: DokployClient,
  desired: DeployDesiredState,
  appDir: string,
): Promise<ApplyOutcome> {
  if (appDir === RECONCILE_SELF_APP_DIR) {
    return { outcome: "refused-self", appDir };
  }

  const service = desired.find((entry) => entry.appDir === appDir);
  if (service === undefined) {
    return { outcome: "unknown-app", appDir };
  }

  let projects;
  try {
    projects = await client.getProjects();
  } catch (error) {
    return { outcome: "error", appDir, errorMessage: messageOf(error) };
  }

  const matches = findComposeMatches(appDir, projects);
  const [onlyMatch] = matches;

  if (matches.length !== 1 || onlyMatch === undefined) {
    return { outcome: "not-matched", appDir, matchCount: matches.length };
  }

  let detail: DokployCompose;
  try {
    detail = await client.getCompose(onlyMatch.composeId);
  } catch (error) {
    return { outcome: "error", appDir, errorMessage: messageOf(error) };
  }

  const isForeignRepo =
    detail.owner !== RECONCILE_EXPECTED_OWNER ||
    detail.repository !== RECONCILE_EXPECTED_REPOSITORY;

  if (isForeignRepo) {
    return {
      outcome: "refused-foreign-repo",
      appDir,
      owner: detail.owner,
      repository: detail.repository,
    };
  }

  const preDiff = diffApp(service, matches, detail);
  const findings = findingsFor(preDiff);

  if (findings.some((finding) => finding.setting === "sourceType")) {
    return { outcome: "refused-source-type", appDir };
  }

  const update = settingsUpdateFor(findings);
  if (update === null) {
    return { outcome: "nothing-to-apply", appDir, diff: preDiff };
  }

  try {
    await client.updateComposeSettings(onlyMatch.composeId, update);
  } catch (error) {
    const writeErrorMessage = messageOf(error);

    try {
      const observed = await client.getCompose(onlyMatch.composeId);
      return {
        outcome: "write-status-unknown",
        appDir,
        diff: diffApp(service, matches, observed),
        writeErrorMessage,
        rereadErrorMessage: null,
      };
    } catch (rereadError) {
      return {
        outcome: "write-status-unknown",
        appDir,
        diff: null,
        writeErrorMessage,
        rereadErrorMessage: messageOf(rereadError),
      };
    }
  }

  let postDetail: DokployCompose;
  try {
    postDetail = await client.getCompose(onlyMatch.composeId);
  } catch (error) {
    return { outcome: "error", appDir, errorMessage: messageOf(error) };
  }

  const written = Object.keys(update) as readonly ReconcileWritableSetting[];
  const postDiff = diffApp(service, matches, postDetail);

  if (!writeConfirmed(postDiff, written)) {
    return { outcome: "applied-but-drifted", appDir, written, diff: postDiff };
  }

  return {
    outcome: "applied",
    appDir,
    written,
    needsDeploy: written.includes("composePath") || written.includes("branch"),
    diff: postDiff,
  };
}
