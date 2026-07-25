import { GRID, type Point, type RoutePoint, densify, mulberry32, polylineLength, snap } from "./grid-math.js";
import { GridGraph } from "./grid-graph.js";

export type Trace = { id: string; points: Point[]; length: number };
export type KeepOut = { x0: number; y0: number; x1: number; y1: number };

export function shuffled<T>(items: T[], rand: () => number): T[] {
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

export function cellsCoveringArea(width: number, height: number, keepOut: KeepOut, count: number): KeepOut[] {
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
export function buildStartPoints(
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

export function buildTraceFromStart(
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

  // Every direction is blocked: return a zero-length degenerate trace. Once
  // densified this collapses to a single point, so it never has a "next"
  // point to derive a tip axis from — mount/transition code simply skips
  // positioning its tip rects, which stay at their default hidden opacity.
  // That's intentional: a zero-length trace has no visible line, so no tip
  // should show.
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
export function generateTraces(width: number, height: number, seed: number, keepOut: KeepOut, count: number): Trace[] {
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
