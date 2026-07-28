import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine } from "@remixicon/react";
import { Button } from "@unimatrix/ui/public";

import { getAlgorithmSet } from "@/features/algorithms/algorithm-sets";
import { AlgorithmSetToggle } from "@/features/algorithms/components/algorithm-set-toggle";
import type { CaseFilterMode } from "@/features/algorithms/components/case-category-filter";
import { CaseCategoryFilter } from "@/features/algorithms/components/case-category-filter";
import { PreviewModeToggle } from "@/features/algorithms/components/preview-mode-toggle";
import { resolvePreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { usePreviewMode } from "@/features/algorithms/use-preview-mode";
import { OccludingCluster } from "@/features/cube-trainer-site/components";
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
        <div className="flex items-center justify-between gap-4">
          <OccludingCluster>
            <Button
              aria-label="Back to drilling"
              onClick={() => {
                setMode("drill");
              }}
              size="icon"
              variant="outline"
            >
              <RiArrowLeftLine aria-hidden="true" className="size-4" />
            </Button>
            <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">Choose cases</h1>
          </OccludingCluster>
          <OccludingCluster>
            <CaseCategoryFilter
              groups={algorithmSet.groupOrder}
              mode={caseFilterMode}
              onModeChange={setCaseFilterMode}
              onSelectedGroupsChange={setSelectedGroups}
              selectedGroups={selectedGroups}
            />
          </OccludingCluster>
        </div>

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
      <div className="flex items-center justify-between gap-4">
        <OccludingCluster>
          <Button asChild aria-label="Home" size="icon" variant="outline">
            <Link to="/">
              <RiArrowLeftLine aria-hidden="true" className="size-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">Drilling</h1>
        </OccludingCluster>
        <OccludingCluster>
          <Button
            onClick={() => {
              setMode("cases");
            }}
            variant="outline"
          >
            Choose cases
          </Button>
        </OccludingCluster>
      </div>

      <TrainerPanel
        cases={algorithmSet.cases}
        key={setId}
        previewMode={resolvedPreviewMode}
        setId={setId}
      />

      <div className="flex items-center justify-between gap-4">
        <OccludingCluster>
          <AlgorithmSetToggle onChange={setSetId} setId={setId} />
        </OccludingCluster>
        <OccludingCluster>
          <PreviewModeToggle mode={resolvedPreviewMode} onChange={setPreviewMode} setId={setId} />
        </OccludingCluster>
      </div>
    </div>
  );
}
