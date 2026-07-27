import { describe, expect, it } from "vitest";

import {
  TRAIL_MAX_STEP_PX,
  polylineArcLength,
  pushTrailPoint,
  slicePolyline,
  trailSlices,
} from "../src/components/packet-trail.js";

describe("pushTrailPoint", () => {
  it("seeds an empty history with the first sample", () => {
    expect(pushTrailPoint([], { x: 10, y: 20 })).toEqual([{ x: 10, y: 20 }]);
  });

  it("leaves the history untouched when the packet has not moved", () => {
    const trail = [{ x: 10, y: 20 }];
    expect(pushTrailPoint(trail, { x: 10, y: 20 })).toBe(trail);
  });

  it("collapses collinear samples into the head instead of growing the array", () => {
    let trail = pushTrailPoint([], { x: 0, y: 0 });
    trail = pushTrailPoint(trail, { x: 4, y: 0 });
    trail = pushTrailPoint(trail, { x: 8, y: 0 });
    trail = pushTrailPoint(trail, { x: 12, y: 0 });

    // One head plus one tail vertex — not one point per sample.
    expect(trail).toEqual([
      { x: 12, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it("keeps the corner vertex when the direction changes, so the trail bends", () => {
    let trail = pushTrailPoint([], { x: 0, y: 0 });
    trail = pushTrailPoint(trail, { x: 10, y: 0 });
    trail = pushTrailPoint(trail, { x: 10, y: 10 });

    expect(trail).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it("trims the tail to the requested arc length rather than a sample count", () => {
    let trail = pushTrailPoint([], { x: 0, y: 0 }, 10);
    trail = pushTrailPoint(trail, { x: 0, y: 20 }, 10);

    expect(polylineArcLength(trail)).toBeCloseTo(10);
    expect(trail[0]).toEqual({ x: 0, y: 20 });
    expect(trail[trail.length - 1]).toEqual({ x: 0, y: 10 });
  });

  it("drops the history on a discontinuity instead of splicing two walks together", () => {
    const trail = pushTrailPoint([], { x: 0, y: 0 });
    const jumped = pushTrailPoint(trail, { x: TRAIL_MAX_STEP_PX + 50, y: 0 });

    expect(jumped).toEqual([{ x: TRAIL_MAX_STEP_PX + 50, y: 0 }]);
  });
});

describe("slicePolyline", () => {
  it("interpolates both cut ends onto the requested offsets", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];

    expect(slicePolyline(points, 20, 50)).toEqual([
      { x: 20, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("preserves the interior vertex of a corner it spans", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    expect(slicePolyline(points, 5, 15)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("returns nothing for an empty or inverted range", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];

    expect(slicePolyline(points, 5, 5)).toEqual([]);
    expect(slicePolyline(points, 8, 2)).toEqual([]);
  });
});

describe("trailSlices", () => {
  it("splits the trail head-first into equal-length pieces that tile it exactly", () => {
    const trail = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const slices = trailSlices(trail, 4);

    expect(slices).toHaveLength(4);
    // Slice 0 starts at the head (the packet itself), the last ends at the tail.
    expect(slices[0]?.[0]).toEqual({ x: 0, y: 0 });
    expect(slices[3]?.[slices[3].length - 1]).toEqual({ x: 100, y: 0 });
    slices.forEach((slice) => {
      expect(polylineArcLength(slice)).toBeCloseTo(25);
    });
  });

  it("returns nothing for a history too short to draw", () => {
    expect(trailSlices([{ x: 0, y: 0 }], 4)).toEqual([]);
    expect(trailSlices([], 4)).toEqual([]);
  });
});
