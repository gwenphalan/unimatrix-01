import { describe, expect, it } from "vitest";

import { GRID } from "../src/components/grid-math.js";
import {
  OCCLUDER_BUFFER_PX,
  type Occluder,
  buildBarrierField,
  inflateRect,
  isCellBlocked,
  segmentCrossesBarrier,
} from "../src/components/occlusion.js";

describe("inflateRect", () => {
  it("expands every edge outward by buffer", () => {
    const rect = { x0: 100, y0: 100, x1: 200, y1: 200 };
    expect(inflateRect(rect, 8)).toEqual({ x0: 92, y0: 92, x1: 208, y1: 208 });
  });
});

describe("buildBarrierField cell blocking", () => {
  it("blocks the first lattice line outside the buffered rect too (outward rounding rule)", () => {
    // Rect spans x in [0, GRID*4], buffer 8px -> inflated x in [-8, 168].
    // floor(-8/40)=-1, ceil(168/40)=5 -> cells -1..5 blocked on x.
    const rect: Occluder = { x0: 0, y0: 0, x1: GRID * 4, y1: GRID };
    const field = buildBarrierField([rect], 8);

    for (let cx = -1; cx <= 5; cx += 1) {
      expect(field.cells.has(`${cx},0`)).toBe(true);
    }
    expect(field.cells.has("6,0")).toBe(false);
    expect(field.cells.has("-2,0")).toBe(false);
  });

  /**
   * The inward rule this replaced could leave a trace flush against a
   * surface: a px-level buffer can't control clearance at a 40px lattice
   * pitch, it only decides which side of the buffer the nearest usable
   * lattice line lands on. Measured live, that let traces run 16px from one
   * panel edge and 79px from the opposite one.
   */
  it("guarantees at least a full grid cell of clearance past the buffer", () => {
    // Edge at x=300, buffer=8 -> inflated edge at 308. ceil(308/40)=8, so
    // lattice column 8 (x=320) is blocked as well and column 9 (x=360) is
    // the first free one — 60px of real clearance from the rect's true edge,
    // inside the (48, 88] band.
    const rect: Occluder = { x0: 0, y0: 0, x1: 300, y1: GRID };
    const field = buildBarrierField([rect], 8);

    expect(field.cells.has("8,0")).toBe(true);
    expect(field.cells.has("9,0")).toBe(false);
  });

  it("blocks the cells straddling a rect thinner than one grid cell", () => {
    // A rect entirely within one cell's span must still block something
    // rather than silently vanishing. Outward snapping handles this without
    // a special case: floor/ceil can't invert, so the pair of lattice lines
    // straddling the span comes back.
    const rect: Occluder = { x0: 41, y0: 41, x1: 43, y1: 43 };
    const field = buildBarrierField([rect], 0);

    expect(field.cells.has("1,1")).toBe(true);
    expect(field.cells.has("2,2")).toBe(true);
  });
});

describe("isCellBlocked", () => {
  const rect: Occluder = { x0: 100, y0: 100, x1: 300, y1: 300 };
  const field = buildBarrierField([rect], OCCLUDER_BUFFER_PX);

  it("reports a point deep inside the occluder as blocked", () => {
    expect(isCellBlocked(field, { x: 200, y: 200 })).toBe(true);
  });

  it("reports a point far outside the occluder as clear", () => {
    expect(isCellBlocked(field, { x: 1000, y: 1000 })).toBe(false);
  });
});

describe("segmentCrossesBarrier", () => {
  const rect: Occluder = { x0: 100, y0: 100, x1: 300, y1: 300 };
  const field = buildBarrierField([rect], 8);

  it("detects a segment passing straight through the rect", () => {
    expect(segmentCrossesBarrier(field, { x: 0, y: 200 }, { x: 400, y: 200 })).toBe(true);
  });

  it("clears a segment that stays entirely outside the buffered rect", () => {
    expect(segmentCrossesBarrier(field, { x: 0, y: 0 }, { x: 50, y: 50 })).toBe(false);
  });

  it("is exact for a rect thinner than one grid cell — a segment threading between lattice points still hits it", () => {
    const thin: Occluder = { x0: 100, y0: 41, x1: 300, y1: 43 };
    const thinField = buildBarrierField([thin], 0);

    // A horizontal segment at y=42 (between lattice rows 1 and 2) crosses
    // the thin rect exactly, even though no lattice point sits on y=42.
    expect(segmentCrossesBarrier(thinField, { x: 0, y: 42 }, { x: 400, y: 42 })).toBe(true);
  });

  it("treats a zero-length segment as a point test", () => {
    expect(segmentCrossesBarrier(field, { x: 200, y: 200 }, { x: 200, y: 200 })).toBe(true);
    expect(segmentCrossesBarrier(field, { x: 1000, y: 1000 }, { x: 1000, y: 1000 })).toBe(false);
  });
});
