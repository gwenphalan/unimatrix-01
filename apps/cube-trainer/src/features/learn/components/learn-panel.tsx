import { useEffect, useState } from "react";
import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import { Card, Kbd } from "@unimatrix/ui/public";

import { CaseDiagramView } from "@/features/algorithms/components/case-diagram-view";
import type { DiagramPreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";
import { useLearnSession } from "@/features/learn/use-learn-session";

export interface LearnPanelProps {
  /** A case picked in the Choose-cases grid; opens the session on it instead of at the start. */
  initialCaseId?: string | undefined;
  previewMode: DiagramPreviewMode;
  setId: AlgorithmSetId;
}

export function LearnPanel({ initialCaseId, previewMode, setId }: LearnPanelProps) {
  const {
    back,
    canGoBack,
    canGoNext,
    cube,
    currentCase,
    learned,
    next,
    setupMoves,
    toggleLearned,
  } = useLearnSession(setId, initialCaseId);
  const [showAlternates, setShowAlternates] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;

      if (event.code === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.code === "Space") {
        event.preventDefault();
        toggleLearned();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [back, next, toggleLearned]);

  if (!currentCase || !cube) {
    return (
      <Card className="site-panel site-panel-strong flex min-h-96 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">Every case in this set is known.</p>
      </Card>
    );
  }

  const [primaryAlgorithm, ...alternateAlgorithms] = currentCase.algorithms;

  return (
    <Card className="site-panel site-panel-strong flex flex-col items-center gap-6 px-6 py-10 text-center">
      <CaseDiagramView
        cube={cube}
        label={currentCase.displayName}
        mode={previewMode}
        setId={setId}
        size={180}
      />

      <div className="space-y-1.5">
        <p className="text-[0.65rem] font-medium tracking-[0.25em] text-muted-foreground/70 uppercase">
          Setup
        </p>
        {setupMoves ? (
          <p className="alg-move-string break-words text-muted-foreground">{setupMoves}</p>
        ) : null}
      </div>

      <div className="w-full max-w-xl space-y-3 border-t border-border/60 pt-5">
        <div className="space-y-1.5">
          <p className="text-[0.65rem] font-medium tracking-[0.25em] text-primary/85 uppercase">
            Solution
          </p>
          <p className="alg-move-string break-words">{primaryAlgorithm}</p>
        </div>

        {alternateAlgorithms.length > 0 ? (
          <div>
            <button
              className="cursor-pointer text-xs text-muted-foreground underline decoration-primary/35 underline-offset-4 transition-colors hover:text-foreground"
              onClick={() => {
                setShowAlternates((previous) => !previous);
              }}
              type="button"
            >
              {showAlternates
                ? "Hide alternates"
                : `Show ${alternateAlgorithms.length} alternate${alternateAlgorithms.length === 1 ? "" : "s"}`}
            </button>

            {showAlternates ? (
              <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                {alternateAlgorithms.map((algorithm, index) => (
                  <li className="alg-move-string break-words" key={`${currentCase.id}:${index}`}>
                    {algorithm}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        Hints are shown only for keys that would actually do something. A case opened from the
        grid after being marked learned sits outside the teaching walk, so it has nowhere to go
        back or next to - and advertising two dead keys is worse than advertising none.
      */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        {canGoBack ? (
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <RiArrowLeftLine aria-hidden="true" className="size-3" />
            </Kbd>
            Back
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Space</Kbd>
          {learned ? "Unmark learned" : "Mark learned"}
        </span>
        {canGoNext ? (
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <RiArrowRightLine aria-hidden="true" className="size-3" />
            </Kbd>
            Next
          </span>
        ) : null}
      </div>
    </Card>
  );
}
