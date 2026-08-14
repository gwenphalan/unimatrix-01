import { describe, expect, it } from "vitest";

import {
  DIAGRAM_PALETTE,
  UNFOLDED_NET_CELLS,
  WHITE_UP_DIAGRAM_PALETTE,
  applyMoves,
  createSolvedCube,
  deriveUnfoldedDiagram,
  parseAlgorithm,
  unfoldedNetCellColor,
} from "../src/index.js";
import type { FaceLetter, UnfoldedCubeDiagram } from "../src/index.js";

describe("deriveUnfoldedDiagram", () => {
  it("shows each face as its own letter on a solved cube", () => {
    const diagram = deriveUnfoldedDiagram(createSolvedCube());

    for (const face of ["U", "R", "F", "D", "L", "B"] as const) {
      expect(diagram[face]).toEqual(Array(9).fill(face));
    }
  });

  it("reads every face in row-major order after a U turn", () => {
    const cube = applyMoves(createSolvedCube(), parseAlgorithm("U"));
    const diagram = deriveUnfoldedDiagram(cube);

    expect(diagram.U.join("")).toBe("UUUUUUUUU");
    expect(diagram.R.join("")).toBe("BBBRRRRRR");
    expect(diagram.F.join("")).toBe("RRRFFFFFF");
    expect(diagram.D.join("")).toBe("DDDDDDDDD");
    expect(diagram.L.join("")).toBe("FFFLLLLLL");
    expect(diagram.B.join("")).toBe("LLLBBBBBB");
  });

  it("throws rather than silently rendering an incomplete cube", () => {
    const short = createSolvedCube().slice(0, 53);

    expect(() => deriveUnfoldedDiagram(short)).toThrow();
  });
});

describe("WHITE_UP_DIAGRAM_PALETTE", () => {
  it("matches the standard scheme held white-up with green in front", () => {
    expect(WHITE_UP_DIAGRAM_PALETTE).toEqual({
      B: "#3b82f6", // blue
      D: "#eab308", // yellow
      F: "#22c55e", // green
      L: "#f97316", // orange
      R: "#ef4444", // red
      U: "#f8fafc", // white
    });
  });

  it("is DIAGRAM_PALETTE half-turned about the F-B axis (U<->D, L<->R, F and B fixed)", () => {
    const swapped: Record<FaceLetter, FaceLetter> = { B: "B", D: "U", F: "F", L: "R", R: "L", U: "D" };

    for (const face of Object.keys(WHITE_UP_DIAGRAM_PALETTE) as FaceLetter[]) {
      expect(WHITE_UP_DIAGRAM_PALETTE[face]).toBe(DIAGRAM_PALETTE[swapped[face]]);
    }
  });
});

describe("UNFOLDED_NET_CELLS", () => {
  it("has 54 cells, 9 per face", () => {
    expect(UNFOLDED_NET_CELLS.length).toBe(54);

    for (const face of ["U", "R", "F", "D", "L", "B"] as const) {
      expect(UNFOLDED_NET_CELLS.filter((cell) => cell.face === face).length).toBe(9);
    }
  });

  it("stacks U above F and D below F, sharing F's x range", () => {
    const xRangeOf = (face: FaceLetter) => {
      const xs = UNFOLDED_NET_CELLS.filter((cell) => cell.face === face).map((cell) => cell.x);
      return [Math.min(...xs), Math.max(...xs)];
    };

    const fRange = xRangeOf("F");
    expect(xRangeOf("U")).toEqual(fRange);
    expect(xRangeOf("D")).toEqual(fRange);

    const yOf = (face: FaceLetter) => UNFOLDED_NET_CELLS.filter((cell) => cell.face === face)[0]?.y ?? -1;
    expect(yOf("U")).toBeLessThan(yOf("F"));
    expect(yOf("D")).toBeGreaterThan(yOf("F"));
  });

  it("lays L, F, R, B out as strictly increasing contiguous x bands at the same y", () => {
    const bandOf = (face: FaceLetter) => {
      const cells = UNFOLDED_NET_CELLS.filter((cell) => cell.face === face);
      const xs = cells.map((cell) => cell.x);
      return { maxX: Math.max(...xs), minX: Math.min(...xs), minY: Math.min(...cells.map((cell) => cell.y)) };
    };

    const [l, f, r, b] = (["L", "F", "R", "B"] as const).map(bandOf);
    expect(l).toBeDefined();
    expect(f).toBeDefined();
    expect(r).toBeDefined();
    expect(b).toBeDefined();
    if (!l || !f || !r || !b) return;

    expect(l.minY).toBe(f.minY);
    expect(f.minY).toBe(r.minY);
    expect(r.minY).toBe(b.minY);

    expect(l.maxX).toBeLessThan(f.minX);
    expect(f.maxX).toBeLessThan(r.minX);
    expect(r.maxX).toBeLessThan(b.minX);
  });
});

describe("unfoldedNetCellColor", () => {
  it("looks up the palette color of the facelet sitting at that cell", () => {
    const diagram = deriveUnfoldedDiagram(createSolvedCube());
    const cell = UNFOLDED_NET_CELLS.find((c) => c.face === "F");

    expect(cell).toBeDefined();
    if (!cell) return;

    expect(unfoldedNetCellColor(diagram, cell)).toBe(WHITE_UP_DIAGRAM_PALETTE.F);
  });

  it("throws rather than indexing the palette with undefined", () => {
    const diagram = deriveUnfoldedDiagram(createSolvedCube());
    const incomplete: UnfoldedCubeDiagram = { ...diagram, F: diagram.F.slice(0, 8) };
    const cell = UNFOLDED_NET_CELLS.find((c) => c.face === "F" && c.row === 2 && c.col === 2);

    expect(cell).toBeDefined();
    if (!cell) return;

    expect(() => unfoldedNetCellColor(incomplete, cell)).toThrow();
  });
});
