import { AlgorithmGroupSection } from "@/features/algorithms/components/algorithm-group-section";
import type { AlgorithmSetId, CaseGroup } from "@/features/algorithms/types";
import type { CasePool } from "@/lib/pool-storage";
import type { CaseProgress } from "@/lib/progress-storage";

/**
 * Always renders every case. The picker used to hide cases behind a filter, which left the
 * pool it was editing partly invisible - a bulk action could turn cases on or off with no card
 * on screen to show it. Selection is the only state now, so there is nothing left to hide and
 * no empty state to render. The pool comes from the parent rather than a local `useCasePool`,
 * since the selection menu writes the same store - see `DrillChooseCasesView`.
 */
export function DrillCasesGrid({
  groupedCases,
  onEnabledChange,
  pool,
  progress,
  setId,
}: {
  groupedCases: CaseGroup[];
  onEnabledChange: (caseId: string, enabled: boolean) => void;
  pool: CasePool;
  progress: CaseProgress;
  setId: AlgorithmSetId;
}) {
  return (
    <div className="space-y-8">
      {groupedCases.map(({ cases, group }) => (
        <AlgorithmGroupSection
          cases={cases}
          group={group}
          key={group}
          onEnabledChange={onEnabledChange}
          pool={pool}
          progress={progress}
          setId={setId}
        />
      ))}
    </div>
  );
}
