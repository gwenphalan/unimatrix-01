import { describe, expect, it } from "vitest";

import { GRID, type RoutePoint, densify, recomputeCorners } from "../src/components/grid-math.js";
import { type Occluder, buildBarrierField, isCellBlocked } from "../src/components/occlusion.js";
import { buildRoute } from "../src/components/route-engine.js";

function rp(x: number, y: number): RoutePoint {
  return { x, y, corner: true };
}

describe("buildRoute barrier awareness", () => {
  it("routes around a barrier sitting directly between from and to", () => {
    const from = recomputeCorners(densify([rp(0, 0)]));
    const to = recomputeCorners(densify([rp(4 * GRID, 0)]));
    const occluder: Occluder = { x0: GRID * 1.5, y0: -GRID, x1: GRID * 2.5, y1: GRID };
    const barriers = buildBarrierField([occluder]);

    const route = buildRoute(from, to, barriers);

    route.forEach((point) => {
      expect(isCellBlocked(barriers, point)).toBe(false);
    });
    // Still reaches the target.
    expect(route[route.length - 1]).toMatchObject({ x: 4 * GRID, y: 0 });
  });

  it("without a barriers argument, reproduces the pre-barrier collision-only behavior", () => {
    const from = recomputeCorners(densify([rp(0, 0)]));
    const to = recomputeCorners(densify([rp(2 * GRID, 0)]));

    const route = buildRoute(from, to);

    expect(route[0]).toMatchObject({ x: 0, y: 0 });
    expect(route[route.length - 1]).toMatchObject({ x: 2 * GRID, y: 0 });
  });

  it("lets a from-body already standing inside a barrier escape it (escape rule)", () => {
    // `from`'s own footprint (cell 2) is barrier-blocked, simulating an
    // occluder that appeared on top of an already-settled trace.
    const from = recomputeCorners(densify([rp(0, 0), rp(2 * GRID, 0)]));
    const to = recomputeCorners(densify([rp(2 * GRID, 3 * GRID)]));
    const occluder: Occluder = { x0: GRID * 1.5, y0: -GRID, x1: GRID * 2.5, y1: GRID * 0.5 };
    const barriers = buildBarrierField([occluder]);

    const route = buildRoute(from, to, barriers);

    // A route is produced (the escape rule keeps from's own footprint cell
    // passable) rather than the function warning and falling back empty.
    expect(route.length).toBeGreaterThan(0);
    expect(route[route.length - 1]).toMatchObject({ x: 2 * GRID, y: 3 * GRID });
  });
});
