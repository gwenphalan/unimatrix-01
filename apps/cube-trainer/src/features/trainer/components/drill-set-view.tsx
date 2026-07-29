import { useEffect, useState } from "react";
import { ToolTitleBar } from "@unimatrix/chrome/tool";
import { Button } from "@unimatrix/ui/public";

import { getAlgorithmSet } from "@/features/algorithms/algorithm-sets";
import { AlgorithmSetToggle } from "@/features/algorithms/components/algorithm-set-toggle";
import type { CaseFilterMode } from "@/features/algorithms/components/case-category-filter";
import { CaseCategoryFilter } from "@/features/algorithms/components/case-category-filter";
import { PreviewModeToggle } from "@/features/algorithms/components/preview-mode-toggle";
import { resolvePreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { usePreviewMode } from "@/features/algorithms/use-preview-mode";
import { DrillCasesGrid } from "@/features/trainer/components/drill-cases-grid";
import { TrainerPanel } from "@/features/trainer/components/trainer-panel";

type ViewMode = "drill" | "cases";

export function DrillSetView() {
  const [setId, setSetId] = useState<AlgorithmSetId>("oll");
  const [mode, setMode] = useState<ViewMode>("drill");
  const [caseFilterMode, setCaseFilterMode] = useState<CaseFilterMode>("all");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const { previewMode, setPreviewMode } = usePreviewMode("drill");
  // The stored preference is kept as-is so "two-sided" survives a trip through OLL, but
  // everything that renders - the toggle's own value included - must use the resolved mode.
  const resolvedPreviewMode = resolvePreviewMode(setId, previewMode);
  const algorithmSet = getAlgorithmSet(setId);

  useEffect(() => {
    setCaseFilterMode("all");
    setSelectedGroups([]);
  }, [setId]);

  if (mode === "cases") {
    return (
      <div className="space-y-8">
        <ToolTitleBar
          actions={
            <CaseCategoryFilter
              groups={algorithmSet.groupOrder}
              mode={caseFilterMode}
              onModeChange={setCaseFilterMode}
              onSelectedGroupsChange={setSelectedGroups}
              selectedGroups={selectedGroups}
            />
          }
          back={{
            label: "Back to drilling",
            onClick: () => {
              setMode("drill");
            },
          }}
          title="Choose cases"
        />

        <DrillCasesGrid
          key={setId}
          mode={caseFilterMode}
          selectedGroups={selectedGroups}
          setId={setId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ToolTitleBar
        actions={
          <Button
            onClick={() => {
              setMode("cases");
            }}
            variant="outline"
          >
            Choose cases
          </Button>
        }
        back={{ label: "Home", to: "/" }}
        title="Drilling"
      />

      <TrainerPanel
        cases={algorithmSet.cases}
        key={setId}
        previewMode={resolvedPreviewMode}
        setId={setId}
      />

      <div className="flex items-center justify-between gap-4">
        <AlgorithmSetToggle onChange={setSetId} setId={setId} />
        <PreviewModeToggle mode={resolvedPreviewMode} onChange={setPreviewMode} setId={setId} />
      </div>
    </div>
  );
}
