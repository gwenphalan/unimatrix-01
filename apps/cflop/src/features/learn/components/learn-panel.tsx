import { useEffect, useState } from "react";
import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import { Card } from "@unimatrix/ui/public";

import { CaseDiagramView } from "@/features/algorithms/components/case-diagram-view";
import {
  PanelActionBar,
  type PanelAction,
} from "@/features/algorithms/components/panel-action-bar";
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
      // With a keyboard attached to a coarse-pointer device, Space on a focused Back button would
      // run toggleLearned() and - because preventDefault() here also suppresses the focused
      // button's own activation - swallow Back entirely. Let the button handle its own keys.
      if ((event.target as HTMLElement | null)?.closest("[data-panel-action]")) return;

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

  // Back and Next are reachable only when they would actually do something - a case opened from
  // the grid after being marked learned sits outside the teaching walk, so it has nowhere to go
  // back or next to, and advertising two dead controls is worse than advertising none. Both slots
  // stay in the layout regardless so the learned control does not jump sideways the moment an
  // arrow appears; the unavailable one is reserved space rather than a control.
  const actions: PanelAction[] = [
    {
      available: canGoBack,
      icon: RiArrowLeftLine,
      kind: "navigate",
      label: "Back",
      onActivate: back,
    },
    {
      keyLabel: "Space",
      kind: "act",
      label: learned ? "Unmark learned" : "Mark learned",
      onActivate: toggleLearned,
      shortLabel: learned ? "Unlearn" : "Learned",
    },
    {
      available: canGoNext,
      icon: RiArrowRightLine,
      kind: "navigate",
      label: "Next",
      onActivate: next,
    },
  ];

  return (
    <Card className="site-panel site-panel-strong flex flex-col items-center gap-6 px-6 py-10 text-center">
      <div className="space-y-1.5">
        <p className="text-[0.65rem] font-medium tracking-[0.25em] text-muted-foreground/70 uppercase">
          Setup
        </p>
        {/*
          A move string wraps to two lines for some cases and one for others at phone widths, and
          the panel grew and shrank between cases, shifting the cube and the buttons. Two lines of
          `.alg-move-string` leading is 3.5rem; reserving it on the wrapper rather than the string
          keeps the reservation when a case has no setup at all. Coarse pointers only - the
          strings fit on one line at desktop widths, where this would be a permanent gap.
        */}
        <div className="pointer-coarse:min-h-14">
          {setupMoves ? (
            <p className="alg-move-string break-words text-muted-foreground">{setupMoves}</p>
          ) : null}
        </div>
      </div>

      <CaseDiagramView
        cube={cube}
        label={currentCase.displayName}
        mode={previewMode}
        setId={setId}
        size={180}
      />

      <div className="w-full max-w-xl space-y-3">
        <div className="space-y-1.5">
          <p className="text-[0.65rem] font-medium tracking-[0.25em] text-muted-foreground/70 uppercase">
            Solution
          </p>
          <p className="alg-move-string break-words pointer-coarse:min-h-14">{primaryAlgorithm}</p>
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

      <PanelActionBar actions={actions} />
    </Card>
  );
}
