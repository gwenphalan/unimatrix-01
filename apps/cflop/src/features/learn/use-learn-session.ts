import { useCallback, useMemo, useState } from "react";
import type { FaceletCube } from "@unimatrix/cube";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { useCaseProgress } from "@/features/algorithms/use-case-progress";
import { orderedLearnCases } from "@/features/learn/learn-case-order";
import { getCaseSetup } from "@/features/trainer/case-setup";
import { mirrorLearnedCaseToPool } from "@/lib/pool-storage";

export interface LearnSessionState {
  currentCase: AlgorithmCase | undefined;
  /** The case's cube state; the view derives whichever diagram the active preview mode needs. */
  cube: FaceletCube | undefined;
  setupMoves: string | undefined;
  /** Whether the current case is marked known - drives the label on the mark/unmark key. */
  learned: boolean;
  canGoBack: boolean;
  canGoNext: boolean;
  next: () => void;
  back: () => void;
  /**
   * Marks the current case known, or - for a case opened from the grid - hands it back. Also
   * the sole writer that mirrors learned status into the drill pool; see `toggleLearned`.
   */
  toggleLearned: () => void;
}

/**
 * The teaching walk, plus one exception to it.
 *
 * The walk (`orderedLearnCases`) deliberately excludes learned cases, which is what made a
 * learned case unreachable: marking it known was the action that removed its algorithm from
 * the screen. `initialCaseId` is the way back in. A learned case opened that way is *pinned*
 * - shown outside the walk, with Back/Next reporting nothing to go to, because there is no
 * position in the walk for it to be at. Unmarking it hands it straight back: the cursor moves
 * to wherever it lands in the re-ordered walk and the pin drops, so navigation returns with
 * that case under the cursor rather than dumping you back at the start.
 *
 * `initialCaseId` is read once, on mount. The panel is unmounted while the Choose-cases grid
 * is up, so every trip through the grid mounts a fresh session - there is no second render
 * to keep in sync with, and nothing here has to watch the prop.
 */
export function useLearnSession(setId: AlgorithmSetId, initialCaseId?: string): LearnSessionState {
  const algorithmSet = getAlgorithmSet(setId);
  const groupedCases = useMemo(() => groupCasesByGroup(algorithmSet), [algorithmSet]);
  const { progress, updateStatus } = useCaseProgress(setId);

  const orderedCases = useMemo(
    () => orderedLearnCases(groupedCases, progress),
    [groupedCases, progress],
  );

  const [cursor, setCursor] = useState(() => {
    if (!initialCaseId) return 0;

    return Math.max(
      orderedCases.findIndex((algorithmCase) => algorithmCase.id === initialCaseId),
      0,
    );
  });
  const [pinnedCaseId, setPinnedCaseId] = useState<string | undefined>(() =>
    initialCaseId && progress[initialCaseId] === "known" ? initialCaseId : undefined,
  );

  const pinnedCase = useMemo(
    () =>
      pinnedCaseId
        ? algorithmSet.cases.find((algorithmCase) => algorithmCase.id === pinnedCaseId)
        : undefined,
    [algorithmSet, pinnedCaseId],
  );

  const clampedCursor =
    orderedCases.length === 0 ? 0 : Math.min(Math.max(cursor, 0), orderedCases.length - 1);
  const currentCase = pinnedCase ?? orderedCases[clampedCursor];
  const learned = currentCase ? progress[currentCase.id] === "known" : false;

  const setup = useMemo(
    () => (currentCase ? getCaseSetup(currentCase, setId) : undefined),
    [currentCase, setId],
  );

  const next = useCallback(() => {
    if (pinnedCase) return;

    setCursor((previous) => Math.min(previous + 1, orderedCases.length - 1));
  }, [orderedCases.length, pinnedCase]);

  const back = useCallback(() => {
    if (pinnedCase) return;

    setCursor((previous) => Math.max(previous - 1, 0));
  }, [pinnedCase]);

  const toggleLearned = useCallback(() => {
    if (!currentCase) return;

    if (!learned) {
      updateStatus(currentCase.id, "known");
      // toggleLearned is the only progress writer today; a second one would also need this
      // call, or the drill pool stops following learned status under the only-learned mode.
      mirrorLearnedCaseToPool(setId, currentCase.id, true);
      // The current case drops out of `orderedCases` on the next render, so the same
      // cursor index naturally slides onto what was the next case - no explicit advance.
      return;
    }

    // Where the case will sit once it rejoins the walk. Computed from the progress this call
    // is about to write rather than read back afterwards, so the cursor and the status land in
    // the same render and Back/Next never point at the old ordering.
    const rejoined = orderedLearnCases(groupedCases, { ...progress, [currentCase.id]: "new" });
    const index = rejoined.findIndex((algorithmCase) => algorithmCase.id === currentCase.id);

    setCursor(Math.max(index, 0));
    setPinnedCaseId(undefined);
    updateStatus(currentCase.id, "new");
    mirrorLearnedCaseToPool(setId, currentCase.id, false);
  }, [currentCase, groupedCases, learned, progress, setId, updateStatus]);

  return useMemo(
    () => ({
      back,
      canGoBack: !pinnedCase && clampedCursor > 0,
      canGoNext: !pinnedCase && clampedCursor < orderedCases.length - 1,
      cube: setup?.cube,
      currentCase,
      learned,
      next,
      setupMoves: setup?.setupMoves,
      toggleLearned,
    }),
    [
      back,
      clampedCursor,
      currentCase,
      learned,
      next,
      orderedCases.length,
      pinnedCase,
      setup,
      toggleLearned,
    ],
  );
}
