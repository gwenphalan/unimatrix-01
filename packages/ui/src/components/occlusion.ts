import { GRID, type Point, cellKey } from "./grid-math.js";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** A DOM-measured registrant rect, in viewport coordinates. */
export type Occluder = Rect;

// Margin (px) beyond a moved occluder's edge within which a trace tip counts
// as "affected" for scroll-retarget purposes (`findAffectedTraceIds` in
// `scroll-retarget.ts`). Independent of the hard-barrier buffer below —
// retuning one must never resize the other.
export const OCCLUDER_AFFECT_MARGIN_PX = GRID * 4;
// Hard-barrier clearance (px) beyond an occluder's own edge. Cell blocking
// uses the "inside" rounding rule (ceil the min edge, floor the max edge)
// so effective clearance lands in [OCCLUDER_BUFFER_PX, OCCLUDER_BUFFER_PX +
// GRID) rather than snapping outward to the next full cell on both sides —
// the outward-snap alternative was measured to turn an 8px buffer into
// 48-88px of real clearance, several times the stated 5-10px ask. A rect
// whose inflated span contains no lattice point on an axis (thinner than one
// grid cell, or straddling a cell boundary) falls back to blocking the
// single nearest cell on that axis instead of blocking nothing.
export const OCCLUDER_BUFFER_PX = 8;

export function inflateRect(rect: Rect, buffer: number): Rect {
  return { x0: rect.x0 - buffer, y0: rect.y0 - buffer, x1: rect.x1 + buffer, y1: rect.y1 + buffer };
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
}

export type BarrierField = {
  /** Buffer-inflated occluder rects, for exact (non-lattice-snapped) segment tests. */
  readonly buffered: readonly Rect[];
  /** Lattice cells blocked by any inflated occluder — the cheap point/BFS test. */
  readonly cells: ReadonlySet<string>;
};

function axisRange(min: number, max: number): [number, number] {
  const cMin = Math.ceil(min / GRID);
  const cMax = Math.floor(max / GRID);
  if (cMin <= cMax) return [cMin, cMax];

  // No lattice point falls inside this axis's inflated span — block the
  // single nearest cell instead of leaving the axis unblocked.
  const nearest = Math.round((min + max) / 2 / GRID);
  return [nearest, nearest];
}

/**
 * Builds the hard-barrier field for the current occluder set: every
 * registered rect inflated by `buffer`, plus the lattice cells that fall
 * inside any inflated rect. `buffered` is the source of truth for exact
 * segment tests (`segmentCrossesBarrier`) and the debug overlay; `cells` is
 * the cheap point/BFS-occupancy test derived from it.
 */
export function buildBarrierField(
  occluders: readonly Occluder[],
  buffer: number = OCCLUDER_BUFFER_PX,
): BarrierField {
  const buffered = occluders.map((rect) => inflateRect(rect, buffer));
  const cells = new Set<string>();

  buffered.forEach((rect) => {
    const [cxMin, cxMax] = axisRange(rect.x0, rect.x1);
    const [cyMin, cyMax] = axisRange(rect.y0, rect.y1);

    for (let cx = cxMin; cx <= cxMax; cx += 1) {
      for (let cy = cyMin; cy <= cyMax; cy += 1) {
        cells.add(`${cx},${cy}`);
      }
    }
  });

  return { buffered, cells };
}

export function isCellBlocked(field: BarrierField, point: Point): boolean {
  return field.cells.has(cellKey(point));
}

/**
 * Exact (non-lattice-snapped) segment-vs-barrier test via Liang-Barsky
 * clipping against each inflated rect — the enforcement primitive for "a
 * trace must not enter the buffered region," independent of the coarser
 * per-cell blocking used for pad placement and BFS occupancy. Also correct
 * for a zero-length segment (a point test) and for a rect thinner than one
 * grid cell, neither of which the cell-based test alone can guarantee.
 */
export function segmentCrossesBarrier(field: BarrierField, a: Point, b: Point): boolean {
  return field.buffered.some((rect) => segmentIntersectsRect(a, b, rect));
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.x0, rect.x1 - a.x, a.y - rect.y0, rect.y1 - a.y];
  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i += 1) {
    const pi = p[i] as number;
    const qi = q[i] as number;

    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }

    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }

  return t0 <= t1;
}
