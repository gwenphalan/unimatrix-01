import { useState } from "react";
import { Button } from "@unimatrix/ui/public";

import { AlgorithmSetToggle } from "@/features/algorithms/components/algorithm-set-toggle";
import { PreviewModeToggle } from "@/features/algorithms/components/preview-mode-toggle";
import { resolvePreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { usePreviewMode } from "@/features/algorithms/use-preview-mode";
import { OccludingCluster, ToolTitleBar } from "@/features/cube-trainer-site/components";
import { LearnCasesGrid } from "@/features/learn/components/learn-cases-grid";
import { LearnPanel } from "@/features/learn/components/learn-panel";

type ViewMode = "session" | "cases";

export function LearnSetView() {
  const [setId, setSetId] = useState<AlgorithmSetId>("oll");
  const [mode, setMode] = useState<ViewMode>("session");
  const { previewMode, setPreviewMode } = usePreviewMode("learn");
  // The stored preference is kept as-is so "two-sided" survives a trip through OLL, but
  // everything that renders - the toggle's own value included - must use the resolved mode.
  const resolvedPreviewMode = resolvePreviewMode(setId, previewMode);

  if (mode === "cases") {
    return (
      <div className="space-y-8">
        <ToolTitleBar
          back={{
            label: "Back to learning",
            onClick: () => {
              setMode("session");
            },
          }}
          title="Choose cases"
        />

        <LearnCasesGrid key={setId} setId={setId} />
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
        title="Learning"
      />

      <LearnPanel key={setId} previewMode={resolvedPreviewMode} setId={setId} />

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
