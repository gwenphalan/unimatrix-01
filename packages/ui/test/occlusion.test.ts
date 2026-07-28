import { describe, expect, it } from "vitest";

import { GRID } from "../src/components/grid-math.js";
import {
  OCCLUDER_BUFFER_PX,
  SOFT_OCCLUDER_BUFFER_PX,
  type Occluder,
  buildBarrierField,
  clampRectToViewport,
  inflateRect,
  isCellBlocked,
  pointInSoftBarrier,
  segmentCrossesBarrier,
  translateRect,
} from "../src/components/occlusion.js";

describe("inflateRect", () => {
  it("expands every edge outward by buffer", () => {
    const rect = { x0: 100, y0: 100, x1: 200, y1: 200 };
    expect(inflateRect(rect, 8)).toEqual({ x0: 92, y0: 92, x1: 208, y1: 208 });
  });

  /**
   * Both helpers rebuild the rect, and dropping `kind` would silently demote
   * every ink rect to a hard barrier on the first `translateRect` in
   * `CircuitField`'s barrier memo — a failure that shows up as "the field
   * vanished on text-heavy pages", nowhere near this file.
   */
  it("preserves the occluder kind", () => {
    const ink: Occluder = { x0: 100, y0: 100, x1: 200, y1: 120, kind: "soft" };

    expect(inflateRect(ink, 4).kind).toBe("soft");
    expect(translateRect(ink, 10, -10).kind).toBe("soft");
  });
});

describe("translateRect", () => {
  it("shifts every edge by the delta", () => {
    expect(translateRect({ x0: 100, y0: 100, x1: 200, y1: 200 }, 10, -20)).toEqual({
      x0: 110,
      y0: 80,
      x1: 210,
      y1: 180,
    });
  });
});

describe("clampRectToViewport", () => {
  it("trims a taller-than-viewport rect to the viewport box", () => {
    const tall: Occluder = { x0: 100, y0: -400, x1: 300, y1: 5000 };

    expect(clampRectToViewport(tall, 1440, 900)).toEqual({ x0: 100, y0: 0, x1: 300, y1: 900 });
  });

  it("returns null for a rect entirely off-screen", () => {
    expect(clampRectToViewport({ x0: 100, y0: 1200, x1: 300, y1: 1400 }, 1440, 900)).toBeNull();
    expect(clampRectToViewport({ x0: -300, y0: 100, x1: -100, y1: 300 }, 1440, 900)).toBeNull();
  });

  it("preserves the occluder kind", () => {
    const ink: Occluder = { x0: 100, y0: -10, x1: 300, y1: 40, kind: "soft" };

    expect(clampRectToViewport(ink, 1440, 900)?.kind).toBe("soft");
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

describe("soft (ink) channel", () => {
  // A 24px-tall line of text: far thinner than the 40px lattice pitch, which
  // is exactly why it must not reach `cells`.
  const ink: Occluder = { x0: 100, y0: 100, x1: 400, y1: 124, kind: "soft" };

  it("keeps soft rects out of the hard channel entirely", () => {
    const field = buildBarrierField([ink]);

    expect(field.buffered).toHaveLength(0);
    expect(field.cells.size).toBe(0);
    expect(field.soft).toHaveLength(1);
  });

  it("blocks no lattice cell, so the flood fill stays open across text", () => {
    const field = buildBarrierField([ink]);

    // Dead centre of the ink rect: a hard rect here would block this cell.
    expect(isCellBlocked(field, { x: 200, y: 120 })).toBe(false);
  });

  it("still populates softCells as an advisory routing-preference input", () => {
    const field = buildBarrierField([ink]);

    expect(field.softCells.size).toBeGreaterThan(0);
  });

  it("rejects an exact segment through the ink, at true glyph geometry", () => {
    const field = buildBarrierField([ink]);

    // y=112 sits between lattice rows 2 and 3 — no lattice point is inside
    // the ink at all, so only the exact test can catch this.
    expect(segmentCrossesBarrier(field, { x: 0, y: 112 }, { x: 500, y: 112 })).toBe(true);
    expect(segmentCrossesBarrier(field, { x: 0, y: 300 }, { x: 500, y: 300 })).toBe(false);
  });

  it("inflates soft rects by SOFT_OCCLUDER_BUFFER_PX, independently of the hard buffer", () => {
    const field = buildBarrierField([ink], 40);

    // Hard buffer of 40 must not touch the ink channel.
    expect(field.soft[0]).toEqual({
      x0: 100 - SOFT_OCCLUDER_BUFFER_PX,
      y0: 100 - SOFT_OCCLUDER_BUFFER_PX,
      x1: 400 + SOFT_OCCLUDER_BUFFER_PX,
      y1: 124 + SOFT_OCCLUDER_BUFFER_PX,
      kind: "soft",
    });
  });

  it("partitions a mixed set into the two channels", () => {
    const panel: Occluder = { x0: 600, y0: 600, x1: 800, y1: 800, kind: "hard" };
    const field = buildBarrierField([ink, panel]);

    expect(field.buffered).toHaveLength(1);
    expect(field.soft).toHaveLength(1);
    expect(isCellBlocked(field, { x: 700, y: 700 })).toBe(true);
    expect(isCellBlocked(field, { x: 200, y: 120 })).toBe(false);
  });

  it("treats an untagged rect as hard, so pre-ink call sites are unchanged", () => {
    const field = buildBarrierField([{ x0: 100, y0: 100, x1: 300, y1: 300 }]);

    expect(field.soft).toHaveLength(0);
    expect(isCellBlocked(field, { x: 200, y: 200 })).toBe(true);
  });
});

describe("pointInSoftBarrier", () => {
  const ink: Occluder = { x0: 100, y0: 100, x1: 400, y1: 124, kind: "soft" };
  const field = buildBarrierField([ink]);

  it("reports a point on the ink as blocked, for pad/via rejection", () => {
    expect(pointInSoftBarrier(field, { x: 200, y: 112 })).toBe(true);
  });

  it("reports a point clear of the ink as free", () => {
    expect(pointInSoftBarrier(field, { x: 200, y: 300 })).toBe(false);
  });

  it("is always false for a hard-only field", () => {
    const hardOnly = buildBarrierField([{ x0: 100, y0: 100, x1: 400, y1: 300 }]);

    expect(pointInSoftBarrier(hardOnly, { x: 200, y: 200 })).toBe(false);
  });
});
