import { useEffect } from "react";

import { Card } from "@unimatrix/ui/public";

import { CaseDiagramView } from "@/features/algorithms/components/case-diagram-view";
import { PanelActionBar } from "@/features/algorithms/components/panel-action-bar";
import type { DiagramPreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { useAlgorithmTrainer } from "@/features/trainer/use-algorithm-trainer";

export function TrainerPanel({
  cases,
  previewMode,
  setId,
}: {
  cases: AlgorithmCase[];
  previewMode: DiagramPreviewMode;
  setId: AlgorithmSetId;
}) {
  const { cube, currentCase, next, setupMoves } = useAlgorithmTrainer(setId, cases);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.code !== "Space") return;
      event.preventDefault();
      next();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [next]);

  return (
    <Card className="site-panel site-panel-strong flex min-h-96 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      {currentCase && cube ? (
        <>
          <CaseDiagramView
            cube={cube}
            label={currentCase.displayName}
            mode={previewMode}
            setId={setId}
            size={180}
          />

          {/* Two lines' worth of leading, so a case whose setup wraps does not move the cube and
              the Next button. See the same reservation in `learn-panel.tsx`. */}
          <div className="pointer-coarse:min-h-14">
            {setupMoves ? <p className="alg-move-string break-words">{setupMoves}</p> : null}
          </div>

          <PanelActionBar
            actions={[
              {
                keyLabel: "Space",
                kind: "act",
                label: "Next",
                onActivate: next,
              },
            ]}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No cases enabled — choose some cases to start drilling.
        </p>
      )}
    </Card>
  );
}
