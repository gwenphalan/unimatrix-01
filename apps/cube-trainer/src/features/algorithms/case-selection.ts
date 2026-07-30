import type { AlgorithmCase, CaseGroup } from "@/features/algorithms/types";
import type { CasePool } from "@/lib/pool-storage";
import { isCaseEnabled } from "@/lib/pool-storage";

export interface CaseGroupSelection {
  group: string;
  /** How many of this group's cases are currently in the drill pool. */
  enabled: number;
  total: number;
}

/** Per-group enabled/total counts, for a control that reports the pool rather than filtering it. */
export function summarizeSelection(
  groupedCases: CaseGroup[],
  pool: CasePool,
): CaseGroupSelection[] {
  return groupedCases.map(({ cases, group }) => ({
    enabled: cases.filter((algorithmCase) => isCaseEnabled(pool, algorithmCase.id)).length,
    group,
    total: cases.length,
  }));
}

/**
 * The id -> enabled record for a bulk pool edit. Every bulk action is this function with a
 * different predicate - enable all, disable all, one group, or only the learned cases - which
 * keeps them one atomic write each and keeps the arithmetic out of the component.
 */
export function selectionChanges(
  cases: AlgorithmCase[],
  shouldEnable: (algorithmCase: AlgorithmCase) => boolean,
): Record<string, boolean> {
  return Object.fromEntries(
    cases.map((algorithmCase) => [algorithmCase.id, shouldEnable(algorithmCase)]),
  );
}
