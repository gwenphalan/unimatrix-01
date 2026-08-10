import { z } from "zod";

import type { AlgorithmSetId } from "@/features/algorithms/types";

import { readStoredValue, writeStoredValue } from "./local-storage";

export type CasePool = Record<string, boolean>;

/** Whether the pool follows learned status. See {@link mirrorLearnedCaseToPool}. */
export const DRILL_POOL_MODES = ["manual", "only-learned"] as const;
export type DrillPoolMode = (typeof DRILL_POOL_MODES)[number];

const casePoolSchema = z.record(z.string(), z.boolean());
const drillPoolModeSchema = z.enum(DRILL_POOL_MODES);

function storageKey(setId: AlgorithmSetId): string {
  return `pool:${setId}`;
}

function modeStorageKey(setId: AlgorithmSetId): string {
  return `pool-mode:${setId}`;
}

export function readCasePool(setId: AlgorithmSetId): CasePool {
  const raw = readStoredValue(storageKey(setId));

  if (raw === null) {
    return {};
  }

  let rawJson: unknown;

  try {
    rawJson = JSON.parse(raw);
  } catch {
    return {};
  }

  const parsed = casePoolSchema.safeParse(rawJson);

  return parsed.success ? parsed.data : {};
}

/**
 * Validates on the way out as well as the way in, so every writer - single, bulk, or whatever
 * comes next - shares one guarantee about what can reach storage. It throws rather than
 * silently dropping the write: a typed caller cannot produce a bad record, so reaching this is
 * a bug in the caller, and a swallowed write would leave React state and `localStorage`
 * disagreeing with nothing to show for it. Environment failures (quota, private browsing) are a
 * different thing and stay swallowed in `writeStoredValue`.
 */
function writeCasePool(setId: AlgorithmSetId, pool: CasePool): void {
  writeStoredValue(storageKey(setId), JSON.stringify(casePoolSchema.parse(pool)));
}

export function readDrillPoolMode(setId: AlgorithmSetId): DrillPoolMode {
  const parsed = drillPoolModeSchema.safeParse(readStoredValue(modeStorageKey(setId)));

  return parsed.success ? parsed.data : "manual";
}

/**
 * Always written as an explicit value, never omitted: a writer that skipped this on the manual
 * path would leave a stale `only-learned` in place instead of opting out of it.
 */
function writeDrillPoolMode(setId: AlgorithmSetId, mode: DrillPoolMode): void {
  writeStoredValue(modeStorageKey(setId), mode);
}

/**
 * `setCaseEnabled` and `setCasesEnabled` both reset the mode to manual, so a pool writer added
 * later opts out of the mode by default rather than into it. This runs after `writeCasePool`,
 * never before: `setCasesEnabled` throws on a malformed `changes` before writing anything, and
 * the mode must not flip on a rejected call.
 */
export function setCaseEnabled(setId: AlgorithmSetId, caseId: string, enabled: boolean): CasePool {
  const next = { ...readCasePool(setId), [caseId]: enabled };

  writeCasePool(setId, next);
  writeDrillPoolMode(setId, "manual");
  return next;
}

/**
 * Bulk counterpart to `setCaseEnabled`, taking the whole change as one id -> enabled record so
 * a group toggle or an Enable-all is a single read/write rather than one per case. It takes a
 * record rather than (ids, enabled) so a mixed change - a category toggle, which turns some on
 * and the rest off - stays one atomic write instead of two passes over storage.
 *
 * `changes` is parsed before the merge, not just after it: spreading `null` or `undefined` is a
 * silent no-op, so a bad argument would otherwise rewrite the pool unchanged and report success
 * rather than failing. Validating the merged result cannot see that - it looks like a valid pool.
 *
 * Resets the mode to manual, same as `setCaseEnabled`; `enableOnlyLearnedCases` is the only
 * writer that leaves it on.
 */
export function setCasesEnabled(
  setId: AlgorithmSetId,
  changes: Readonly<Record<string, boolean>>,
): CasePool {
  const next = { ...readCasePool(setId), ...casePoolSchema.parse(changes) };

  writeCasePool(setId, next);
  writeDrillPoolMode(setId, "manual");
  return next;
}

/** Same merge/validate/write as `setCasesEnabled`, but turns the only-learned mode on instead of off. */
export function enableOnlyLearnedCases(
  setId: AlgorithmSetId,
  changes: Readonly<Record<string, boolean>>,
): CasePool {
  const next = { ...readCasePool(setId), ...casePoolSchema.parse(changes) };

  writeCasePool(setId, next);
  writeDrillPoolMode(setId, "only-learned");
  return next;
}

/** Turns the only-learned mode off without touching the pool it leaves behind. */
export function clearDrillPoolMode(setId: AlgorithmSetId): void {
  writeDrillPoolMode(setId, "manual");
}

/**
 * Keeps the pool in step with learned status while the only-learned mode is on; a no-op
 * otherwise. Writes an explicit `false` rather than omitting the case: `isCaseEnabled` treats an
 * absent entry as enabled, so removing the entry on unlearn would re-enable the case instead of
 * disabling it.
 */
export function mirrorLearnedCaseToPool(
  setId: AlgorithmSetId,
  caseId: string,
  learned: boolean,
): void {
  if (readDrillPoolMode(setId) !== "only-learned") return;

  writeCasePool(setId, { ...readCasePool(setId), [caseId]: learned });
}

/** Cases with no recorded entry are enabled by default (Tim's-style pool: everything on until turned off). */
export function isCaseEnabled(pool: CasePool, caseId: string): boolean {
  return pool[caseId] ?? true;
}
