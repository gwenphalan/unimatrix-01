import { useEffect, useRef } from "react";

import { Card, Kbd, useCircuitOccluder } from "@unimatrix/ui/public";

import { CaseDiagramView } from "@/features/algorithms/components/case-diagram-view";
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  useCircuitOccluder(panelRef);

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
    <Card
      className="site-panel site-panel-strong flex min-h-96 flex-col items-center justify-center gap-6 px-6 py-10 text-center"
      ref={panelRef}
    >
      {currentCase && cube ? (
        <>
          <CaseDiagramView
            cube={cube}
            label={currentCase.displayName}
            mode={previewMode}
            setId={setId}
            size={180}
          />

          {setupMoves ? <p className="alg-move-string break-words">{setupMoves}</p> : null}

          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Kbd>Space</Kbd>
            Next case
          </span>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No cases enabled — choose some cases to start drilling.
        </p>
      )}
    </Card>
  );
}
