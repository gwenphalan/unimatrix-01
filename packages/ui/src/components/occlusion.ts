import { GRID, type Point, cellKey } from "./grid-math.js";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/**
 * How strongly a rect repels traces.
 *
 * - `"hard"` — the rect paints a surface over the background (a panel, card,
 *   header, image). Blocks lattice cells *and* exact segments, so nothing is
 *   generated inside it and nothing routes through it.
 * - `"soft"` — the rect is *ink*: a glyph line box, an icon, a sub-grid-cell
 *   control. Blocks exact segments only, never lattice cells. Ink is far
 *   smaller than the 40px lattice pitch, so letting it block cells would
 *   quantise a 24px line of text up to a 40-80px band and a paragraph would
 *   split the canvas into disconnected flood-fill regions. Exact
 *   (`segmentCrossesBarrier`) tests are real-coordinate Liang-Barsky and have
 *   no such quantisation, which is why ink can be enforced precisely while
 *   staying invisible to `findFreeComponents` and every BFS occupancy check.
 */
export type OccluderKind = "hard" | "soft";

/**
 * A DOM-measured rect, in viewport coordinates.
 *
 * An absent `kind` means `"hard"` — the original meaning of this type before
 * the ink channel existed, so every plain `{ x0, y0, x1, y1 }` literal keeps
 * behaving exactly as it always did.
 */
export type Occluder = Rect & { kind?: OccluderKind };

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

// Clearance (px) around an ink rect. Small on purpose, and — unlike
// `OCCLUDER_BUFFER_PX` — it means exactly what it says: soft rects are never
// lattice-snapped, so the caveat above about a px buffer being unable to
// control clearance at a 40px pitch does not apply to this channel. 4px keeps
// a trace from grazing a glyph's antialiased edge without carving a visible
// moat around every word.
export const SOFT_OCCLUDER_BUFFER_PX = 4;

// `<T extends Rect>` with a spread, not a fresh 4-key literal: these run over
// tagged `Occluder`s, and rebuilding the object from named fields would
// silently drop `kind`, quietly demoting every ink rect to hard on the first
// `translateRect` in `CircuitField`'s barrier memo.
export function inflateRect<T extends Rect>(rect: T, buffer: number): T {
  return {
    ...rect,
    x0: rect.x0 - buffer,
    y0: rect.y0 - buffer,
    x1: rect.x1 + buffer,
    y1: rect.y1 + buffer,
  };
}

export function translateRect<T extends Rect>(rect: T, dx: number, dy: number): T {
  return { ...rect, x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
}

/**
 * Clamps a rect to the viewport box, returning `null` when the clamp leaves no
 * area (the element is entirely off-screen).
 *
 * This is the bound on a taller-than-viewport surface. A 6000px article rect
 * would otherwise drive `buildBarrierField`'s cell loop through 150 lattice
 * rows every pass, and the rows outside the viewport can never matter:
 * `findFreeComponents` starts at cell 1 and generation never emits a vertex
 * outside the canvas. Behaviour-neutral for routing, cheap for the cell loop.
 */
export function clampRectToViewport<T extends Rect>(
  rect: T,
  width: number,
  height: number,
): T | null {
  const x0 = Math.max(rect.x0, 0);
  const y0 = Math.max(rect.y0, 0);
  const x1 = Math.min(rect.x1, width);
  const y1 = Math.min(rect.y1, height);

  if (x1 <= x0 || y1 <= y0) return null;

  return { ...rect, x0, y0, x1, y1 };
}

export type BarrierField = {
  /** Buffer-inflated **hard** rects, for exact (non-lattice-snapped) segment tests. */
  readonly buffered: readonly Rect[];
  /**
   * Lattice cells blocked by an inflated **hard** rect — the cheap point/BFS
   * test. Ink deliberately never lands here; see `OccluderKind`.
   */
  readonly cells: ReadonlySet<string>;
  /** Buffer-inflated **soft** (ink) rects. Exact segment/point tests only. */
  readonly soft: readonly Rect[];
  /**
   * Lattice cells touched by a soft rect. **Advisory only** — a routing
   * *preference* input for the corridor-BFS tiers in `attachRoute` and
   * `buildRoute`, which try to avoid ink first and fall back to ignoring it.
   * Never read by `findFreeComponents`, `isCellBlocked`, or `allocateSlots`.
   * Precomputed here rather than derived per call because those BFS tiers run
   * once per trace.
   */
  readonly softCells: ReadonlySet<string>;
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
 * Lattice points strictly *inside* the span — the inverse of `axisRange`'s
 * outward snap. Used for the soft channel only.
 *
 * Outward snapping exists to guarantee hard-barrier clearance, and it costs a
 * cell on each side to do it. Ink needs no clearance guarantee — the exact
 * `segmentCrossesBarrier` test is the enforcement, and `softCells` is only an
 * advisory "this lattice point sits on a glyph" hint for corridor BFS. Snapping
 * it outward would quantise a 24px line of text up into three 40px lattice rows
 * and make every ink-avoiding corridor unroutable, which collapses the whole
 * tiered ladder onto its ink-blind fallback. Verified: with outward snap, the
 * scattered-ink scenario produced 28 ink violations because tier 2 never
 * succeeded. Returns an empty range when no lattice point falls inside, which
 * is correct here — nothing to avoid at lattice resolution.
 */
function innerAxisRange(min: number, max: number): [number, number] {
  return [Math.ceil(min / GRID), Math.floor(max / GRID)];
}

function blockedCells(
  rects: readonly Rect[],
  range: (min: number, max: number) => [number, number],
): Set<string> {
  const cells = new Set<string>();

  rects.forEach((rect) => {
    const [cxMin, cxMax] = range(rect.x0, rect.x1);
    const [cyMin, cyMax] = range(rect.y0, rect.y1);

    for (let cx = cxMin; cx <= cxMax; cx += 1) {
      for (let cy = cyMin; cy <= cyMax; cy += 1) {
        cells.add(`${cx},${cy}`);
      }
    }
  });

  return cells;
}

/**
 * Builds the barrier field for the current occluder set, split by
 * `OccluderKind`. Hard rects inflate by `buffer` into `buffered`/`cells` —
 * `buffered` is the source of truth for exact segment tests and the debug
 * overlay, `cells` is the cheap point/BFS-occupancy test derived from it. Soft
 * rects inflate by `softBuffer` into `soft`/`softCells` instead.
 *
 * `buffer` applies to the hard channel only, so every existing call passing an
 * explicit buffer with untagged rects produces byte-identical output to before
 * the ink channel existed.
 */
export function buildBarrierField(
  occluders: readonly Occluder[],
  buffer: number = OCCLUDER_BUFFER_PX,
  softBuffer: number = SOFT_OCCLUDER_BUFFER_PX,
): BarrierField {
  const buffered: Rect[] = [];
  const soft: Rect[] = [];

  occluders.forEach((rect) => {
    if (rect.kind === "soft") soft.push(inflateRect(rect, softBuffer));
    else buffered.push(inflateRect(rect, buffer));
  });

  return {
    buffered,
    cells: blockedCells(buffered, axisRange),
    soft,
    softCells: blockedCells(soft, innerAxisRange),
  };
}

/**
 * **Hard channel only.** A soft rect never blocks a cell — `findFreeComponents`'
 * flood fill and every BFS occupancy check must stay open across ink, or a
 * paragraph would split the canvas into disconnected regions and starve whole
 * trees for the sake of a line of text. Use `pointInSoftBarrier` for the
 * ink-aware point test, or `segmentCrossesBarrier` for the union test.
 */
export function isCellBlocked(field: BarrierField, point: Point): boolean {
  return field.cells.has(cellKey(point));
}

/**
 * Exact point-in-ink test, for rejecting a pad/via that would land on a glyph.
 * A zero-length segment against the soft rects: `segmentIntersectsRect` is
 * already documented as correct for that degenerate case, so this needs no
 * second geometry path.
 */
export function pointInSoftBarrier(field: BarrierField, point: Point): boolean {
  return field.soft.some((rect) => segmentIntersectsRect(point, point, rect));
}

/**
 * Exact (non-lattice-snapped) segment-vs-barrier test via Liang-Barsky
 * clipping against each inflated rect — the enforcement primitive for "a
 * trace must not enter the buffered region," independent of the coarser
 * per-cell blocking used for pad placement and BFS occupancy. Also correct
 * for a zero-length segment (a point test) and for a rect thinner than one
 * grid cell, neither of which the cell-based test alone can guarantee.
 *
 * Tests **both** channels: hard surfaces and ink. Deliberately broader than
 * `isCellBlocked`, which stays hard-only — this exactness is what lets ink be
 * enforced at true glyph geometry despite the 40px lattice pitch.
 */
export function segmentCrossesBarrier(field: BarrierField, a: Point, b: Point): boolean {
  return (
    field.buffered.some((rect) => segmentIntersectsRect(a, b, rect)) ||
    field.soft.some((rect) => segmentIntersectsRect(a, b, rect))
  );
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
