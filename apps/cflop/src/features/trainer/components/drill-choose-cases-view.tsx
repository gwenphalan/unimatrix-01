import { useMemo } from "react";
import { ToolTitleBar } from "@unimatrix/chrome/tool";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import { selectionChanges, summarizeSelection } from "@/features/algorithms/case-selection";
import { CaseSelectionMenu } from "@/features/algorithms/components/case-selection-menu";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { useCasePool } from "@/features/algorithms/use-case-pool";
import { useCaseProgress } from "@/features/algorithms/use-case-progress";
import { DrillCasesGrid } from "@/features/trainer/components/drill-cases-grid";

export interface DrillChooseCasesViewProps {
  onBack: () => void;
  setId: AlgorithmSetId;
}

/**
 * Owns the pool for the whole picker. The menu's bulk actions and the grid's per-card toggles
 * write the same store, so they have to read one `useCasePool` - two copies of the hook would
 * each hold their own `useState` snapshot and the grid would keep rendering the pool as it was
 * before an Enable all. Mount this with `key={setId}`: the store hooks read `localStorage`
 * once, in a lazy initializer.
 */
export function DrillChooseCasesView({ onBack, setId }: DrillChooseCasesViewProps) {
  const algorithmSet = getAlgorithmSet(setId);
  const { clearOnlyLearned, enableOnlyLearned, onlyLearned, pool, setEnabled, setManyEnabled } =
    useCasePool(setId);
  const { progress } = useCaseProgress(setId);

  const groupedCases = useMemo(() => groupCasesByGroup(algorithmSet), [algorithmSet]);

  const groups = useMemo(() => summarizeSelection(groupedCases, pool), [groupedCases, pool]);

  const enabledCount = groups.reduce((total, { enabled }) => total + enabled, 0);
  const learnedCount = algorithmSet.cases.filter(
    (algorithmCase) => progress[algorithmCase.id] === "known",
  ).length;

  function setAllEnabled(enabled: boolean) {
    setManyEnabled(selectionChanges(algorithmSet.cases, () => enabled));
  }

  function applyOnlyLearned() {
    enableOnlyLearned(
      selectionChanges(
        algorithmSet.cases,
        (algorithmCase) => progress[algorithmCase.id] === "known",
      ),
    );
  }

  function setGroupEnabled(group: string, enabled: boolean) {
    const cases = groupedCases.find((entry) => entry.group === group)?.cases ?? [];

    setManyEnabled(selectionChanges(cases, () => enabled));
  }

  function handleOnlyLearnedChange(checked: boolean) {
    if (checked) {
      applyOnlyLearned();
      return;
    }

    clearOnlyLearned();
  }

  return (
    <div className="space-y-8">
      <ToolTitleBar
        actions={
          <CaseSelectionMenu
            enabledCount={enabledCount}
            groups={groups}
            learnedCount={learnedCount}
            onlyLearned={onlyLearned}
            onOnlyLearnedChange={handleOnlyLearnedChange}
            onSetAllEnabled={setAllEnabled}
            onSetGroupEnabled={setGroupEnabled}
            totalCount={algorithmSet.cases.length}
          />
        }
        back={{ label: "Back to drilling", onClick: onBack }}
        title="Choose cases"
      />

      <DrillCasesGrid
        groupedCases={groupedCases}
        onEnabledChange={setEnabled}
        pool={pool}
        progress={progress}
        setId={setId}
      />
    </div>
  );
}
