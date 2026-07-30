import { z } from "zod";

import type { AlgorithmSetId } from "@/features/algorithms/types";

import { readStoredValue, writeStoredValue } from "./local-storage";

export const CASE_STATUSES = ["new", "learning", "known"] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export type CaseProgress = Record<string, CaseStatus>;

const caseProgressSchema = z.record(z.string(), z.enum(CASE_STATUSES));

function storageKey(setId: AlgorithmSetId): string {
  return `progress:${setId}`;
}

export function readCaseProgress(setId: AlgorithmSetId): CaseProgress {
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

  const parsed = caseProgressSchema.safeParse(rawJson);

  return parsed.success ? parsed.data : {};
}

function writeCaseProgress(setId: AlgorithmSetId, progress: CaseProgress): void {
  writeStoredValue(storageKey(setId), JSON.stringify(progress));
}

export function setCaseStatus(
  setId: AlgorithmSetId,
  caseId: string,
  status: CaseStatus,
): CaseProgress {
  const next = { ...readCaseProgress(setId), [caseId]: status };

  writeCaseProgress(setId, next);
  return next;
}
