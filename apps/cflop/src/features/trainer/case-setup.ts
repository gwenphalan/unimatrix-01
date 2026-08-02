import type { AlgorithmCase } from "@/features/algorithms/types";
import { applyMoves, netRotationFor } from "@/features/cube/engine";
import { createSolvedCube } from "@/features/cube/model";
import type { FaceletCube } from "@/features/cube/model";
import { invertMoves, movesToString, parseAlgorithm } from "@/features/cube/notation";
import { rewriteAsOuterMoves, simplifyMoves } from "@/features/cube/outer-moves";

export interface CaseSetup {
  cube: FaceletCube;
  setupMoves: string;
}

/**
 * Derives what a case actually looks like from its primary algorithm alone (no separate
 * per-case facelet data to keep in sync).
 *
 * `setupMoves` is outer face turns only, so it is a scramble a learner can type into any
 * timer or cube app. Getting there needs both steps below and neither is optional:
 *
 * - The `netRotationFor` prefix. Some algorithms (mostly PLL - Aa, Ab, E, Ja, ...) carry a net
 *   whole-cube rotation, and that rotation must be applied to the solved cube *before*
 *   inverting the algorithm rather than corrected afterwards: it does not commute with the
 *   algorithm's other moves, so undoing it post-hoc on the already-inverted state gives a
 *   different (wrong) permutation. See `netRotationFor`'s doc comment.
 * - `rewriteAsOuterMoves`. It refuses a sequence whose net rotation is not the identity, which
 *   the prefix is exactly what guarantees - the inverse of a rotation-carrying algorithm on
 *   its own has no outer-turn-only form at all.
 */
export function getCaseSetup(algorithmCase: AlgorithmCase): CaseSetup {
  const primary = algorithmCase.algorithms[0];

  if (!primary) {
    return { cube: createSolvedCube(), setupMoves: "" };
  }

  const primaryMoves = parseAlgorithm(primary);
  const setupMoveList = simplifyMoves(
    rewriteAsOuterMoves([...netRotationFor(primaryMoves), ...invertMoves(primaryMoves)]),
  );

  return {
    cube: applyMoves(createSolvedCube(), setupMoveList),
    setupMoves: movesToString(setupMoveList),
  };
}
