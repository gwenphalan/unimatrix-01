import { createSolvedCube, movesToString } from "@unimatrix/cube";
import type { FaceletCube } from "@unimatrix/cube";

import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { chooseSetupAlgorithm } from "@/features/trainer/setup-algorithm";

export interface CaseSetup {
  cube: FaceletCube;
  setupMoves: string;
}

/**
 * What a case looks like plus the scramble that reaches it, derived from the case's own
 * algorithms so there is no separate per-case facelet data to keep in sync.
 *
 * `setupMoves` is outer face turns only - no rotations, no wide turns, no `M`/`S`/`E` - so it
 * is a scramble a learner can type into any timer or cube app. Which algorithm gets inverted
 * is `chooseSetupAlgorithm`'s decision, not necessarily the one the panel displays.
 */
export function getCaseSetup(algorithmCase: AlgorithmCase, setId: AlgorithmSetId): CaseSetup {
  const choice = chooseSetupAlgorithm(algorithmCase, setId);

  if (!choice) {
    return { cube: createSolvedCube(), setupMoves: "" };
  }

  return { cube: choice.cube, setupMoves: movesToString(choice.moves) };
}
