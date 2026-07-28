import { describe, expect, it } from "vitest";

import {
  CORNER_CELLS,
  CORNER_SILHOUETTE,
  CORNER_VIEWBOX_SIZE,
  projectCornerPoint,
} from "@/features/cube/corner-projection";
import type { CornerFace } from "@/features/cube/corner-projection";

const FACES: CornerFace[] = ["front", "right", "top"];

function parsePoints(points: string): { x: number; y: number }[] {
  return points.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number) as [number, number];
    return { x, y };
  });
}

function centroid(points: string): { x: number; y: number } {
  const parsed = parsePoints(points);
  return {
    x: parsed.reduce((sum, p) => sum + p.x, 0) / parsed.length,
    y: parsed.reduce((sum, p) => sum + p.y, 0) / parsed.length,
  };
}

function cell(face: CornerFace, row: number, col: number) {
  const found = CORNER_CELLS[face].find((c) => c.row === row && c.col === col);
  if (!found) throw new Error(`Missing cell ${face} ${row},${col}`);
  return found;
}

describe("corner projection", () => {
  it("emits nine four-point quads per visible face", () => {
    for (const face of FACES) {
      expect(CORNER_CELLS[face]).toHaveLength(9);
      for (const polygon of CORNER_CELLS[face]) {
        expect(parsePoints(polygon.points)).toHaveLength(4);
      }
    }
  });

  it("keeps every cell inside the viewBox", () => {
    for (const face of FACES) {
      for (const { x, y } of CORNER_CELLS[face].flatMap((c) => parsePoints(c.points))) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CORNER_VIEWBOX_SIZE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(CORNER_VIEWBOX_SIZE);
      }
    }
  });

  it("puts the U-F-R corner at the centre of the viewBox", () => {
    const [x, y] = projectCornerPoint(1.5, 1.5, 1.5);

    expect(x).toBeCloseTo(CORNER_VIEWBOX_SIZE / 2, 6);
    expect(y).toBeCloseTo(CORNER_VIEWBOX_SIZE / 2, 6);
  });

  it("draws the silhouette as the outer hexagon", () => {
    const hexagon = parsePoints(CORNER_SILHOUETTE);

    expect(hexagon).toHaveLength(6);
    // Back-top corner is the highest point, front-bottom corner the lowest; both are centred.
    expect(Math.min(...hexagon.map((p) => p.y))).toBeCloseTo(CORNER_VIEWBOX_SIZE / 2 - 80, 6);
    expect(Math.max(...hexagon.map((p) => p.y))).toBeCloseTo(CORNER_VIEWBOX_SIZE / 2 + 80, 6);
  });

  it("places the front face left of the right face", () => {
    expect(centroid(cell("front", 0, 2).points).x).toBeLessThan(
      centroid(cell("right", 0, 0).points).x,
    );
  });

  it("orders each face's columns left-to-right on screen", () => {
    for (const face of FACES) {
      for (let row = 0; row < 3; row += 1) {
        const xs = [0, 1, 2].map((col) => centroid(cell(face, row, col).points).x);

        expect(xs[0]).toBeLessThan(xs[1] as number);
        expect(xs[1]).toBeLessThan(xs[2] as number);
      }
    }
  });

  it("puts the top face above the side faces and row 0 of a side above row 2", () => {
    expect(centroid(cell("top", 2, 1).points).y).toBeLessThan(
      centroid(cell("front", 0, 1).points).y,
    );
    expect(centroid(cell("front", 0, 1).points).y).toBeLessThan(
      centroid(cell("front", 2, 1).points).y,
    );
    expect(centroid(cell("right", 0, 1).points).y).toBeLessThan(
      centroid(cell("right", 2, 1).points).y,
    );
  });

  it("draws the top face's row 0 (touching B) furthest from the viewer", () => {
    expect(centroid(cell("top", 0, 1).points).y).toBeLessThan(centroid(cell("top", 2, 1).points).y);
  });
});
