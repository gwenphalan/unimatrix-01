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
// snaps *outward* (floor the min edge, ceil the max edge), so the first
// lattice line outside the inflated rect is blocked too and effective
// clearance lands in (OCCLUDER_BUFFER_PX + GRID, OCCLUDER_BUFFER_PX + 2 *
// GRID] — roughly 48-88px at the current grid.
//
// The inward rule this replaces (ceil/floor) was tuned to keep clearance
// near a stated 5-10px ask, but a px-level buffer can't actually control
// clearance when the lattice pitch is 40px: it only decides *which side* of
// the buffer the nearest usable lattice line falls on. In practice that let
// a trace run 16px from a panel edge on one side and 79px on the other
// (measured live on cube-trainer's drill panel) — the tight edges read as
// the surface having no buffer at all. Outward snapping trades some usable
// canvas for a clearance that is both guaranteed and near-uniform per edge.
//
// A rect whose inflated span contains no lattice point on an axis (thinner
// than one grid cell, or straddling a cell boundary) falls back to blocking
// the single nearest cell on that axis instead of blocking nothing.
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
  // Outward snap: the first lattice line on each side of the inflated span is
  // blocked as well, so nothing can be laid flush against a surface edge that
  // happens to fall just inside a cell. `floor`/`ceil` can never invert, so
  // unlike the inward rule this needs no nearest-cell fallback — a span
  // thinner than one cell still yields the pair straddling it.
  return [Math.floor(min / GRID), Math.ceil(max / GRID)];
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
