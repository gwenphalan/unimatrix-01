import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { RiArrowLeftLine } from "@remixicon/react";
import { Button } from "@unimatrix/ui/public";

import { AlgorithmSetToggle } from "@/features/algorithms/components/algorithm-set-toggle";
import { PreviewModeToggle } from "@/features/algorithms/components/preview-mode-toggle";
import { resolvePreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { usePreviewMode } from "@/features/algorithms/use-preview-mode";
import { OccludingCluster } from "@/features/cube-trainer-site/components";
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
        <div className="flex items-center justify-between gap-4">
          <OccludingCluster>
            <Button
              aria-label="Back to learning"
              onClick={() => {
                setMode("session");
              }}
              size="icon"
              variant="outline"
            >
              <RiArrowLeftLine aria-hidden="true" className="size-4" />
            </Button>
            <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">Choose cases</h1>
          </OccludingCluster>
        </div>

        <LearnCasesGrid key={setId} setId={setId} />
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
          <h1 className="text-xl font-medium tracking-[-0.03em] text-foreground">Learning</h1>
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
