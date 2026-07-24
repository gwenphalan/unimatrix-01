import * as React from "react";

const GRID = 40;
const RESIZE_SETTLE_MS = 200;
const MS_PER_STEP = 150;
const MIN_TRAVEL_MS = 4000;
const MAX_TRAVEL_MS = 8000;

type Point = { x: number; y: number };
type RoutePoint = Point & { corner: boolean };
type Trace = { id: string; points: Point[]; length: number };
type KeepOut = { x0: number; y0: number; x1: number; y1: number };
type ViaItem = {
  key: string;
  traceIndex: number;
  index: number;
  x: number;
  y: number;
  boot: boolean;
  delay: number;
  initiallyVisible: boolean;
};

function mulberry32(seed: number): () => number {
  let state = seed | 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function cellKey(point: Point): string {
  return `${Math.round(point.x / GRID)},${Math.round(point.y / GRID)}`;
}

type CellAxisMap = Map<string, { h: Set<string>; v: Set<string> }>;

/**
 * Rasterizes every currently-visible trace body into grid cells tagged with
 * which trace(s) touch them on which axis — the shared basis for both
 * `findIntersections` (perpendicular crossings) and `isColinearWithOther`
 * (suppressing a tip via where it'd sit in the middle of what reads as one
 * continuous straight line). O(total visible points); safe every frame.
 */
function buildCellAxisMap(bodies: { id: string; points: Point[] }[]): CellAxisMap {
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
function findIntersections(cells: CellAxisMap): Point[] {
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
function isColinearWithOther(cells: CellAxisMap, id: string, point: Point, axis: "h" | "v"): boolean {
  const entry = cells.get(cellKey(point));
  if (!entry) return false;

  return [...entry[axis]].some((otherId) => otherId !== id);
}

function pathData(points: Point[]): string {
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

function polylineLength(points: Point[]): number {
  let total = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Point;
    const point = points[i] as Point;
    total += Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y);
  }

  return total;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const result = items.slice();

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }

  return result;
}

function cellsCoveringArea(width: number, height: number, keepOut: KeepOut, count: number): KeepOut[] {
  const keepOutArea = Math.max(0, keepOut.x1 - keepOut.x0) * Math.max(0, keepOut.y1 - keepOut.y0);
  const availableArea = Math.max(GRID * GRID, width * height - keepOutArea);
  const cellSize = Math.max(GRID * 3, Math.sqrt(availableArea / Math.max(1, count)));
  const cols = Math.max(1, Math.round(width / cellSize));
  const rows = Math.max(1, Math.round(height / cellSize));
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cells: KeepOut[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell: KeepOut = {
        x0: col * cellWidth,
        y0: row * cellHeight,
        x1: (col + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const fullyInsideKeepOut =
        cell.x0 >= keepOut.x0 && cell.x1 <= keepOut.x1 && cell.y0 >= keepOut.y0 && cell.y1 <= keepOut.y1;

      if (!fullyInsideKeepOut) {
        cells.push(cell);
      }
    }
  }

  return cells;
}

/**
 * One start point per coarse cell (jittered, grid-snapped) instead of pure
 * rejection sampling — spreads traces across the available canvas instead
 * of letting them cluster unevenly.
 */
function buildStartPoints(
  width: number,
  height: number,
  keepOut: KeepOut,
  count: number,
  rand: () => number,
): Point[] {
  const inKeepOut = (x: number, y: number) =>
    x >= keepOut.x0 && x <= keepOut.x1 && y >= keepOut.y0 && y <= keepOut.y1;
  // Clamping to a non-multiple-of-GRID margin (the old `GRID / 2`) can land a
  // point half a cell off the lattice; everything downstream (buildRoute,
  // cellOf, the BFS corridor) assumes exact GRID multiples, so an off-grid
  // point produces a genuinely diagonal connector segment. Snap after
  // clamping so a clamped point is always back on the grid.
  const clampPoint = (point: Point): Point => ({
    x: snap(Math.max(GRID, Math.min(width - GRID, point.x))),
    y: snap(Math.max(GRID, Math.min(height - GRID, point.y))),
  });
  const jitterInCell = (cell: KeepOut): Point =>
    clampPoint({
      x: snap(cell.x0 + rand() * (cell.x1 - cell.x0)),
      y: snap(cell.y0 + rand() * (cell.y1 - cell.y0)),
    });

  const cells = shuffled(cellsCoveringArea(width, height, keepOut, count), rand);
  const points: Point[] = [];

  for (let i = 0; i < count; i += 1) {
    const cell = cells.length > 0 ? (cells[i % cells.length] as KeepOut) : { x0: 0, y0: 0, x1: width, y1: height };
    let point = jitterInCell(cell);
    let attempt = 0;

    while (inKeepOut(point.x, point.y) && attempt < 8) {
      point = jitterInCell(cell);
      attempt += 1;
    }

    if (inKeepOut(point.x, point.y)) {
      point = clampPoint({ x: snap(keepOut.x0 - GRID), y: point.y });
    }

    points.push(point);
  }

  return points;
}

function buildTraceFromStart(
  id: string,
  start: Point,
  width: number,
  height: number,
  keepOut: KeepOut,
  rand: () => number,
  graph: GridGraph,
  forcedFirstHorizontal?: boolean,
): Trace {
  const inKeepOut = (x: number, y: number) =>
    x >= keepOut.x0 && x <= keepOut.x1 && y >= keepOut.y0 && y <= keepOut.y1;
  // Same off-grid clamp hazard as buildStartPoints' clampPoint above — snap
  // after clamping so a clamped point stays on the GRID lattice.
  const clamp = (point: Point): Point => ({
    x: snap(Math.max(GRID, Math.min(width - GRID, point.x))),
    y: snap(Math.max(GRID, Math.min(height - GRID, point.y))),
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const points: Point[] = [start];
    const segments = 2 + Math.floor(rand() * 4);

    for (let s = 0; s < segments; s += 1) {
      const horizontal = s === 0 && forcedFirstHorizontal !== undefined ? forcedFirstHorizontal : rand() < 0.5;
      const magnitude = (40 + Math.floor(rand() * 6) * 20) * (rand() < 0.5 ? -1 : 1);
      const prev = points[points.length - 1] as Point;
      let next: Point = horizontal
        ? { x: snap(prev.x + magnitude), y: prev.y }
        : { x: prev.x, y: snap(prev.y + magnitude) };

      next = clamp(next);

      if (inKeepOut(next.x, next.y)) {
        next = prev;
      }

      points.push(next);
    }

    const moved = points.some((point) => point.x !== start.x || point.y !== start.y);
    const trial = moved ? graph.tryAdd(points) : null;

    if (trial) {
      graph.adopt(trial);
      return { id, points, length: polylineLength(points) };
    }
  }

  const fallbackDirections: Point[] = [
    { x: GRID, y: 0 },
    { x: -GRID, y: 0 },
    { x: 0, y: GRID },
    { x: 0, y: -GRID },
  ];

  for (const direction of fallbackDirections) {
    const next = clamp({ x: start.x + direction.x, y: start.y + direction.y });
    const moved = next.x !== start.x || next.y !== start.y;
    const trial = !inKeepOut(next.x, next.y) && moved ? graph.tryAdd([start, next]) : null;

    if (trial) {
      graph.adopt(trial);
      return { id, points: [start, next], length: polylineLength([start, next]) };
    }
  }

  return { id, points: [start, { ...start }], length: 0 };
}

/**
 * Deterministic procedural PCB-trace layout: short orthogonal, grid-snapped
 * paths seeded from route + viewport, avoiding a generous central keep-out
 * so traces stay clear of typical unwrapped hero/intro text. Always returns
 * exactly `count` traces so callers can rely on stable 1:1 identity across
 * regenerations.
 *
 * A shared `GridGraph` is threaded through every `buildTraceFromStart` call
 * so no new edge ever closes a loop — not a single trace looping back on
 * itself, not two traces re-tracing the same straight stretch, and not a
 * cycle that only exists in the combined shape of several traces (e.g. a
 * rectangle formed by two parallel lines and two perpendicular crossings).
 * Crossing another trace, forking from it, or sharing an endpoint is still
 * fine — those attach to its component without closing a second path (see
 * `GridGraph.tryAdd`).
 *
 * ~1 in 4 slots (after the first) forks off an already-built sibling trace
 * instead of getting its own independent start point: the fork point is a
 * random interior lattice vertex of the sibling's densified body (never its
 * own first/last point, so it reads as a true mid-trace split), and the new
 * trace's first leg is forced perpendicular to the sibling's local segment
 * direction there so it visually diverges instead of extending the parent.
 * Downstream (buildRoute, tick, corner/tip vias) treats a branch exactly
 * like any other independent trace — only start-point selection differs.
 */
function generateTraces(width: number, height: number, seed: number, keepOut: KeepOut, count: number): Trace[] {
  const rand = mulberry32(seed);
  const starts = buildStartPoints(width, height, keepOut, count, rand);
  const traces: Trace[] = [];
  const graph = new GridGraph();

  starts.forEach((start, i) => {
    if (i > 0 && rand() < 0.25) {
      const parent = traces[Math.floor(rand() * traces.length)] as Trace;
      const parentBody = densify(parent.points);

      if (parentBody.length > 2) {
        const forkIndex = 1 + Math.floor(rand() * (parentBody.length - 2));
        const forkPoint = parentBody[forkIndex] as RoutePoint;
        const prevPoint = parentBody[forkIndex - 1] as RoutePoint;
        const parentHorizontal = prevPoint.y === forkPoint.y;

        traces.push(buildTraceFromStart(`t${i}`, forkPoint, width, height, keepOut, rand, graph, !parentHorizontal));
        return;
      }
    }

    traces.push(buildTraceFromStart(`t${i}`, start, width, height, keepOut, rand, graph));
  });

  return traces;
}

/**
 * Expands a sparse, grid-snapped vertex polyline into one point per 40px
 * grid cell along it. `corner` is left `false` here — a single segment
 * can't tell whether it's a real bend without seeing its neighbors — so
 * callers finalize it with `recomputeCorners` once the body/route is
 * fully assembled.
 */
function densify(points: Point[]): RoutePoint[] {
  if (points.length === 0) return [];

  const first = points[0] as Point;
  const result: RoutePoint[] = [{ x: first.x, y: first.y, corner: false }];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Point;
    const point = points[i] as Point;
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    const steps = Math.round((Math.abs(dx) + Math.abs(dy)) / GRID);

    if (Math.abs(dx) > 0.6 && Math.abs(dy) > 0.6) {
      // Every caller is expected to pass axis-aligned segments; densify
      // silently interpolates x and y together, so a segment that varies on
      // both axes renders as a real diagonal line instead of an error.
      console.warn("[CircuitField] densify() got a non-axis-aligned segment", { prev, point });
    }

    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      result.push({ x: prev.x + dx * t, y: prev.y + dy * t, corner: false });
    }
  }

  return result;
}

/**
 * Marks the real bends in a finished lattice body/route: the first and
 * last point are always caps (a trace's own ends), interior points are
 * corners only where the incoming step direction differs from the
 * outgoing one. Segment boundaries that continue in the same direction —
 * two independently-rolled legs in `buildTraceFromStart` sharing an axis,
 * or a connector elbow degenerating onto an existing endpoint — are NOT
 * corners, so a via never lands mid-straight-run.
 */
function recomputeCorners(points: RoutePoint[]): RoutePoint[] {
  if (points.length === 0) return points;
  if (points.length === 1) {
    const only = points[0] as RoutePoint;
    return [{ x: only.x, y: only.y, corner: true }];
  }

  return points.map((point, i) => {
    if (i === 0 || i === points.length - 1) {
      return { x: point.x, y: point.y, corner: true };
    }

    const prev = points[i - 1] as RoutePoint;
    const next = points[i + 1] as RoutePoint;
    const inX = Math.sign(point.x - prev.x);
    const inY = Math.sign(point.y - prev.y);
    const outX = Math.sign(next.x - point.x);
    const outY = Math.sign(next.y - point.y);

    return { x: point.x, y: point.y, corner: inX !== outX || inY !== outY };
  });
}

/**
 * Union-find over grid lattice points (keyed by `cellKey`), used to reject
 * any new trace edge that would close a loop — whether that loop is a
 * single trace doubling back on itself, two traces re-tracing the same
 * straight stretch, or a cycle only visible in the combined shape of
 * several unrelated traces (e.g. two parallel lines joined by two
 * perpendicular crossings forms a rectangle even though no individual pair
 * of segments overlaps). Meeting another trace at a single point — a
 * crossing, a fork, or a shared endpoint — just attaches to its component
 * and is always fine; only a *second* path between two already-connected
 * points is rejected.
 */
class GridGraph {
  private parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);

    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;

    let cursor = x;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor) as string;
      this.parent.set(cursor, root);
      cursor = next;
    }

    return root;
  }

  /** Returns false (without mutating) if `x` and `y` are already connected. */
  private union(x: string, y: string): boolean {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return false;

    this.parent.set(rootX, rootY);
    return true;
  }

  clone(): GridGraph {
    const copy = new GridGraph();
    copy.parent = new Map(this.parent);
    return copy;
  }

  /** Adopts another graph's edges (used to commit a validated trial clone). */
  adopt(other: GridGraph): void {
    this.parent = other.parent;
  }

  /**
   * Tries to add every grid edge along `points` to a clone of this graph,
   * one grid step at a time. Returns the resulting clone on success (every
   * edge connected two previously-separate points) or `null` the moment any
   * edge would close a loop.
   */
  tryAdd(points: Point[]): GridGraph | null {
    const trial = this.clone();

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1] as Point;
      const point = points[i] as Point;
      const steps = Math.round((Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y)) / GRID);
      let fromKey = cellKey(prev);

      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        const toKey = cellKey({ x: prev.x + (point.x - prev.x) * t, y: prev.y + (point.y - prev.y) * t });
        if (!trial.union(fromKey, toKey)) return null;
        fromKey = toKey;
      }
    }

    return trial;
  }
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
function connectorViaElbow(from: Point, to: Point, elbow: Point): RoutePoint[] {
  return densify([from, elbow, to]).slice(1, -1);
}

function cellOf(point: Point): { cx: number; cy: number } {
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
function bfsConnectorCells(
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
      if (next.cx < bounds.minX || next.cx > bounds.maxX || next.cy < bounds.minY || next.cy > bounds.maxY) continue;
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
 */
function buildRoute(from: RoutePoint[], to: RoutePoint[]): RoutePoint[] {
  const fromEnd = from[from.length - 1] as RoutePoint;
  const toStart = to[0] as RoutePoint;

  const snappedFromEnd: RoutePoint = { x: snap(fromEnd.x), y: snap(fromEnd.y), corner: fromEnd.corner };
  const leadIn: RoutePoint[] =
    fromEnd.x !== snappedFromEnd.x || fromEnd.y !== snappedFromEnd.y ? [snappedFromEnd] : [];

  const occupied = new Set<string>();
  from.forEach((point) => occupied.add(cellKey(point)));
  to.forEach((point) => occupied.add(cellKey(point)));

  const fullRouteCollisions = (connector: RoutePoint[]) =>
    countRouteCollisions([...from, ...leadIn, ...connector, ...to]);

  const elbowCandidates = [
    connectorViaElbow(snappedFromEnd, toStart, { x: toStart.x, y: snappedFromEnd.y }),
    connectorViaElbow(snappedFromEnd, toStart, { x: snappedFromEnd.x, y: toStart.y }),
  ];

  let best = elbowCandidates[0] as RoutePoint[];
  let bestCollisions = Infinity;

  for (const candidate of elbowCandidates) {
    const collisions = fullRouteCollisions(candidate);

    if (collisions < bestCollisions) {
      best = candidate;
      bestCollisions = collisions;
    }

    if (bestCollisions === 0) break;
  }

  if (bestCollisions > 0) {
    const fromCell = cellOf(snappedFromEnd);
    const toCell = cellOf(toStart);
    const margin = 6;
    const bounds = {
      minX: Math.min(fromCell.cx, toCell.cx) - margin,
      maxX: Math.max(fromCell.cx, toCell.cx) + margin,
      minY: Math.min(fromCell.cy, toCell.cy) - margin,
      maxY: Math.max(fromCell.cy, toCell.cy) + margin,
    };
    const corridorOccupied = new Set(occupied);
    corridorOccupied.delete(cellKey(snappedFromEnd));
    corridorOccupied.delete(cellKey(toStart));

    const corridor = bfsConnectorCells(fromCell, toCell, corridorOccupied, bounds);

    if (corridor) {
      const candidate = densify([snappedFromEnd, ...corridor, toStart]).slice(1, -1);
      const collisions = fullRouteCollisions(candidate);

      if (collisions < bestCollisions) {
        best = candidate;
        bestCollisions = collisions;
      }
    }
  }

  return recomputeCorners([...from, ...leadIn, ...best, ...to]);
}

function pointAtIndex(route: RoutePoint[], index: number): RoutePoint {
  const clamped = Math.max(0, Math.min(route.length - 1, index));
  const lo = Math.floor(clamped);
  const hi = Math.min(route.length - 1, lo + 1);
  const frac = clamped - lo;
  const p0 = route[lo] as RoutePoint;
  const p1 = route[hi] as RoutePoint;

  if (frac === 0) return { x: p0.x, y: p0.y, corner: p0.corner };

  return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac, corner: false };
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
function sliceWindow(route: RoutePoint[], tailIndex: number, headIndex: number): RoutePoint[] {
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

function travelDuration(steps: number): number {
  return Math.max(MIN_TRAVEL_MS, Math.min(MAX_TRAVEL_MS, steps * MS_PER_STEP));
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function useViewportSize(): { width: number; height: number } | null {
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });

    update();

    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return size;
}

/**
 * Settles on a new size only after `delay` ms of no further changes, so a
 * window being actively dragged doesn't trigger constant trace retargeting.
 * The first size is applied immediately (no delay) so initial boot isn't
 * held up.
 */
function useDebouncedSize(
  size: { width: number; height: number } | null,
  delay: number,
): { width: number; height: number } | null {
  const [debounced, setDebounced] = React.useState<{ width: number; height: number } | null>(null);
  const hasValueRef = React.useRef(false);
  const timeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (!size) return;

    if (!hasValueRef.current) {
      hasValueRef.current = true;
      setDebounced(size);
      return;
    }

    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setDebounced(size), delay);

    return () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    };
  }, [size?.width, size?.height, delay]);

  return debounced;
}

export type CircuitFieldProps = {
  /**
   * Value that should trigger a re-seed/redraw when it changes — pass the
   * current route pathname so the layout regenerates on client-side
   * navigation within the app.
   */
  routeKey?: string;
};

/**
 * Animated, grid-aligned circuit-trace layer for `.grid-backdrop` pages.
 * Renders above the static CSS grid and below page content (fixed,
 * `z-index: -1`, so any unpositioned in-flow content still paints on top).
 *
 * A fixed number of trace "slots" is picked once from the first known
 * viewport size and kept alive for the component's whole lifetime. On the
 * very first mount, traces draw in with a staggered stroke animation (the
 * "boot" moment). On every subsequent `routeKey` change or settled resize,
 * each trace crawls — snake-style — from its old body to its new one: a
 * lattice route is built from the current body, through an L-shaped
 * connector corridor, to the target body, and a `requestAnimationFrame` loop
 * slides a fixed-arc-length window along that route each frame, writing the
 * SVG path/via attributes directly. Every frame's visible body is a
 * contiguous sub-path of an orthogonal lattice route, so it only ever moves
 * along grid lines — never diagonally — and never fully disappears; an
 * in-flight crawl retargets smoothly if interrupted by another change.
 * Skips the crawl (snaps immediately) under `prefers-reduced-motion`.
 */
export function CircuitField({ routeKey = "" }: CircuitFieldProps): React.JSX.Element | null {
  const size = useViewportSize();
  const debouncedSize = useDebouncedSize(size, RESIZE_SETTLE_MS);
  const reducedMotion = useReducedMotion();

  const reducedMotionRef = React.useRef(reducedMotion);
  React.useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const traceCountRef = React.useRef<number | null>(null);
  if (traceCountRef.current === null && size) {
    traceCountRef.current = Math.max(14, Math.round((size.width * size.height) / 55000));
  }
  const traceCount = traceCountRef.current;

  const traceIds = React.useMemo(
    () => (traceCount === null ? [] : Array.from({ length: traceCount }, (_, i) => `t${i}`)),
    [traceCount],
  );

  const pathElRefs = React.useRef(new Map<string, SVGPathElement>());
  const viaElRefs = React.useRef(new Map<string, SVGRectElement>());
  const viaItemIndexRef = React.useRef(new Map<string, ViaItem>());
  const tipElRefs = React.useRef(new Map<string, SVGRectElement>());
  const liveBodyRef = React.useRef<RoutePoint[][] | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const [viaItems, setViaItemsState] = React.useState<ViaItem[]>([]);

  const setViaItems = React.useCallback((items: ViaItem[]) => {
    viaItemIndexRef.current = new Map(items.map((item) => [item.key, item]));
    setViaItemsState(items);
  }, []);

  const pathRefCallbacks = React.useMemo(() => {
    const map = new Map<string, (el: SVGPathElement | null) => void>();

    traceIds.forEach((id) => {
      map.set(id, (el) => {
        if (el) pathElRefs.current.set(id, el);
        else pathElRefs.current.delete(id);
      });
    });

    return map;
  }, [traceIds]);

  const viaRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) viaElRefs.current.set(key, el);
      else viaElRefs.current.delete(key);
    };
  }, []);

  // A trace's own start/end are rarely real lattice corners while a crawl is
  // in flight — the visible window's tail/head are usually mid-segment
  // (`pointAtIndex` interpolation), so the corner-based via set (which only
  // ever marks real bends) never has anything to show there. These two
  // always-mounted "tip" rects per trace ride the current window's tail and
  // head every frame instead, so an end always has a node — moving with the
  // line while it crawls, landing exactly on the endpoint once it settles.
  const tipRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) tipElRefs.current.set(key, el);
      else tipElRefs.current.delete(key);
    };
  }, []);

  const setTipPosition = React.useCallback(
    (id: string, end: "tail" | "head", point: Point, visible: boolean) => {
      const el = tipElRefs.current.get(`${id}-${end}`);
      if (!el) return;
      el.setAttribute("x", String(point.x - 3));
      el.setAttribute("y", String(point.y - 3));
      el.style.opacity = visible ? "1" : "0";
    },
    [],
  );

  // Cross-trace intersection vias: a fixed pool of pre-mounted rects (sized
  // generously, well past any realistic simultaneous-crossing count) that
  // findIntersections' output is assigned into every time bodies change —
  // including every tick() frame — the same direct-ref approach as the path
  // `d` and tip positions above, so this never triggers a per-frame React
  // re-render. Unused pool slots are hidden rather than unmounted.
  const intersectionElRefs = React.useRef(new Map<string, SVGRectElement>());
  const intersectionPoolSizeRef = React.useRef(0);

  const intersectionSlotIds = React.useMemo(
    () => (traceCount === null ? [] : Array.from({ length: traceCount * 3 }, (_, i) => `x${i}`)),
    [traceCount],
  );

  React.useEffect(() => {
    intersectionPoolSizeRef.current = intersectionSlotIds.length;
  }, [intersectionSlotIds]);

  const intersectionRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) intersectionElRefs.current.set(key, el);
      else intersectionElRefs.current.delete(key);
    };
  }, []);

  const applyIntersections = React.useCallback((points: Point[]) => {
    const poolSize = intersectionPoolSizeRef.current;

    points.forEach((point, i) => {
      if (i >= poolSize) return;
      const el = intersectionElRefs.current.get(`x${i}`);
      if (!el) return;
      el.setAttribute("x", String(point.x - 3));
      el.setAttribute("y", String(point.y - 3));
      el.style.opacity = "1";
    });

    for (let i = points.length; i < poolSize; i += 1) {
      const el = intersectionElRefs.current.get(`x${i}`);
      if (el) el.style.opacity = "0";
    }
  }, []);

  // `tick()` writes `el.style.opacity` directly on existing via rects every
  // frame, bypassing React. When a key survives from one `setViaItems` call
  // to the next with the same computed `initiallyVisible` value (e.g. a
  // corner within the untouched `from` portion of a route), React's own
  // prop diffing sees no change between renders and skips reapplying the
  // style — leaving the DOM stuck at whatever opacity `tick()` last wrote,
  // even though the settled render means "visible". Force it explicitly so
  // rendered opacity never depends on React's diff bailing out.
  React.useLayoutEffect(() => {
    viaItems.forEach((item) => {
      if (item.boot) return;
      const el = viaElRefs.current.get(item.key);
      if (el) el.style.opacity = item.initiallyVisible ? "1" : "0";
    });
  }, [viaItems]);

  const targetTraces = React.useMemo(() => {
    if (!debouncedSize || traceCount === null) return null;

    const seed = hashString(`${routeKey}:${debouncedSize.width}x${debouncedSize.height}`);
    const keepOut: KeepOut = {
      x0: debouncedSize.width * 0.14,
      y0: debouncedSize.height * 0.1,
      x1: debouncedSize.width * 0.86,
      y1: debouncedSize.height * 0.78,
    };

    return generateTraces(debouncedSize.width, debouncedSize.height, seed, keepOut, traceCount);
  }, [routeKey, debouncedSize?.width, debouncedSize?.height, traceCount]);

  React.useLayoutEffect(() => {
    if (!targetTraces) return;

    if (liveBodyRef.current === null) {
      const bodies = targetTraces.map((trace) => recomputeCorners(densify(trace.points)));
      liveBodyRef.current = bodies;

      const cellAxisMap = buildCellAxisMap(
        targetTraces.map((trace, i) => ({ id: trace.id, points: bodies[i] as RoutePoint[] })),
      );

      const items: ViaItem[] = [];
      targetTraces.forEach((trace, i) => {
        const body = bodies[i] as RoutePoint[];
        body.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === body.length - 1) return;
          items.push({
            key: `${trace.id}-${idx}`,
            traceIndex: i,
            index: idx,
            x: point.x,
            y: point.y,
            boot: !reducedMotionRef.current,
            delay: Math.min(trace.length + targetTraces.length * 5, 900),
            initiallyVisible: true,
          });
        });

        const first = body[0];
        const second = body[1];
        const last = body[body.length - 1];
        const beforeLast = body[body.length - 2];
        if (first && second) {
          const axis: "h" | "v" = first.y === second.y ? "h" : "v";
          setTipPosition(trace.id, "tail", first, !isColinearWithOther(cellAxisMap, trace.id, first, axis));
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(trace.id, "head", last, !isColinearWithOther(cellAxisMap, trace.id, last, axis));
        }
      });
      setViaItems(items);
      applyIntersections(findIntersections(cellAxisMap));

      targetTraces.forEach((trace, i) => {
        const el = pathElRefs.current.get(trace.id);
        const body = bodies[i];
        if (!el || !body) return;

        el.setAttribute("d", pathData(body));

        if (reducedMotionRef.current) {
          el.style.strokeDasharray = "none";
          el.style.strokeDashoffset = "0";
        } else {
          const dashLength = trace.length || 1;
          el.classList.add("circuit-field-trace");
          el.style.strokeDasharray = String(dashLength);
          el.style.strokeDashoffset = String(dashLength);
          el.style.animationDelay = `${Math.min(i * 30, 500)}ms`;
        }
      });

      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    pathElRefs.current.forEach((el) => {
      el.classList.remove("circuit-field-trace");
      el.style.strokeDasharray = "none";
      el.style.strokeDashoffset = "0";
    });

    const fromBodies = liveBodyRef.current;
    const transitions = targetTraces.map((trace, i) => {
      const from = fromBodies[i] ?? recomputeCorners(densify(trace.points));
      const to = recomputeCorners(densify(trace.points));
      const route = buildRoute(from, to);

      return { id: trace.id, route, lenO: from.length, lenN: to.length, toBody: to };
    });

    if (reducedMotionRef.current) {
      liveBodyRef.current = transitions.map((transition) => transition.toBody);

      const cellAxisMap = buildCellAxisMap(
        transitions.map((transition) => ({ id: transition.id, points: transition.toBody })),
      );

      const items: ViaItem[] = [];
      transitions.forEach((transition, i) => {
        const el = pathElRefs.current.get(transition.id);
        if (el) el.setAttribute("d", pathData(transition.toBody));

        transition.toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === transition.toBody.length - 1) return;
          items.push({
            key: `${transition.id}-${idx}`,
            traceIndex: i,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: true,
          });
        });

        const first = transition.toBody[0];
        const second = transition.toBody[1];
        const last = transition.toBody[transition.toBody.length - 1];
        const beforeLast = transition.toBody[transition.toBody.length - 2];
        if (first && second) {
          const axis: "h" | "v" = first.y === second.y ? "h" : "v";
          setTipPosition(transition.id, "tail", first, !isColinearWithOther(cellAxisMap, transition.id, first, axis));
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(transition.id, "head", last, !isColinearWithOther(cellAxisMap, transition.id, last, axis));
        }
      });
      setViaItems(items);
      applyIntersections(findIntersections(cellAxisMap));

      return;
    }

    const initialCellAxisMap = buildCellAxisMap(
      transitions.map((transition) => ({ id: transition.id, points: transition.route.slice(0, transition.lenO) })),
    );

    const items: ViaItem[] = [];
    transitions.forEach((transition, i) => {
      transition.route.forEach((point, idx) => {
        if (!point.corner || idx === 0 || idx === transition.route.length - 1) return;
        items.push({
          key: `${transition.id}-${idx}`,
          traceIndex: i,
          index: idx,
          x: point.x,
          y: point.y,
          boot: false,
          delay: 0,
          initiallyVisible: idx < transition.lenO,
        });
      });

      const start = transition.route[0];
      const second = transition.route[1];
      const head = transition.route[transition.lenO - 1];
      const beforeHead = transition.route[transition.lenO - 2];
      if (start && second) {
        const axis: "h" | "v" = start.y === second.y ? "h" : "v";
        setTipPosition(
          transition.id,
          "tail",
          start,
          !isColinearWithOther(initialCellAxisMap, transition.id, start, axis),
        );
      }
      if (head && beforeHead) {
        const axis: "h" | "v" = beforeHead.y === head.y ? "h" : "v";
        setTipPosition(
          transition.id,
          "head",
          head,
          !isColinearWithOther(initialCellAxisMap, transition.id, head, axis),
        );
      }
    });
    setViaItems(items);

    const durations = transitions.map((transition) => travelDuration(transition.route.length - transition.lenO));
    const startTime = performance.now();
    const windowBounds: { tail: number; head: number }[] = [];

    const tick = (now: number) => {
      const elapsed = now - startTime;
      let allDone = true;
      const currentBodies: { id: string; points: RoutePoint[] }[] = [];
      const tipInfo: { id: string; end: "tail" | "head"; point: RoutePoint; axis: "h" | "v" }[] = [];

      transitions.forEach((transition, i) => {
        const duration = durations[i] as number;
        const t = Math.min(1, elapsed / duration);
        if (t < 1) allDone = false;

        const eased = easeInOutCubic(t);
        const headIndex = transition.lenO - 1 + (transition.route.length - transition.lenO) * eased;
        const bodySpan = transition.lenO - 1 + (transition.lenN - transition.lenO) * eased;
        const tailIndex = Math.max(0, headIndex - bodySpan);

        windowBounds[i] = { tail: tailIndex, head: headIndex };

        const window = sliceWindow(transition.route, tailIndex, headIndex);
        if (liveBodyRef.current) liveBodyRef.current[i] = window;
        currentBodies.push({ id: transition.id, points: window });

        const el = pathElRefs.current.get(transition.id);
        if (el) el.setAttribute("d", pathData(window));

        const tail = window[0];
        const tailNext = window[1];
        const head = window[window.length - 1];
        const headPrev = window[window.length - 2];
        if (tail && tailNext) tipInfo.push({ id: transition.id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
        if (head && headPrev) tipInfo.push({ id: transition.id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });
      });

      const cellAxisMap = buildCellAxisMap(currentBodies);
      tipInfo.forEach(({ id, end, point, axis }) => {
        setTipPosition(id, end, point, !isColinearWithOther(cellAxisMap, id, point, axis));
      });
      applyIntersections(findIntersections(cellAxisMap));

      viaElRefs.current.forEach((el, key) => {
        const item = viaItemIndexRef.current.get(key);
        const bounds = item ? windowBounds[item.traceIndex] : undefined;
        const visible = item && bounds ? item.index >= bounds.tail - 1e-3 && item.index <= bounds.head + 1e-3 : false;

        el.style.opacity = visible ? "1" : "0";
      });

      if (!allDone) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      rafRef.current = null;
      liveBodyRef.current = transitions.map((transition) => transition.toBody);

      const settled: ViaItem[] = [];
      transitions.forEach((transition, i) => {
        transition.toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === transition.toBody.length - 1) return;
          settled.push({
            key: `${transition.id}-${idx}`,
            traceIndex: i,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: true,
          });
        });
      });
      setViaItems(settled);
    };

    rafRef.current = requestAnimationFrame(tick);
    // Only the target trace identity should retrigger this effect — the
    // refs and callbacks it closes over are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTraces]);

  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  if (!size) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      className="circuit-field"
      height={size.height}
      style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }}
      width={size.width}
    >
      <g
        className="circuit-field-glow"
        fill="none"
        stroke="var(--primary)"
        strokeLinecap="square"
        strokeWidth={1.5}
      >
        {traceIds.map((id) => (
          <path key={id} ref={pathRefCallbacks.get(id)} />
        ))}
      </g>
      <g className="circuit-field-glow" fill="var(--primary)">
        {viaItems.map((item) => (
          <rect
            className={item.boot ? "circuit-field-via" : undefined}
            height={6}
            key={item.key}
            ref={viaRefCallback(item.key)}
            style={item.boot ? { animationDelay: `${item.delay}ms` } : { opacity: item.initiallyVisible ? 1 : 0 }}
            width={6}
            x={item.x - 3}
            y={item.y - 3}
          />
        ))}
        {traceIds.flatMap((id) => [
          <rect height={6} key={`${id}-tail`} ref={tipRefCallback(`${id}-tail`)} width={6} x={-3} y={-3} />,
          <rect height={6} key={`${id}-head`} ref={tipRefCallback(`${id}-head`)} width={6} x={-3} y={-3} />,
        ])}
        {intersectionSlotIds.map((key) => (
          <rect
            height={6}
            key={key}
            ref={intersectionRefCallback(key)}
            style={{ opacity: 0 }}
            width={6}
            x={-3}
            y={-3}
          />
        ))}
      </g>
    </svg>
  );
}
