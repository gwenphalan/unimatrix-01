import { describe, expect, it } from "vitest";

import { applyMoves } from "@/features/cube/engine";
import { createSolvedCube } from "@/features/cube/model";
import { movesToString, parseAlgorithm } from "@/features/cube/notation";
import { isOuterFace, rewriteAsOuterMoves, simplifyMoves } from "@/features/cube/outer-moves";

function stateOf(alg: string) {
  return applyMoves(createSolvedCube(), parseAlgorithm(alg));
}

describe("rewriteAsOuterMoves - the conjugation table", () => {
  // The table `rewriteAsOuterMoves` spins its orientation accumulator with, restated here and
  // checked against the engine rather than against the module's own copy: `rot f rot'` must
  // turn exactly the named face. The mirrored reading (`rot' f rot`) is a different table, and
  // an accidental transposition passes every state test whose net rotation happens to cancel.
  const conjugations: [rotation: string, face: string, equivalent: string][] = [
    ["x", "U", "F"],
    ["x", "D", "B"],
    ["x", "L", "L"],
    ["x", "R", "R"],
    ["x", "F", "D"],
    ["x", "B", "U"],
    ["y", "U", "U"],
    ["y", "D", "D"],
    ["y", "L", "F"],
    ["y", "R", "B"],
    ["y", "F", "R"],
    ["y", "B", "L"],
    ["z", "U", "L"],
    ["z", "D", "R"],
    ["z", "L", "D"],
    ["z", "R", "U"],
    ["z", "F", "F"],
    ["z", "B", "B"],
  ];

  it.each(conjugations)("$0 $1 $0' turns the $2 face", (rotation, face, equivalent) => {
    expect(stateOf(`${rotation} ${face} ${rotation}'`)).toEqual(stateOf(equivalent));
  });
});

describe("rewriteAsOuterMoves - the decomposition table", () => {
  // Every non-outer quarter turn the parser accepts, restated as the outer turns plus
  // rotations the module decomposes it into. A wrong entry here is a wrong cube state, not a
  // longer move string.
  const decompositions: [token: string, equivalent: string][] = [
    ["E", "U D' y'"],
    ["M", "R L' x'"],
    ["S", "F' B z"],
    ["b", "F z'"],
    ["d", "U y'"],
    ["f", "B z"],
    ["l", "R x'"],
    ["r", "L x"],
    ["u", "D y"],
  ];

  it.each(decompositions)("%s is exactly %s", (token, equivalent) => {
    expect(stateOf(token)).toEqual(stateOf(equivalent));
  });
});

describe("rewriteAsOuterMoves", () => {
  it("emits quarter turns only, so a half or reverse turn comes back expanded", () => {
    expect(rewriteAsOuterMoves(parseAlgorithm("R' U2"))).toEqual([
      { face: "R", turns: 1 },
      { face: "R", turns: 1 },
      { face: "R", turns: 1 },
      { face: "U", turns: 1 },
      { face: "U", turns: 1 },
    ]);
  });

  it("preserves the cube state of a sequence mixing wide turns and slices", () => {
    const alg = "r U R' U' M U R U' R'";
    const expected = stateOf(alg);
    const rewritten = rewriteAsOuterMoves(parseAlgorithm(alg));

    expect(applyMoves(createSolvedCube(), rewritten)).toEqual(expected);
    expect(applyMoves(createSolvedCube(), simplifyMoves(rewritten))).toEqual(expected);
    expect(simplifyMoves(rewritten).every((move) => isOuterFace(move.face))).toBe(true);
  });

  it("rejects a face it has no decomposition for", () => {
    expect(() => rewriteAsOuterMoves([{ face: "Q", turns: 1 }])).toThrow(
      "Cannot rewrite move face as outer turns: Q",
    );
  });

  it("rejects a sequence carrying a net whole-cube rotation", () => {
    expect(() => rewriteAsOuterMoves(parseAlgorithm("R U x"))).toThrow("no outer-turn-only form");
  });
});

describe("simplifyMoves", () => {
  it("merges a same-face run back into 2 / ' notation", () => {
    expect(movesToString(simplifyMoves(parseAlgorithm("R R")))).toBe("R2");
    expect(movesToString(simplifyMoves(parseAlgorithm("R R R")))).toBe("R'");
  });

  it("cascades across an intervening same-axis move but not across a different axis", () => {
    expect(movesToString(simplifyMoves(parseAlgorithm("U D U")))).toBe("U2 D");
    expect(movesToString(simplifyMoves(parseAlgorithm("R U R")))).toBe("R U R");
  });

  it("drops a move that cancels to nothing rather than leaving a zero-turn move", () => {
    const simplified = simplifyMoves(parseAlgorithm("U D U'"));

    expect(movesToString(simplified)).toBe("D");
    expect(simplified.every((move) => move.turns !== 0)).toBe(true);
  });

  it("rejects a non-outer face, whose cascade would not be equivalent", () => {
    expect(() => simplifyMoves(parseAlgorithm("x y x"))).toThrow(
      "Cannot simplify a non-outer move face: x",
    );
  });
});
