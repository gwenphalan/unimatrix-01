import {
  GRID,
  type Point,
  type RoutePoint,
  cellKey,
  densify,
  pointAtIndex,
  recomputeCorners,
  snap,
} from "./grid-math.js";
import { type BarrierField, segmentCrossesBarrier } from "./occlusion.js";

const MS_PER_STEP = 150;
const MIN_TRAVEL_MS = 4000;
const MAX_TRAVEL_MS = 8000;

export type CellAxisEntry = { h: Set<string>; v: Set<string> };
export type CellAxisMap = Map<string, CellAxisEntry>;
export type TraceBody = { id: string; points: Point[] };

/**
 * Rasterizes every currently-visible trace body into grid cells tagged with
 * which trace(s) touch them on which axis — the shared basis for both
 * `findIntersections` (perpendicular crossings) and `isColinearWithOther`
 * (suppressing a tip via where it'd sit in the middle of what reads as one
 * continuous straight line). O(total visible points); safe every frame.
 */
export function buildCellAxisMap(bodies: TraceBody[]): CellAxisMap {
  const cells: CellAxisMap = new Map();

  bodies.forEach(({ id, points }) => {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1] as Point;
      const point = points[i] as Point;
      const axis: "h" | "v" = prev.y === point.y ? "h" : "v";

      [prev, point].forEach((p) => {
        const key = cellKey(p);
        const entry = cells.get(key) ?? { h: new Set<string>(), v: new Set<string>() };
        entry[axis].add(id);
        cells.set(key, entry);
      });
    }
  });

  return cells;
}

/**
 * Finds every grid cell where a horizontal segment from one trace and a
 * vertical segment from a *different* trace both land — a real perpendicular
 * crossing, wherever it falls along either trace (not just at a trace's own
 * bends/ends).
 */
export function findIntersections(cells: CellAxisMap): Point[] {
  const intersections: Point[] = [];

  cells.forEach((entry, key) => {
    if (entry.h.size === 0 || entry.v.size === 0) return;
    if (![...entry.h].some((hId) => [...entry.v].some((vId) => vId !== hId))) return;

    const [cx, cy] = key.split(",").map(Number);
    intersections.push({ x: (cx as number) * GRID, y: (cy as number) * GRID });
  });

  return intersections;
}

/**
 * True if some *other* trace also touches `point`'s cell along the same
 * axis as `id`'s own segment there — two lines meeting or terminating
 * parallel to each other read as one continuous straight line, so the
 * caller should suppress `id`'s own tip via in that case rather than drop a
 * dot in the middle of what looks like an uninterrupted run.
 */
export function isColinearWithOther(
  cells: CellAxisMap,
  id: string,
  point: Point,
  axis: "h" | "v",
): boolean {
  const entry = cells.get(cellKey(point));
  if (!entry) return false;

  return [...entry[axis]].some((otherId) => otherId !== id);
}

/**
 * L-shaped path (horizontal leg, then vertical leg) between two points via
 * a given elbow, exclusive of both endpoints — the corridor a trace
 * "crawls" through to relocate without ever leaving the lattice. `from`
 * isn't always grid-snapped here: an interrupted transition hands in
 * whatever fractional point the trace's head was interpolated to
 * mid-crawl. Stepping each leg by a fixed GRID increment would then
 * overshoot or undershoot the elbow/target and leave a residual, genuinely
 * diagonal seam — so this reuses `densify`'s proportional (arc-fraction)
 * stepping instead, which always lands exactly on the leg's endpoint
 * regardless of whether the delta is a clean multiple of GRID, while still
 * moving purely one axis at a time per leg.
 */
export function connectorViaElbow(from: Point, to: Point, elbow: Point): RoutePoint[] {
  return densify([from, elbow, to]).slice(1, -1);
}

export function cellOf(point: Point): { cx: number; cy: number } {
  return { cx: Math.round(point.x / GRID), cy: Math.round(point.y / GRID) };
}

/**
 * Grid-only BFS corridor from `fromCell` to `toCell` that avoids `occupied`
 * cells — the fallback for when neither L-shaped elbow can reach the target
 * without crossing the trace's own body (e.g. the target's own first
 * segment heads back toward the direction the connector arrives from, so no
 * single-bend path avoids a local retrace). Search is bounded to the
 * trace's own footprint plus a margin, so it stays cheap even though it's a
 * real graph search rather than a fixed shape.
 */
export function bfsConnectorCells(
  fromCell: { cx: number; cy: number },
  toCell: { cx: number; cy: number },
  occupied: Set<string>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Point[] | null {
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const targetKey = key(toCell.cx, toCell.cy);

  if (key(fromCell.cx, fromCell.cy) === targetKey) return [];

  const visited = new Set([key(fromCell.cx, fromCell.cy)]);
  const cameFrom = new Map<string, { cx: number; cy: number }>();
  const queue: { cx: number; cy: number }[] = [fromCell];
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  let cursor = 0;
  let reached = false;

  while (cursor < queue.length) {
    const current = queue[cursor] as { cx: number; cy: number };
    cursor += 1;

    if (key(current.cx, current.cy) === targetKey) {
      reached = true;
      break;
    }

    for (const direction of directions) {
      const next = { cx: current.cx + direction.dx, cy: current.cy + direction.dy };
      const nextKey = key(next.cx, next.cy);

      if (visited.has(nextKey)) continue;
      if (
        next.cx < bounds.minX ||
        next.cx > bounds.maxX ||
        next.cy < bounds.minY ||
        next.cy > bounds.maxY
      )
        continue;
      if (occupied.has(nextKey) && nextKey !== targetKey) continue;

      visited.add(nextKey);
      cameFrom.set(nextKey, current);
      queue.push(next);
    }
  }

  if (!reached) return null;

  const cells: { cx: number; cy: number }[] = [toCell];
  let step = toCell;

  while (key(step.cx, step.cy) !== key(fromCell.cx, fromCell.cy)) {
    const prev = cameFrom.get(key(step.cx, step.cy));
    if (!prev) return null;
    cells.push(prev);
    step = prev;
  }

  cells.reverse();

  return cells.map((cell) => ({ x: cell.cx * GRID, y: cell.cy * GRID }));
}

function countRouteCollisions(points: Point[]): number {
  const seen = new Set<string>();
  let collisions = 0;

  points.forEach((point) => {
    const key = cellKey(point);
    if (seen.has(key)) collisions += 1;
    seen.add(key);
  });

  return collisions;
}

/**
 * Builds the full O+connector+N route for a trace, picking whichever of the
 * two possible L-shaped elbows keeps the whole route (not just the
 * connector) clear of the trace's own body — a snake's neck shouldn't cross
 * back over its own resting head or tail. A single bend can't always avoid
 * this (e.g. the target's own first segment heads right back toward the
 * connector's approach direction), so if both elbows still leave the full
 * route colliding with itself, this falls back to a bounded BFS corridor
 * that actively routes around the trace's own occupied cells.
 *
 * `fromEnd` isn't always grid-exact: interrupting one crawl to retarget
 * another hands in whatever fractional tail/head `sliceWindow` had
 * interpolated to mid-motion. Snapping `fromEnd` itself would jump the
 * visible tip — instead the fractional remainder is absorbed into a short
 * `leadIn` stub from the true current position onto the nearest grid line
 * (at most half a cell, rendered as part of the same continuous motion),
 * and the rest of the connector is built from that now grid-exact point —
 * smooth at the retarget instant, grid-exact for everything after it.
 *
 * `barriers`, when passed, makes every candidate — both elbows and the BFS
 * corridor fallback — a hard reject against buffered occluder geometry, not
 * just a collision-count tiebreak: a candidate that clips a barrier is
 * disqualified outright rather than merely disfavored. Barrier-blocked
 * cells are excluded from the BFS search except cells already present in
 * `from`'s own footprint — a trace an occluder appeared on top of can still
 * crawl *out* of the barrier it's standing in, but nothing can crawl *in*.
 * Optional (not required) so existing non-barrier-aware callers/tests keep
 * compiling; omitting it reproduces the pre-barrier collision-only
 * behavior exactly.
 *
 * Barriers come in two kinds and the fallback ladder treats them differently:
 * an elbow or corridor is tried first against hard ∪ ink, then — if that
 * fails — against hard alone. So the invariant is that ink never causes a
 * hard-barrier violation and never causes a console warning; it only ever
 * costs a route its ink clearance.
 */
export function buildRoute(
  from: RoutePoint[],
  to: RoutePoint[],
  barriers?: BarrierField,
): RoutePoint[] {
  const fromEnd = from[from.length - 1] as RoutePoint;
  const toStart = to[0] as RoutePoint;

  const snappedFromEnd: RoutePoint = {
    x: snap(fromEnd.x),
    y: snap(fromEnd.y),
    corner: fromEnd.corner,
  };
  const leadIn: RoutePoint[] =
    fromEnd.x !== snappedFromEnd.x || fromEnd.y !== snappedFromEnd.y ? [snappedFromEnd] : [];

  const occupied = new Set<string>();
  from.forEach((point) => occupied.add(cellKey(point)));
  to.forEach((point) => occupied.add(cellKey(point)));

  const fullRouteCollisions = (connector: RoutePoint[]) =>
    countRouteCollisions([...from, ...leadIn, ...connector, ...to]);

  // The same field with the ink channel emptied. Every tier below that is
  // allowed to clip ink but never a surface tests against this instead of
  // `barriers`, which is what keeps the two invariants separable: ink can
  // degrade a route's aesthetics, only a hard surface can make it *wrong*.
  const hardOnly: BarrierField | undefined = barriers
    ? { buffered: barriers.buffered, cells: barriers.cells, soft: [], softCells: new Set() }
    : undefined;

  const crossesBarrier = (connector: RoutePoint[], field = barriers) => {
    if (!field) return false;
    const full = [...from, ...leadIn, ...connector, ...to];
    for (let i = 1; i < full.length; i += 1) {
      if (segmentCrossesBarrier(field, full[i - 1] as Point, full[i] as Point)) return true;
    }
    return false;
  };

  const elbows = [
    connectorViaElbow(snappedFromEnd, toStart, { x: toStart.x, y: snappedFromEnd.y }),
    connectorViaElbow(snappedFromEnd, toStart, { x: snappedFromEnd.x, y: toStart.y }),
  ];
  const elbowCandidates = elbows.filter((candidate) => !crossesBarrier(candidate));

  let best: RoutePoint[] | null = elbowCandidates[0] ?? null;
  let bestCollisions = Infinity;

  for (const candidate of elbowCandidates) {
    const collisions = fullRouteCollisions(candidate);

    if (collisions < bestCollisions) {
      best = candidate;
      bestCollisions = collisions;
    }

    if (bestCollisions === 0) break;
  }

  if (best === null || bestCollisions > 0) {
    const fromCell = cellOf(snappedFromEnd);
    const toCell = cellOf(toStart);
    // Cells of slack outside the endpoints' bounding box the corridor may use
    // to detour. 12, not the 6 it started at: measured on `apps/web` `/`, 6
    // left 12 `buildRoute` canary warnings per load and 12 left 10 — and 10 is
    // also exactly what the same page produces with the ink channel disabled
    // outright, so at this margin ink costs zero warnings. The residual 10 are
    // surface-blocked endpoint pairs that predate this change: the same page on
    // `main`, same viewport, warns 39 times per load. Only the fallback path
    // pays for the wider window.
    const margin = 12;
    const bounds = {
      minX: Math.min(fromCell.cx, toCell.cx) - margin,
      maxX: Math.max(fromCell.cx, toCell.cx) + margin,
      minY: Math.min(fromCell.cy, toCell.cy) - margin,
      maxY: Math.max(fromCell.cy, toCell.cy) + margin,
    };
    // Two attempts, ink-avoiding first. `avoidInk` additionally treats every
    // lattice cell sitting on a glyph as occupied and re-checks the result
    // against the exact hard-union-soft test, since `softCells` only
    // approximates geometry finer than the lattice. Its failure falls through
    // to the ink-blind BFS — this function's behaviour before ink existed,
    // still guaranteed hard-clear, and accepted **silently**: ink can make a
    // corridor genuinely impossible, and the canary below must keep meaning
    // "no route at all was reachable".
    const corridorCandidate = (avoidInk: boolean): RoutePoint[] | null => {
      const corridorOccupied = new Set(occupied);

      if (barriers) {
        // Escape rule: a cell already inside `from`'s own footprint stays
        // passable even if it's now barrier-blocked (an occluder can appear
        // on top of a trace that's already there), but no barrier-blocked
        // cell outside that footprint is ever entered. Ink gets the same
        // treatment — text can appear over an existing trace exactly as a
        // panel can.
        const fromFootprint = new Set(from.map((point) => cellKey(point)));
        barriers.cells.forEach((key) => {
          if (!fromFootprint.has(key)) corridorOccupied.add(key);
        });
        if (avoidInk) {
          barriers.softCells.forEach((key) => {
            if (!fromFootprint.has(key)) corridorOccupied.add(key);
          });
        }
      }

      // After the barrier unions, not before: either endpoint may itself sit
      // on a barrier, and re-admitting it is what lets a route escape.
      corridorOccupied.delete(cellKey(snappedFromEnd));
      corridorOccupied.delete(cellKey(toStart));

      const corridor = bfsConnectorCells(fromCell, toCell, corridorOccupied, bounds);
      if (!corridor) return null;

      const candidate = densify([snappedFromEnd, ...corridor, toStart]).slice(1, -1);
      if (avoidInk && crossesBarrier(candidate)) return null;

      return candidate;
    };

    const candidate = corridorCandidate(true) ?? corridorCandidate(false);

    if (candidate) {
      const collisions = fullRouteCollisions(candidate);

      // No write-back to `bestCollisions`: this branch runs once, not in a
      // loop, and nothing below reads the count again — only `best`.
      if (best === null || collisions < bestCollisions) {
        best = candidate;
      }
    }
  }

  if (best === null && hardOnly) {
    // Ink-blind elbow retry, and the tier that stops this function from
    // warning on an ordinary text-dense page. Measured on `apps/web` `/`
    // before it existed: ~100 warnings per load. Both elbows commonly clip a
    // glyph, and the BFS below them searches only a ±6-cell window around the
    // endpoints, so a wide panel between them defeats it — the pair fails
    // together, routinely, on nothing worse than a paragraph in the way.
    // Accepted silently: guaranteed hard-clear, may clip ink, which is the
    // documented ink trade-off rather than a defect worth a console line.
    best = elbows.find((candidate) => !crossesBarrier(candidate, hardOnly)) ?? null;
  }

  if (best === null) {
    // Every candidate crossed a *hard* barrier and no BFS corridor was found —
    // a canary, not an expected path. Fall back to the first raw elbow
    // (unfiltered) so a route is always produced; it may visually clip a
    // barrier in this pathological case.
    console.warn(
      "[CircuitField] buildRoute found no barrier-clear connector — falling back to a direct elbow",
      {
        from: snappedFromEnd,
        to: toStart,
      },
    );
    best = connectorViaElbow(snappedFromEnd, toStart, { x: toStart.x, y: snappedFromEnd.y });
  }

  return recomputeCorners([...from, ...leadIn, ...best, ...to]);
}

/**
 * The visible body for a given [tailIndex, headIndex] window along `route`:
 * an interpolated tail point, every whole lattice point in between, and an
 * interpolated head point. Because `route` only ever moves one grid step at
 * a time, any such window is itself a contiguous orthogonal path — this is
 * what keeps every mid-transition frame snake-like (no diagonal cuts).
 * Corner flags are preserved on interior points (and the exact tail/head
 * when they land precisely on a route vertex) so an interrupted transition
 * can hand this window straight back in as the next transition's `from`
 * body, vias and all.
 */
export function sliceWindow(
  route: RoutePoint[],
  tailIndex: number,
  headIndex: number,
): RoutePoint[] {
  const points: RoutePoint[] = [pointAtIndex(route, tailIndex)];
  const startInt = Math.ceil(tailIndex + 1e-6);
  const endInt = Math.floor(headIndex - 1e-6);

  for (let i = startInt; i <= endInt; i += 1) {
    const point = route[i];
    if (point) points.push({ x: point.x, y: point.y, corner: point.corner });
  }

  points.push(pointAtIndex(route, headIndex));
  return points;
}

export function travelDuration(steps: number): number {
  return Math.max(MIN_TRAVEL_MS, Math.min(MAX_TRAVEL_MS, steps * MS_PER_STEP));
}
