import type { AlgorithmCase } from "@/features/algorithms/types";
import type { CasePool } from "@/lib/pool-storage";
import { isCaseEnabled } from "@/lib/pool-storage";

export function pickNextCase(
  cases: AlgorithmCase[],
  pool: CasePool,
  excludeId: string | undefined,
): AlgorithmCase | undefined {
  const enabled = cases.filter((c) => isCaseEnabled(pool, c.id));
  const candidates = enabled.length > 1 ? enabled.filter((c) => c.id !== excludeId) : enabled;

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}
