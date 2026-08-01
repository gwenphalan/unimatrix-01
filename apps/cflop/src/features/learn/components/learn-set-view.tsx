import { useState } from "react";
import { ToolTitleBar } from "@unimatrix/chrome/tool";
import { Button } from "@unimatrix/ui/public";

import { AlgorithmSetToggle } from "@/features/algorithms/components/algorithm-set-toggle";
import { PreviewModeToggle } from "@/features/algorithms/components/preview-mode-toggle";
import { resolvePreviewMode } from "@/features/algorithms/preview-mode";
import { useAlgorithmSet } from "@/features/algorithms/use-algorithm-set";
import { usePreviewMode } from "@/features/algorithms/use-preview-mode";
import { LearnCasesGrid } from "@/features/learn/components/learn-cases-grid";
import { LearnPanel } from "@/features/learn/components/learn-panel";

type ViewMode = "session" | "cases";

export function LearnSetView() {
  const { setId, setSetId } = useAlgorithmSet();
  const [mode, setMode] = useState<ViewMode>("session");
  // Which case the session should open on. Picking one in the grid is the only way back to a
  // learned case's algorithm, since the teaching walk skips anything already marked known.
  const [openCaseId, setOpenCaseId] = useState<string | undefined>(undefined);
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

        <LearnCasesGrid
          key={setId}
          onSelectCase={(algorithmCase) => {
            setOpenCaseId(algorithmCase.id);
            setMode("session");
          }}
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
        title="Learning"
      />

      <LearnPanel
        initialCaseId={openCaseId}
        key={setId}
        previewMode={resolvedPreviewMode}
        setId={setId}
      />

      <div className="flex items-center justify-between gap-4">
        <AlgorithmSetToggle
          onChange={(nextSetId) => {
            // A case id only means anything within its own set, and `key={setId}` remounts the
            // panel anyway - carrying it across would open the new set on nothing.
            setOpenCaseId(undefined);
            setSetId(nextSetId);
          }}
          setId={setId}
        />
        <PreviewModeToggle mode={resolvedPreviewMode} onChange={setPreviewMode} setId={setId} />
      </div>
    </div>
  );
}
