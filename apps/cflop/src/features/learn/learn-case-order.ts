import type { AlgorithmCase, CaseGroup } from "@/features/algorithms/types";
import type { CaseProgress } from "@/lib/progress-storage";

/**
 * Deterministic (not random) teaching order: walk groups in curriculum order, within a
 * group teach the most common case first (descending caseFrequency), skipping
 * anything already marked learned. This is the list Next/Back browse through, and the
 * list marking a case learned removes it from.
 */
export function orderedLearnCases(
  groupedCases: CaseGroup[],
  progress: CaseProgress,
): AlgorithmCase[] {
  const result: AlgorithmCase[] = [];

  for (const { cases } of groupedCases) {
    const eligible = cases
      .filter((c) => progress[c.id] !== "known")
      .sort((a, b) => b.caseFrequency - a.caseFrequency);

    result.push(...eligible);
  }

  return result;
}
