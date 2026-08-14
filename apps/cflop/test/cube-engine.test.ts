/**
 * Assertions about cflop's own generated OLL/PLL dataset (`gen:algs` output),
 * checked against `@unimatrix/cube`'s move engine: every shipped algorithm
 * round-trips, the Dot-group cases carry no oriented edges, and every
 * alternate algorithm reaches the same result as its case's primary. The
 * engine's own properties — composition, inversion, orientation
 * normalization — are asserted with no dataset dependency in
 * `packages/cube/test/cube-engine.test.ts` instead.
 */
import { describe, expect, it } from "vitest";

import { OLL_ALGORITHMS } from "@/features/algorithms/oll-algorithms.data";
import { PLL_ALGORITHMS } from "@/features/algorithms/pll-algorithms.data";
import {
  applyMoves,
  createSolvedCube,
  extractLastLayer,
  invertMoves,
  netRotationFor,
  normalizeOrientation,
  parseAlgorithm,
} from "@unimatrix/cube";
import type { FaceletCube } from "@unimatrix/cube";

// The state a case is drilled from. The net rotation is applied to the solved cube *before*
// inverting, so the two rotations cancel instead of interacting with the moves between them;
// correcting the orientation afterwards composes differently and gives a different permutation.
function setupStateFor(alg: string): FaceletCube {
  const moves = parseAlgorithm(alg);
  return applyMoves(createSolvedCube(), [...netRotationFor(moves), ...invertMoves(moves)]);
}

describe("full-dataset parser/engine smoke test", () => {
  // NOT a strong correctness check: this only proves (a) the parser accepts every token
  // actually used across the real OLL/PLL dataset (~150+ algorithm strings), and (b)
  // invertMoves/applyMoves are self-consistent for each of them. A systematically-reversed
  // move direction would cancel itself out here and still pass - that's exactly what
  // `packages/cube`'s identity tests (sexy move, sune, x/y/z^4, ...) exist to catch instead.
  const allCases = [...OLL_ALGORITHMS, ...PLL_ALGORITHMS];

  for (const algorithmCase of allCases) {
    algorithmCase.algorithms.forEach((algorithm, index) => {
      it(`${algorithmCase.id} algorithm[${index}] round-trips to solved via invert`, () => {
        const moves = parseAlgorithm(algorithm);
        const solved = createSolvedCube();
        const applied = applyMoves(solved, moves);
        const restored = applyMoves(applied, invertMoves(moves));

        expect(restored).toEqual(solved);
      });
    });
  }
});

describe("OLL Dot group ground truth", () => {
  // "Dot" specifically means zero EDGES are oriented (none of the 4 top-face edge
  // facelets show U, so the top shows no line/cross through the center - just a "dot").
  // It does NOT mean corners are unoriented too: the Dot group has 8 different cases
  // (oll-1..4, oll-17..20) precisely because they differ in which corners *are* oriented
  // while all 4 edges stay unoriented - if corners had to be unoriented as well there
  // would only be one Dot pattern, not eight. So we assert the edge positions (top indices
  // 1, 3, 5, 7 in our row-major layout - the non-corner cells) are never U, and leave the
  // corner positions (0, 2, 6, 8) unconstrained.
  //
  // Side rows: a misoriented edge has only 2 possible states (U-sticker on top, or
  // U-sticker on the side), so if it's not oriented its U-valued sticker necessarily shows
  // on its side facelet (the middle of each sideRows entry) - we assert that positive fact
  // too, since it's a second, independent way the same "no edge is oriented" property
  // shows up in extractLastLayer's output.
  const dotCaseIds = ["oll-1", "oll-17"];

  for (const caseId of dotCaseIds) {
    it(`${caseId} (Dot) has no oriented edges after solving-inverted setup + normalize`, () => {
      const dotCase = OLL_ALGORITHMS.find((c) => c.id === caseId);
      if (!dotCase) throw new Error(`Missing expected Dot-group case: ${caseId}`);
      expect(dotCase.group).toBe("Dot");

      const primary = dotCase.algorithms[0];
      if (!primary) throw new Error(`Case ${caseId} has no primary algorithm`);

      const { top, sideRows } = extractLastLayer(normalizeOrientation(setupStateFor(primary)));

      expect(top[4]).toBe("U");
      for (const edgeIndex of [1, 3, 5, 7]) {
        expect(top[edgeIndex]).not.toBe("U");
      }

      for (const row of [sideRows.front, sideRows.right, sideRows.back, sideRows.left]) {
        expect(row[1]).toBe("U");
      }
    });
  }
});

describe("alternate algorithms consistency", () => {
  // OLL algorithms only fix *orientation* - they make no promise about permutation. Two
  // independently-published OLL algorithms for the same case can legitimately leave the
  // last layer in different (but each internally consistent) permutation states, differing
  // by an arbitrary PLL - not just a single U turn. Traced one instance (oll-3 alternate[1])
  // by hand: after reorienting, exactly 3 side facelets differ from solved, in the precise
  // pattern of a U-perm (UR/UF/UL edges 3-cycled, all orientation and every corner
  // untouched) - a signature that is impossible to produce from a move-direction bug (those
  // produce messy, orientation-violating diffs) and impossible to express as any single
  // U/U'/U2 (AUF only ever cycles all four U-edges together, never exactly three). So the
  // correct property to assert differs by algorithm set:
  //   - OLL: every alternate must fully *orient* the last layer (this is the one thing an
  //     OLL algorithm actually guarantees), permutation may differ from the primary's.
  //   - PLL: PLL algorithms fix permutation completely, so every alternate must reach the
  //     literal solved cube - allowing only reorientation + a single leading/trailing AUF
  //     turn for algorithms written from a different recognition angle.
  const AUF_OPTIONS = ["", "U", "U2", "U'"];

  const ollWithAlternates = OLL_ALGORITHMS.filter((c) => c.algorithms.length > 1);
  const pllWithAlternates = PLL_ALGORITHMS.filter((c) => c.algorithms.length > 1);

  // Both collections below drive the suites through `describe.each` and a `for`, and an empty
  // one generates no tests and no failure - a regenerated dataset carrying no alternate at all
  // would turn this whole block into a green no-op.
  it("has cases carrying alternates to check", () => {
    expect(ollWithAlternates.length).toBeGreaterThan(0);
    expect(pllWithAlternates.length).toBeGreaterThan(0);
  });

  describe.each(ollWithAlternates)("$id", (algorithmCase) => {
    const primary = algorithmCase.algorithms[0];
    if (!primary) return;

    const setupState = setupStateFor(primary);

    algorithmCase.algorithms.forEach((algorithm, index) => {
      if (index === 0) return;

      it(`alternate[${index}] fully orients the last layer`, () => {
        // Full orientation is exactly "every last-layer piece's up-facing sticker shows
        // U" - permutation (which piece, i.e. which non-U color, ends up where) is not
        // OLL's job and is deliberately not asserted here. Checking the top face alone is
        // sufficient: each piece has exactly one U-sticker, so if all 9 top facelets read
        // "U" none can also be peeking out on a side.
        const { top } = extractLastLayer(
          normalizeOrientation(applyMoves(setupState, parseAlgorithm(algorithm))),
        );

        expect(top.every((facelet) => facelet === "U")).toBe(true);
      });
    });
  });

  // PLL algorithms fix permutation completely, so - unlike OLL above - every alternate
  // *should* reach exactly solved (up to reorientation + a single leading/trailing AUF turn
  // for algorithms written from a different recognition angle).
  for (const algorithmCase of pllWithAlternates) {
    const primary = algorithmCase.algorithms[0];
    if (!primary) continue;

    const setupState = setupStateFor(primary);
    const solved = createSolvedCube();

    algorithmCase.algorithms.forEach((algorithm, index) => {
      if (index === 0) return;

      const testName = `${algorithmCase.id} alternate[${index}] solves the primary's setup state (up to reorientation + a leading/trailing AUF turn)`;

      it(testName, () => {
        const solvesUpToAuf = AUF_OPTIONS.some((preAuf) => {
          const preApplied = preAuf ? applyMoves(setupState, parseAlgorithm(preAuf)) : setupState;
          const normalized = normalizeOrientation(
            applyMoves(preApplied, parseAlgorithm(algorithm)),
          );

          return AUF_OPTIONS.some((postAuf) => {
            const withPostAuf = postAuf
              ? applyMoves(normalized, parseAlgorithm(postAuf))
              : normalized;
            return JSON.stringify(withPostAuf) === JSON.stringify(solved);
          });
        });

        expect(solvesUpToAuf).toBe(true);
      });
    });
  }
});
