import { describe, expect, it } from "vitest";

import {
  applyMoves,
  createSolvedCube,
  derivePllCornerDiagram,
  parseAlgorithm,
} from "../src/index.js";

describe("derivePllCornerDiagram", () => {
  it("shows a fully oriented top and real side colors for a solved cube", () => {
    const diagram = derivePllCornerDiagram(createSolvedCube());

    expect(diagram.top.every((s) => s.kind === "oriented")).toBe(true);
    expect(diagram.front.every((s) => s.kind === "color" && s.face === "F")).toBe(true);
    expect(diagram.right.every((s) => s.kind === "color" && s.face === "R")).toBe(true);
  });

  // A solved cube cannot discriminate ordering - every side row is one uniform color. Single
  // quarter turns each move exactly one sticker into the last-layer row of a visible face, so
  // the index that sticker lands on pins the row's direction.
  it("orders the front row screen-left-to-right (L-adjacent end first)", () => {
    const cube = applyMoves(createSolvedCube(), parseAlgorithm("R"));
    const diagram = derivePllCornerDiagram(cube);

    // R pulls the D sticker up into F's top-right facelet, the R-adjacent end of the row.
    expect(diagram.front).toEqual([
      { face: "F", kind: "color" },
      { face: "F", kind: "color" },
      { face: "D", kind: "color" },
    ]);
  });

  it("orders the right row screen-left-to-right (F-adjacent end first)", () => {
    const cube = applyMoves(createSolvedCube(), parseAlgorithm("F"));
    const diagram = derivePllCornerDiagram(cube);

    // F pushes the U sticker onto R's top-front facelet, the F-adjacent end of the row.
    expect(diagram.right).toEqual([
      { face: "U", kind: "color" },
      { face: "R", kind: "color" },
      { face: "R", kind: "color" },
    ]);
  });

  it("reads the same top face as the flat PLL diagram (all oriented) for a real case", () => {
    const cube = applyMoves(createSolvedCube(), parseAlgorithm("M2 U M2 U2 M2 U M2"));
    const diagram = derivePllCornerDiagram(cube);
    const frontColors = new Set(diagram.front.map((s) => (s.kind === "color" ? s.face : null)));

    expect(diagram.top.every((s) => s.kind === "oriented")).toBe(true);
    expect(frontColors.size).toBeGreaterThan(1);
  });
});
