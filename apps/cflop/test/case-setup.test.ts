import { describe, expect, it } from "vitest";
import {
  applyMoves,
  createSolvedCube,
  extractLastLayer,
  invertMoves,
  isBottomTwoLayersSolved,
  isOuterFace,
  netRotationFor,
  normalizeOrientation,
  parseAlgorithm,
} from "@unimatrix/cube";
import type { FaceletCube } from "@unimatrix/cube";

import { getAlgorithmSet } from "@/features/algorithms/algorithm-sets";
import { ALGORITHM_SET_IDS } from "@/features/algorithms/types";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import { getCaseSetup } from "@/features/trainer/case-setup";
import { chooseSetupAlgorithm } from "@/features/trainer/setup-algorithm";

function makeCase(id: string, algorithm: string): AlgorithmCase {
  return { algorithms: [algorithm], displayName: id, group: "Test", id, caseFrequency: 1 };
}

// All of D, plus rows 1-2 (not row 0, which belongs to the last layer) of R/F/L/B.
function bottomTwoLayersDiffCount(cube: FaceletCube): number {
  const solved = createSolvedCube();
  let diffs = 0;
  for (let i = 27; i < 36; i++) if (cube[i] !== solved[i]) diffs++;
  for (const faceStart of [9, 18, 36, 45]) {
    for (let i = faceStart + 3; i < faceStart + 9; i++) {
      if (cube[i] !== solved[i]) diffs++;
    }
  }
  return diffs;
}

const everyCase: { setId: AlgorithmSetId; algorithmCase: AlgorithmCase }[] =
  ALGORITHM_SET_IDS.flatMap((setId) =>
    getAlgorithmSet(setId).cases.map((algorithmCase) => ({ algorithmCase, setId })),
  );

describe("getCaseSetup - PLL cases carrying a net whole-cube rotation", () => {
  // Aa/Ab/Z each carry a net whole-cube rotation their solving moves never undo - a case
  // where undoing the rotation *after* inverting the algorithm (rather than pre-rotating
  // before inverting) previously produced a state with a corner cycled between the last layer
  // and the bottom two layers, which is impossible for a genuine PLL algorithm. The strings
  // are the shipped primaries for those cases; `netRotationFor` is what makes them work.
  const rotationCarryingCases = [
    ["Aa", "y x (R' U R') D2 (R U' R') D2 R2 x'"],
    ["Ab", "y2 x R2 D2 (R U R') D2 (R U' R) x'"],
    ["Z", "y U2 M' U' (M2 U') (M2 U') M' U2 M2"],
  ] as const;

  it.each(rotationCarryingCases)(
    "%s: last layer is fully oriented and the bottom two layers are untouched",
    (name, algorithm) => {
      const setup = getCaseSetup(makeCase(name, algorithm), "pll");
      expect(extractLastLayer(setup.cube).top.every((f) => f === "U")).toBe(true);
      expect(bottomTwoLayersDiffCount(setup.cube)).toBe(0);
    },
  );

  it("a rotation-free case (Ua) is unaffected by the pre-rotation logic", () => {
    const setup = getCaseSetup(makeCase("Ua", "U2 (R U R' U R') U' R2 U' (R' U R' U R)"), "pll");
    expect(extractLastLayer(setup.cube).top.every((f) => f === "U")).toBe(true);
    expect(bottomTwoLayersDiffCount(setup.cube)).toBe(0);
  });

  it("setupMoves reproduces the exact rendered cube when applied to a solved cube", () => {
    const setup = getCaseSetup(makeCase("Aa", "y x (R' U R') D2 (R U' R') D2 R2 x'"), "pll");
    expect(applyMoves(createSolvedCube(), parseAlgorithm(setup.setupMoves))).toEqual(setup.cube);
  });
});

// Every test here walks the whole dataset and collects the ids that fail, so a regression
// names each offending case instead of stopping at the first one.
describe("getCaseSetup - whole-dataset invariants", () => {
  it("renders the state the un-rewritten construction produces", () => {
    // The one assertion that would catch the outer-turn rewrite silently changing a state:
    // the right-hand side is built by a construction the rewrite plays no part in.
    const failing = everyCase
      .filter(({ algorithmCase, setId }) => {
        const choice = chooseSetupAlgorithm(algorithmCase, setId);
        const algorithm = choice && algorithmCase.algorithms[choice.algorithmIndex];
        if (!algorithm) return false;

        const moves = parseAlgorithm(algorithm);
        const expected = applyMoves(createSolvedCube(), [
          ...netRotationFor(moves),
          ...invertMoves(moves),
        ]);

        return JSON.stringify(getCaseSetup(algorithmCase, setId).cube) !== JSON.stringify(expected);
      })
      .map(({ algorithmCase }) => algorithmCase.id);

    expect(failing).toEqual([]);
  });

  it("leaves the bottom two layers solved", () => {
    const failing = everyCase
      .filter(
        ({ algorithmCase, setId }) =>
          !isBottomTwoLayersSolved(getCaseSetup(algorithmCase, setId).cube),
      )
      .map(({ algorithmCase }) => algorithmCase.id);

    expect(failing).toEqual([]);
  });

  it("is solved by the algorithm the panel displays", () => {
    // `normalizeOrientation` on the PLL branch is load-bearing, not tidying: the four
    // rotation-carrying cases (pll-z, pll-ub, pll-aa, pll-ab) finish in a rotated frame and
    // fail a bare comparison against the solved array.
    const solved = JSON.stringify(createSolvedCube());

    const failing = everyCase
      .filter(({ algorithmCase, setId }) => {
        const primary = algorithmCase.algorithms[0];
        if (!primary) return false;

        const solvedState = normalizeOrientation(
          applyMoves(getCaseSetup(algorithmCase, setId).cube, parseAlgorithm(primary)),
        );

        return setId === "oll"
          ? !extractLastLayer(solvedState).top.every((facelet) => facelet === "U")
          : JSON.stringify(solvedState) !== solved;
      })
      .map(({ algorithmCase }) => algorithmCase.id);

    expect(failing).toEqual([]);
  });

  it("emits outer face turns only", () => {
    const failing = everyCase
      .filter(
        ({ algorithmCase, setId }) =>
          !parseAlgorithm(getCaseSetup(algorithmCase, setId).setupMoves).every((move) =>
            isOuterFace(move.face),
          ),
      )
      .map(({ algorithmCase }) => algorithmCase.id);

    expect(failing).toEqual([]);
  });

  it("round-trips setupMoves through movesToString and parseAlgorithm", () => {
    // Both sides come from the same move list, so this checks the notation round trip rather
    // than the cube state - the state assertion is the first test in this block.
    const failing = everyCase
      .filter(({ algorithmCase, setId }) => {
        const setup = getCaseSetup(algorithmCase, setId);
        const replayed = applyMoves(createSolvedCube(), parseAlgorithm(setup.setupMoves));

        return JSON.stringify(replayed) !== JSON.stringify(setup.cube);
      })
      .map(({ algorithmCase }) => algorithmCase.id);

    expect(failing).toEqual([]);
  });
});
