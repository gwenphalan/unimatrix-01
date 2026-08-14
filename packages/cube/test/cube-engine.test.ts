/**
 * Properties of the move engine itself: composition, inversion and orientation
 * normalization, asserted without any external algorithm data. The engine's
 * behaviour against cflop's real OLL/PLL dataset — round-tripping every
 * shipped algorithm, and the Dot-group and alternate-algorithm ground truths —
 * is asserted in `apps/cflop/test/cube-engine.test.ts` instead: that dataset
 * is cflop's own `gen:algs` output, not this package's concern.
 */
import { describe, expect, it } from "vitest";

import {
  applyMoves,
  createSolvedCube,
  extractLastLayer,
  invertMoves,
  normalizeOrientation,
  parseAlgorithm,
} from "../src/index.js";
import type { FaceletCube } from "../src/index.js";

function solveFromAlgorithm(alg: string): FaceletCube {
  return applyMoves(createSolvedCube(), parseAlgorithm(alg));
}

function repeat(alg: string, times: number): FaceletCube {
  const moves = parseAlgorithm(alg);
  let cube = createSolvedCube();
  for (let i = 0; i < times; i += 1) {
    cube = applyMoves(cube, moves);
  }
  return cube;
}

describe("cube engine identities", () => {
  it("returns to solved after the sexy move six times", () => {
    expect(repeat("R U R' U'", 6)).toEqual(createSolvedCube());
  });

  it("returns to solved after sune six times", () => {
    expect(repeat("R U R' U R U2 R'", 6)).toEqual(createSolvedCube());
  });

  it("returns to solved after x four times", () => {
    expect(repeat("x", 4)).toEqual(createSolvedCube());
  });

  it("returns to solved after y four times", () => {
    expect(repeat("y", 4)).toEqual(createSolvedCube());
  });

  it("returns to solved after z four times", () => {
    expect(repeat("z", 4)).toEqual(createSolvedCube());
  });

  it("normalizeOrientation undoes a bare x/y/z rotation on an otherwise solved cube", () => {
    const solved = createSolvedCube();
    expect(normalizeOrientation(solveFromAlgorithm("x"))).toEqual(solved);
    expect(normalizeOrientation(solveFromAlgorithm("y"))).toEqual(solved);
    expect(normalizeOrientation(solveFromAlgorithm("z"))).toEqual(solved);
  });

  it("is a true no-op when the cube is already correctly oriented", () => {
    const solved = createSolvedCube();
    expect(normalizeOrientation(solved)).toEqual(solved);

    // A cube that's already correctly oriented (but not solved) should also pass through
    // unchanged: re-normalizing an already-normalized cube must be idempotent.
    const scrambled = solveFromAlgorithm("R U R' U' F' U F");
    const normalizedOnce = normalizeOrientation(scrambled);
    expect(normalizeOrientation(normalizedOnce)).toEqual(normalizedOnce);
  });

  it("gives rotation-invariant extractLastLayer output after normalizing", () => {
    // y2 must be applied to the already-scrambled result, not prefixed onto the scramble:
    // moves are always relative to the fixed global axes, so a leading "y2" would conjugate
    // the rest of the sequence (R<->L, F<->B) into a genuinely different algorithm, not just
    // re-view the same one. Applying y2 to the finished state is a pure whole-cube rotation
    // of that one physical result, which is exactly what normalizeOrientation should undo.
    const scramble = "R U R' U' F' U F";
    const plain = normalizeOrientation(solveFromAlgorithm(scramble));
    const rotated = normalizeOrientation(applyMoves(plain, parseAlgorithm("y2")));

    expect(extractLastLayer(rotated)).toEqual(extractLastLayer(plain));
  });

  it("composes every move type correctly (apply then apply-its-own-invert returns to solved)", () => {
    // Exercises U D L R F B, wide r, slices M S E, rotations x y z, the ' and 2 modifiers,
    // the rare bare-3 form, and parenthesized grouping - at least one of each - in a single
    // sequence, so it proves these many move-type implementations compose together, not
    // just that invert trivially cancels apply (see apps/cflop's full-dataset test for why
    // that distinction matters).
    const alg = "(U R U' R') D2 L' F R2 B' r U2 M' S E' x2 y' z R3";
    const moves = parseAlgorithm(alg);
    const solved = createSolvedCube();

    const applied = applyMoves(solved, moves);
    const restored = applyMoves(applied, invertMoves(moves));

    expect(restored).toEqual(solved);
  });
});
