import { GRID, type Point, cellKey, densify, mulberry32, polylineLength, snap } from "./grid-math.js";
import { type Occluder, occlusionWeightAt } from "./occlusion.js";
import { bfsConnectorCells, cellOf, connectorViaElbow } from "./route-engine.js";

export type Trace = { id: string; points: Point[]; length: number; depth: number };
export type CircuitTree = { traces: Trace[]; adjacency: Map<string, Set<string>> };

// A grid-division cell used only to spread target pads across the canvas —
// distinct from `Occluder`, a DOM-measured registrant rect (the old `KeepOut`
// name was confusingly reused for both).
type Cell = { x0: number; y0: number; x1: number; y1: number };

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

function cellsCoveringArea(width: number, height: number, count: number): Cell[] {
  const cellSize = Math.max(GRID * 3, Math.sqrt((width * height) / Math.max(1, count)));
  const cols = Math.max(1, Math.round(width / cellSize));
  const rows = Math.max(1, Math.round(height / cellSize));
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x0: col * cellWidth,
        y0: row * cellHeight,
        x1: (col + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      });
    }
  }

  return cells;
}

/**
 * One cell per slot (jittered, grid-snapped), sorted by distance from the
 * root cell ascending — this both spreads target pads across the canvas
 * (like the old per-cell jitter did) and makes the tree radiate outward
 * naturally once slot index doubles as build order in `generateTraces`: near
 * pads attach to a still-small tree, far pads attach to an already-larger
 * one, which also gives boot depth (see `Trace.depth`) almost for free.
 *
 * The root (slot 0, branch 0's unconstrained walk — see `walkFromStart`) is
 * picked as whichever assigned cell is *least* occluded at its center, not
 * simply the canvas-geometric-center cell: the page's actual center is
 * frequently sitting under a registered card/panel now that occlusion covers
 * real content blocks, and branch 0 has no attach-point constraint pulling it
 * there. Ties (including the common no-occluders case, where every cell scores
 * the same open weight) fall back to nearest-canvas-center, preserving the
 * exact prior placement when nothing is registered.
 */
function assignTargetCells(
  width: number,
  height: number,
  count: number,
  occluders: readonly Occluder[],
  rand: () => number,
): Cell[] {
  const cells = shuffled(cellsCoveringArea(width, height, count), rand);
  const fallback: Cell = { x0: 0, y0: 0, x1: width, y1: height };
  const assigned = Array.from({ length: count }, (_, i) => cells[i % Math.max(1, cells.length)] ?? fallback);
  const canvasCenter = { x: width / 2, y: height / 2 };
  const cellCenter = (cell: Cell) => ({ x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 });

  let rootIndex = 0;
  let bestWeight = -Infinity;
  let bestCenterDistance = Infinity;

  assigned.forEach((cell, i) => {
    const center = cellCenter(cell);
    const weight = occlusionWeightAt(center.x, center.y, occluders);
    const centerDistance = Math.hypot(center.x - canvasCenter.x, center.y - canvasCenter.y);

    if (weight > bestWeight || (weight === bestWeight && centerDistance < bestCenterDistance)) {
      bestWeight = weight;
      bestCenterDistance = centerDistance;
      rootIndex = i;
    }
  });

  const rootCenter = cellCenter(assigned[rootIndex] as Cell);

  return assigned
    .slice()
    .sort((a, b) => {
      const ac = cellCenter(a);
      const bc = cellCenter(b);
      return Math.hypot(ac.x - rootCenter.x, ac.y - rootCenter.y) - Math.hypot(bc.x - rootCenter.x, bc.y - rootCenter.y);
    });
}

export function clampToLattice(point: Point, width: number, height: number): Point {
  return {
    x: snap(Math.max(GRID, Math.min(width - GRID, point.x))),
    y: snap(Math.max(GRID, Math.min(height - GRID, point.y))),
  };
}

function jitterInCell(cell: Cell, width: number, height: number, rand: () => number): Point {
  return clampToLattice({ x: cell.x0 + rand() * (cell.x1 - cell.x0), y: cell.y0 + rand() * (cell.y1 - cell.y0) }, width, height);
}

/**
 * Expanding ring search over lattice cells for the nearest cell not already
 * claimed by the tree — the last-resort fallback when a jittered target
 * keeps landing on already-occupied ground. Bounded by the canvas's own
 * cell count (`maxRadius`), so it always terminates; at realistic trace
 * counts the footprint is a tiny fraction of the lattice, so this resolves
 * within the first few rings almost always. The `console.warn` path is a
 * canary for a case that should be geometrically impossible outside a
 * pathological (near-fully-occupied) canvas.
 */
function ringSearchUnoccupied(point: Point, width: number, height: number, footprint: Set<string>): Point {
  const baseCx = Math.round(point.x / GRID);
  const baseCy = Math.round(point.y / GRID);
  const maxCx = Math.max(1, Math.round(width / GRID) - 1);
  const maxCy = Math.max(1, Math.round(height / GRID) - 1);
  const maxRadius = maxCx + maxCy;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dyAbs = radius - Math.abs(dx);
      const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];

      for (const dy of dys) {
        const cx = baseCx + dx;
        const cy = baseCy + dy;
        if (cx < 1 || cx > maxCx || cy < 1 || cy > maxCy) continue;

        const key = `${cx},${cy}`;
        if (!footprint.has(key)) return { x: cx * GRID, y: cy * GRID };
      }
    }
  }

  console.warn("[CircuitField] ringSearchUnoccupied exhausted the canvas — reusing an occupied point", point);
  return clampToLattice(point, width, height);
}

/**
 * Picks a target pad within `cell`: soft-accepts against `occlusionWeightAt`
 * (never a hard reject — "soft everywhere"), retried up to 8 times like the
 * old `buildStartPoints`, then unconditionally accepted on the last attempt
 * regardless of weight. Separately, a pad landing on an already-claimed
 * lattice cell (possible by chance — target sampling doesn't otherwise know
 * about the tree) is re-jittered too, falling back to `ringSearchUnoccupied`
 * rather than ever emitting a target the tree can't route to cleanly.
 */
function pickTargetPoint(
  cell: Cell,
  width: number,
  height: number,
  occluders: readonly Occluder[],
  footprint: Set<string>,
  rand: () => number,
): Point {
  let point = jitterInCell(cell, width, height, rand);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const weight = occlusionWeightAt(point.x, point.y, occluders);
    if (rand() <= weight && !footprint.has(cellKey(point))) return point;
    point = jitterInCell(cell, width, height, rand);
  }

  if (!footprint.has(cellKey(point))) return point;

  return ringSearchUnoccupied(point, width, height, footprint);
}

/**
 * Branch 0 has nothing else to attach to yet, so it walks unconstrained —
 * the same per-segment random walk `buildTraceFromStart` used to do before
 * every later trace was validated against it. Unlike later branches, it
 * still has to avoid retracing *itself*: two segments can cancel out (e.g.
 * right 40 then left 40) with nothing else around to reject that, so this
 * tracks its own visited cells and retries a colliding segment with a
 * different direction/magnitude, stopping the walk early (fewer than the
 * intended segment count) rather than ever forcing a self-collision.
 */
function walkFromStart(start: Point, width: number, height: number, rand: () => number): Point[] {
  const points: Point[] = [start];
  const visited = new Set<string>([cellKey(start)]);
  const segments = 2 + Math.floor(rand() * 4);

  for (let s = 0; s < segments; s += 1) {
    let placed = false;

    for (let attempt = 0; attempt < 6 && !placed; attempt += 1) {
      const horizontal = rand() < 0.5;
      const magnitude = (40 + Math.floor(rand() * 6) * 20) * (rand() < 0.5 ? -1 : 1);
      const prev = points[points.length - 1] as Point;
      const next = clampToLattice(
        horizontal ? { x: prev.x + magnitude, y: prev.y } : { x: prev.x, y: prev.y + magnitude },
        width,
        height,
      );

      if (next.x === prev.x && next.y === prev.y) continue;

      const segmentCells = densify([prev, next]).map((point) => cellKey(point));
      const revisits = segmentCells.some((key, idx) => idx > 0 && visited.has(key));

      if (revisits) continue;

      segmentCells.forEach((key) => visited.add(key));
      points.push(next);
      placed = true;
    }

    if (!placed) break;
  }

  return points;
}

/**
 * Connects `target` to the nearest lattice point already in the tree's
 * footprint, reusing `route-engine.ts`'s own elbow/BFS-corridor machinery
 * (the same primitives `buildRoute` uses for live crawl retargeting) rather
 * than a second pathfinding implementation. Because the anchor is always
 * already in the footprint and the route avoids re-entering it except at the
 * anchor and target cells, every branch touches existing structure at
 * exactly one point by construction — no loop-rejection pass is needed.
 *
 * `pickTargetPoint` keeps the target *endpoint* out of occluded ground, but
 * neither elbow orientation was ever scored against occlusion — so the
 * *connecting* segment between anchor and target could still cut straight
 * across a registered card even though both endpoints sat outside it. When
 * both elbow orientations are otherwise valid (collision-free against the
 * existing footprint), the one that spends less of its length inside
 * occluded ground wins — still soft (never a hard reject; the BFS corridor
 * fallback below remains footprint-only, unaware of occlusion), but removes
 * the common avoidable case where the *other* equally-valid orientation
 * would have skirted the card entirely.
 */
function attachRoute(
  target: Point,
  footprint: Set<string>,
  footprintOwner: Map<string, number>,
  width: number,
  height: number,
  occluders: readonly Occluder[],
): { ownerIndex: number; body: Point[] } {
  let anchorKey = "";
  let anchorCx = 0;
  let anchorCy = 0;
  let bestDistance = Infinity;

  for (const key of footprint) {
    const [cx, cy] = key.split(",").map(Number) as [number, number];
    const distance = Math.hypot(cx * GRID - target.x, cy * GRID - target.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      anchorKey = key;
      anchorCx = cx;
      anchorCy = cy;
    }
  }

  const anchor: Point = { x: anchorCx * GRID, y: anchorCy * GRID };
  const ownerIndex = footprintOwner.get(anchorKey) as number;
  const targetKey = cellKey(target);
  const allowed = new Set([anchorKey, targetKey]);
  const collides = (points: Point[]) => points.some((point) => footprint.has(cellKey(point)) && !allowed.has(cellKey(point)));

  const elbowCandidates = [
    connectorViaElbow(anchor, target, { x: target.x, y: anchor.y }),
    connectorViaElbow(anchor, target, { x: anchor.x, y: target.y }),
  ];
  const occlusionCost = (points: Point[]) =>
    points.reduce((sum, point) => sum + (1 - occlusionWeightAt(point.x, point.y, occluders)), 0);

  const validElbowCandidates = elbowCandidates.filter((candidate) => !collides(candidate));
  let interior: Point[] | null =
    validElbowCandidates.length === 0
      ? null
      : validElbowCandidates.reduce((best, candidate) => (occlusionCost(candidate) < occlusionCost(best) ? candidate : best));

  if (!interior) {
    const maxCx = Math.round(width / GRID);
    const maxCy = Math.round(height / GRID);
    const corridorOccupied = new Set(footprint);
    corridorOccupied.delete(anchorKey);
    corridorOccupied.delete(targetKey);

    const corridor = bfsConnectorCells(
      { cx: anchorCx, cy: anchorCy },
      cellOf(target),
      corridorOccupied,
      { minX: 0, maxX: maxCx, minY: 0, maxY: maxCy },
    );

    interior = corridor ? densify([anchor, ...corridor, target]).slice(1, -1) : null;
  }

  if (!interior) {
    // Should essentially never happen on a finite lattice at realistic trace
    // counts — a canary, not an expected path. A rare double-line seam is a
    // much smaller regression than dropping the branch to a stub.
    console.warn("[CircuitField] attachRoute found no clear corridor — falling back to a direct elbow", { anchor, target });
    interior = elbowCandidates[0] as Point[];
  }

  // `connectorViaElbow`/`bfsConnectorCells` route through `densify`, whose
  // `prev + dx * (s / steps)` interpolation can drift a fractional epsilon
  // off an exact GRID multiple (e.g. dx=120, steps=3 hits 1/3 in binary
  // floating point) — invisible for live-crawl rendering (its only use
  // before this rewrite) but not exact enough for generation output, which
  // the "every vertex on the lattice" invariant checks precisely.
  const body = [anchor, ...interior, target].map((point) => ({ x: snap(point.x), y: snap(point.y) }));

  return { ownerIndex, body };
}

/**
 * Deterministic procedural PCB-trace layout: a single rectilinear spanning
 * tree grown as exactly `count` branches — each branch *is* one tree edge
 * from birth, rather than being cut out of a separately-built tree after the
 * fact. That avoids the two-phase "build then decompose" approach's own
 * hazard: cutting an arbitrary tree into an exact count of non-retracing
 * simple paths isn't generally possible (minimum path cover of a tree is
 * `ceil(leaves/2)`, not freely dialable to `count`), and a naive Euler-tour
 * cut can walk out to a leaf and back over the same edge — a trace retracing
 * its own stretch, which the "no loops" invariant forbids.
 *
 * Every branch after the first attaches to the existing structure at exactly
 * one point (see `attachRoute`), so this is acyclic by construction — no
 * rejection, no starvation, no fallback-to-stub. This structurally
 * guarantees connectedness, minimum edge length between any two attached
 * points, real junction topology, and the `adjacency` map Session E's idle
 * packets will walk.
 */
export function generateTraces(
  width: number,
  height: number,
  seed: number,
  occluders: readonly Occluder[],
  count: number,
): CircuitTree {
  const rand = mulberry32(seed);
  const targetCells = assignTargetCells(width, height, count, occluders, rand);
  const footprint = new Set<string>();
  const footprintOwner = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const depths: number[] = [];
  const traces: Trace[] = [];

  const claim = (points: Point[], ownerIndex: number) => {
    const dense = densify(points);

    dense.forEach((point, idx) => {
      const key = cellKey(point);
      if (!footprintOwner.has(key)) footprintOwner.set(key, ownerIndex);
      footprint.add(key);

      if (idx === 0) return;

      const prevKey = cellKey(dense[idx - 1] as Point);
      const forward = adjacency.get(prevKey) ?? new Set<string>();
      forward.add(key);
      adjacency.set(prevKey, forward);
      const backward = adjacency.get(key) ?? new Set<string>();
      backward.add(prevKey);
      adjacency.set(key, backward);
    });
  };

  for (let i = 0; i < count; i += 1) {
    const target = pickTargetPoint(targetCells[i] as Cell, width, height, occluders, footprint, rand);

    if (i === 0) {
      const points = walkFromStart(target, width, height, rand);
      traces.push({ id: `t${i}`, points, length: polylineLength(points), depth: 0 });
      depths.push(0);
      claim(points, i);
      continue;
    }

    const { ownerIndex, body } = attachRoute(target, footprint, footprintOwner, width, height, occluders);
    const depth = (depths[ownerIndex] as number) + 1;

    traces.push({ id: `t${i}`, points: body, length: polylineLength(body), depth });
    depths.push(depth);
    claim(body, i);
  }

  return { traces, adjacency };
}
