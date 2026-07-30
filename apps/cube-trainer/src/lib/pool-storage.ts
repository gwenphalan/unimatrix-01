import { z } from "zod";

import type { AlgorithmSetId } from "@/features/algorithms/types";

export type CasePool = Record<string, boolean>;

const casePoolSchema = z.record(z.string(), z.boolean());

function storageKey(setId: AlgorithmSetId): string {
  return `cube-trainer:pool:${setId}`;
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private browsing, quota). The pool is
    // best-effort and safe to drop silently in that case.
  }
}

export function readCasePool(setId: AlgorithmSetId): CasePool {
  const raw = readLocalStorage(storageKey(setId));

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
 * different thing and stay swallowed in `writeLocalStorage`.
 */
function writeCasePool(setId: AlgorithmSetId, pool: CasePool): void {
  writeLocalStorage(storageKey(setId), JSON.stringify(casePoolSchema.parse(pool)));
}

export function setCaseEnabled(setId: AlgorithmSetId, caseId: string, enabled: boolean): CasePool {
  const next = { ...readCasePool(setId), [caseId]: enabled };

  writeCasePool(setId, next);
  return next;
}

/**
 * Bulk counterpart to `setCaseEnabled`, taking the whole change as one id -> enabled record so
 * a group toggle or an Enable-all is a single read/write rather than one per case. It takes a
 * record rather than (ids, enabled) so a mixed change - Enable only learned, which turns some
 * on and the rest off - stays one atomic write instead of two passes over storage.
 */
export function setCasesEnabled(
  setId: AlgorithmSetId,
  changes: Readonly<Record<string, boolean>>,
): CasePool {
  const next = { ...readCasePool(setId), ...changes };

  writeCasePool(setId, next);
  return next;
}

/** Cases with no recorded entry are enabled by default (Tim's-style pool: everything on until turned off). */
export function isCaseEnabled(pool: CasePool, caseId: string): boolean {
  return pool[caseId] ?? true;
}
