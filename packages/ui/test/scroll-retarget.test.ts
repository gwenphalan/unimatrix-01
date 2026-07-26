import { describe, expect, it } from "vitest";

import { GRID, type RoutePoint } from "../src/components/grid-math.js";
import type { Occluder } from "../src/components/occlusion.js";
import { buildOccupiedFootprint, findAffectedTraceIds, retargetTip } from "../src/components/scroll-retarget.js";

function rp(x: number, y: number, corner = true): RoutePoint {
  return { x, y, corner };
}

describe("findAffectedTraceIds", () => {
  it("flags a trace whose tip falls within margin of a dirty rect", () => {
    const tips = [{ id: "t0", point: { x: 100, y: 100 } }];
    const dirty: Occluder[] = [{ x0: 90, y0: 90, x1: 200, y1: 200 }];

    expect(findAffectedTraceIds(tips, dirty, 0)).toEqual(["t0"]);
  });

  it("does not flag a trace whose tip is outside every dirty rect plus margin", () => {
    const tips = [{ id: "t0", point: { x: 0, y: 0 } }];
    const dirty: Occluder[] = [{ x0: 90, y0: 90, x1: 200, y1: 200 }];

    expect(findAffectedTraceIds(tips, dirty, 10)).toEqual([]);
  });

  it("returns nothing when there are no dirty rects", () => {
    const tips = [{ id: "t0", point: { x: 100, y: 100 } }];
    expect(findAffectedTraceIds(tips, [], 1000)).toEqual([]);
  });
});

describe("buildOccupiedFootprint", () => {
  it("unions every trace's cells except the excluded id", () => {
    const bodies = new Map<string, RoutePoint[]>([
      ["t0", [rp(0, 0), rp(GRID, 0)]],
      ["t1", [rp(0, GRID), rp(GRID, GRID)]],
    ]);

    const occupied = buildOccupiedFootprint(bodies, "t0");

    expect(occupied.has("0,0")).toBe(false);
    expect(occupied.has("1,0")).toBe(false);
    expect(occupied.has("0,1")).toBe(true);
    expect(occupied.has("1,1")).toBe(true);
  });

  it("also occupies in-flight target (toBody) cells, excluding the excluded id's own", () => {
    const bodies = new Map<string, RoutePoint[]>([["t0", [rp(0, 0), rp(GRID, 0)]]]);
    const inFlight = new Map<string, RoutePoint[]>([
      ["t1", [rp(0, GRID), rp(GRID, GRID)]],
      ["t0", [rp(2 * GRID, 0)]],
    ]);

    const occupied = buildOccupiedFootprint(bodies, "t0", inFlight);

    // t1's in-flight target cell is occupied even though t1 has no settled
    // liveBodyRef entry yet (it's mid-crawl).
    expect(occupied.has("0,1")).toBe(true);
    expect(occupied.has("1,1")).toBe(true);
    // t0's own in-flight target is excluded, same as its settled body.
    expect(occupied.has("2,0")).toBe(false);
  });
});

describe("retargetTip", () => {
  const width = 2000;
  const height = 2000;

  it("returns a lattice-snapped point strictly improving occlusion weight when open space exists", () => {
    // Horizontal final leg: pivot -> tip both at y = 10*GRID, tip sits just
    // inside an occluder; open space to extend further along the same line.
    const pivot = rp(9 * GRID, 10 * GRID);
    const tip = rp(10 * GRID, 10 * GRID);
    const body = [rp(8 * GRID, 10 * GRID), pivot, tip];
    const occluders: Occluder[] = [{ x0: 9.5 * GRID, y0: 9 * GRID, x1: 12 * GRID, y1: 11 * GRID }];

    const result = retargetTip(body, new Set(), occluders, width, height, () => 1);

    expect(result).not.toBeNull();
    expect(result?.y).toBe(10 * GRID);
    expect((result?.x ?? 0) % GRID).toBe(0);
  });

  it("returns null when boxed in on all sides along its own line", () => {
    const pivot = rp(9 * GRID, 10 * GRID);
    const tip = rp(10 * GRID, 10 * GRID);
    const body = [pivot, tip];
    const occupied = new Set<string>();
    for (let dx = -5; dx <= 5; dx += 1) {
      occupied.add(`${10 + dx},10`);
    }
    occupied.delete("10,10"); // the tip's own cell isn't "occupied by another trace"

    const result = retargetTip(body, occupied, [], width, height, () => 1);

    expect(result).toBeNull();
  });

  it("returns null when no candidate strictly improves weight (open field, no occluders)", () => {
    const pivot = rp(9 * GRID, 10 * GRID);
    const tip = rp(10 * GRID, 10 * GRID);
    const body = [pivot, tip];
    // With no occluders `occlusionWeightAt` is 1 everywhere — every examined
    // candidate ties the current tip's weight, never strictly beats it.
    // Cycle through a few distinct non-zero step counts so this actually
    // exercises multiple real candidates rather than degenerating to
    // "nothing was ever examined."
    const values = [0.9, 0.2, 0.7, 0.4];
    let i = 0;
    const rand = () => values[i++ % values.length] as number;

    const result = retargetTip(body, new Set(), [], width, height, rand);

    expect(result).toBeNull();
  });

  it("returns null under the sole-ownership guard when the tip's own cell is claimed by another trace", () => {
    const pivot = rp(9 * GRID, 10 * GRID);
    const tip = rp(10 * GRID, 10 * GRID);
    const body = [pivot, tip];
    const occupied = new Set(["10,10"]);
    const occluders: Occluder[] = [{ x0: 9.5 * GRID, y0: 9 * GRID, x1: 12 * GRID, y1: 11 * GRID }];

    const result = retargetTip(body, occupied, occluders, width, height, () => 1);

    expect(result).toBeNull();
  });

  it("rejects a candidate whose connecting segment would retrace the trace's own body", () => {
    // Body folds back on itself one step short of the tip, so any
    // extension along the line immediately re-enters the trace's own cells.
    const pivot = rp(9 * GRID, 10 * GRID);
    const tip = rp(10 * GRID, 10 * GRID);
    const body = [rp(11 * GRID, 10 * GRID), pivot, tip];
    const occluders: Occluder[] = [{ x0: 9.5 * GRID, y0: 9 * GRID, x1: 12 * GRID, y1: 11 * GRID }];

    // Force the RNG to only ever propose "extend toward x=11*GRID" (steps
    // that land back on the trace's own prior segment).
    const result = retargetTip(body, new Set(), occluders, width, height, () => 1);

    expect(result).toBeNull();
  });

  it("returns null for a body shorter than 2 points", () => {
    expect(retargetTip([rp(0, 0)], new Set(), [], width, height)).toBeNull();
  });
});
