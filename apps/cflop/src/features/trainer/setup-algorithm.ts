import {
  applyMoves,
  createSolvedCube,
  invertMoves,
  isBottomTwoLayersSolved,
  netRotationFor,
  parseAlgorithm,
  rewriteAsOuterMoves,
  simplifyMoves,
} from "@unimatrix/cube";
import type { FaceletCube, Move } from "@unimatrix/cube";

import { deriveDiagramForSet } from "@/features/algorithms/derive-diagram";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";

export interface SetupAlgorithmChoice {
  algorithmIndex: number;
  moves: Move[];
  cube: FaceletCube;
}

/** Faces a right-handed solver has to regrip for. Fewer of them makes a scramble nicer to type. */
const AWKWARD_FACES = new Set(["B", "D", "L"]);

/**
 * The setup for one algorithm: its inverse, as outer face turns.
 *
 * The `netRotationFor` prefix must lead. It is what gives the whole sequence an identity net
 * centre permutation, which is the only reason `rewriteAsOuterMoves` accepts it - the inverse
 * of a rotation-carrying algorithm has no outer-turn-only form on its own.
 */
function buildSetup(algorithm: string): { moves: Move[]; cube: FaceletCube } {
  const algorithmMoves = parseAlgorithm(algorithm);
  const moves = simplifyMoves(
    rewriteAsOuterMoves([...netRotationFor(algorithmMoves), ...invertMoves(algorithmMoves)]),
  );

  return { cube: applyMoves(createSolvedCube(), moves), moves };
}

/**
 * Picks which of a case's listed algorithms to invert into its setup scramble. Not always
 * `algorithms[0]`: an alternate often inverts into a shorter or less regrip-heavy scramble for
 * the same puzzle state, and the panel keeps showing the primary either way.
 *
 * A candidate is valid when it reaches a state the primary's setup is interchangeable with:
 * the bottom two layers are still solved, *and* it derives the same diagram as the primary's.
 * Both conjuncts are stated because neither implies the other - the diagram says nothing about
 * F2L, and F2L says nothing about the last layer. On the current dataset the F2L conjunct
 * rejects nothing, so it is a guard against future data rather than something protecting the
 * cases shipped today.
 *
 * Index 0 is always a candidate: it defines the target, so the list is never empty and the
 * result is `undefined` only for a case with no algorithms at all.
 *
 * Pure in `(algorithmCase, setId)` - the consuming `useMemo`s re-run under `StrictMode`'s
 * double invocation, so anything random or time-dependent here would render two different
 * scrambles for one case.
 */
export function chooseSetupAlgorithm(
  algorithmCase: AlgorithmCase,
  setId: AlgorithmSetId,
): SetupAlgorithmChoice | undefined {
  const primary = algorithmCase.algorithms[0];
  if (!primary) return undefined;

  const target = buildSetup(primary);
  const targetDiagram = JSON.stringify(deriveDiagramForSet(setId, target.cube));

  const candidates = algorithmCase.algorithms.flatMap((algorithm, algorithmIndex) => {
    if (algorithmIndex === 0) return [{ algorithmIndex, ...target }];

    const candidate = buildSetup(algorithm);
    if (!isBottomTwoLayersSolved(candidate.cube)) return [];
    if (JSON.stringify(deriveDiagramForSet(setId, candidate.cube)) !== targetDiagram) return [];

    return [{ algorithmIndex, ...candidate }];
  });

  const scored = candidates.map((candidate) => ({
    ...candidate,
    awkward: candidate.moves.filter((move) => AWKWARD_FACES.has(move.face)).length,
    isPrimaryReversed: candidate.algorithmIndex === 0,
  }));

  // Not reversing the algorithm on screen outranks move quality: reading a scramble that is
  // the displayed algorithm backwards gives the case away before the learner recognises it.
  // The last key makes sort stability irrelevant.
  scored.sort(
    (a, b) =>
      Number(a.isPrimaryReversed) - Number(b.isPrimaryReversed) ||
      a.awkward - b.awkward ||
      a.moves.length - b.moves.length ||
      a.algorithmIndex - b.algorithmIndex,
  );

  const best = scored[0];
  if (!best) return undefined;

  return { algorithmIndex: best.algorithmIndex, cube: best.cube, moves: best.moves };
}
