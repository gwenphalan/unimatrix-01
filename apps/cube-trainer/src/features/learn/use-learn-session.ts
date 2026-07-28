import { useCallback, useMemo, useState } from "react";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { useCaseProgress } from "@/features/algorithms/use-case-progress";
import type { FaceletCube } from "@/features/cube/model";
import { orderedLearnCases } from "@/features/learn/learn-case-order";
import { getCaseSetup } from "@/features/trainer/case-setup";

export interface LearnSessionState {
  currentCase: AlgorithmCase | undefined;
  /** The case's cube state; the view derives whichever diagram the active preview mode needs. */
  cube: FaceletCube | undefined;
  setupMoves: string | undefined;
  canGoBack: boolean;
  canGoNext: boolean;
  next: () => void;
  back: () => void;
  markLearned: () => void;
}

export function useLearnSession(setId: AlgorithmSetId): LearnSessionState {
  const algorithmSet = getAlgorithmSet(setId);
  const groupedCases = useMemo(() => groupCasesByGroup(algorithmSet), [algorithmSet]);
  const { progress, updateStatus } = useCaseProgress(setId);

  const orderedCases = useMemo(
    () => orderedLearnCases(groupedCases, progress),
    [groupedCases, progress],
  );

  const [cursor, setCursor] = useState(0);

  const clampedCursor =
    orderedCases.length === 0 ? 0 : Math.min(Math.max(cursor, 0), orderedCases.length - 1);
  const currentCase = orderedCases[clampedCursor];

  const setup = useMemo(() => (currentCase ? getCaseSetup(currentCase) : undefined), [currentCase]);

  const next = useCallback(() => {
    setCursor((previous) => Math.min(previous + 1, orderedCases.length - 1));
  }, [orderedCases.length]);

  const back = useCallback(() => {
    setCursor((previous) => Math.max(previous - 1, 0));
  }, []);

  const markLearned = useCallback(() => {
    if (!currentCase) return;
    updateStatus(currentCase.id, "known");
    // The current case drops out of `orderedCases` on the next render, so the same
    // cursor index naturally slides onto what was the next case - no explicit advance.
  }, [currentCase, updateStatus]);

  return useMemo(
    () => ({
      back,
      canGoBack: clampedCursor > 0,
      canGoNext: clampedCursor < orderedCases.length - 1,
      cube: setup?.cube,
      currentCase,
      markLearned,
      next,
      setupMoves: setup?.setupMoves,
    }),
    [back, clampedCursor, currentCase, markLearned, next, orderedCases.length, setup],
  );
}
