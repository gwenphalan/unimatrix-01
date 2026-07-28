import {
  GRID,
  type Point,
  cellKey,
  densify,
  mulberry32,
  polylineLength,
  snap,
} from "./grid-math.js";
import {
  type FreeComponent,
  allocateSlots,
  cellKeyToPoint,
  findFreeComponents,
} from "./free-space.js";
import {
  type BarrierField,
  isCellBlocked,
  pointInSoftBarrier,
  segmentCrossesBarrier,
  surfaceOnlyBarriers,
} from "./occlusion.js";
import { bfsConnectorCells, cellOf, connectorViaElbow } from "./route-engine.js";

export type Trace = {
  id: string;
  points: Point[];
  length: number;
  depth: number;
  treeIndex: number;
};
export type CircuitTree = { traces: Trace[]; adjacency: Map<string, Set<string>>; roots: number[] };

// A grid-division cell used only to spread target pads within a free
// component — distinct from `Occluder`/`Rect`, a DOM-measured registrant
// rect.
type Cell = { x0: number; y0: number; x1: number; y1: number };

// Below this many free cells, a component is too small for its own
// meaningful branch — its slot(s) fold into the largest component instead
// (see `allocateSlots` in `free-space.ts`).
const MIN_CELLS_PER_TREE = 8;

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

function cellsCoveringArea(
  width: number,
  height: number,
  count: number,
  offsetX = 0,
  offsetY = 0,
): Cell[] {
  const cellSize = Math.max(GRID * 3, Math.sqrt((width * height) / Math.max(1, count)));
  const cols = Math.max(1, Math.round(width / cellSize));
  const rows = Math.max(1, Math.round(height / cellSize));
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x0: offsetX + col * cellWidth,
        y0: offsetY + row * cellHeight,
        x1: offsetX + (col + 1) * cellWidth,
        y1: offsetY + (row + 1) * cellHeight,
      });
    }
  }

  return cells;
}

/**
 * One cell per slot (jittered), sorted by distance from the component's own
 * center cell ascending — same "radiate outward, slot index doubles as
 * build order" role `generateTraces` relies on, now scoped to a single free
 * component's bounding box instead of the whole canvas. No occlusion-based
 * root scoring: under hard barriers the root is simply the component's
 * pre-computed interior-most cell (`FreeComponent.centerCell`, from
 * `free-space.ts`'s own distance-transform pick), since branch 0 can only
 * ever grow inside this component anyway.
 */
function assignTargetCellsForComponent(
  component: FreeComponent,
  count: number,
  rand: () => number,
): Cell[] {
  const { minCx, maxCx, minCy, maxCy } = component.bounds;
  const x0 = minCx * GRID;
  const y0 = minCy * GRID;
  const w = Math.max(GRID, (maxCx - minCx + 1) * GRID);
  const h = Math.max(GRID, (maxCy - minCy + 1) * GRID);
  const cells = shuffled(cellsCoveringArea(w, h, count, x0, y0), rand);
  const fallback: Cell = { x0, y0, x1: x0 + w, y1: y0 + h };
  const assigned = Array.from(
    { length: count },
    (_, i) => cells[i % Math.max(1, cells.length)] ?? fallback,
  );
  const rootPoint = cellKeyToPoint(component.centerCell);
  const cellCenter = (cell: Cell) => ({ x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 });

  return assigned.slice().sort((a, b) => {
    const ac = cellCenter(a);
    const bc = cellCenter(b);
    return (
      Math.hypot(ac.x - rootPoint.x, ac.y - rootPoint.y) -
      Math.hypot(bc.x - rootPoint.x, bc.y - rootPoint.y)
    );
  });
}

export function clampToLattice(point: Point, width: number, height: number): Point {
  return {
    x: snap(Math.max(GRID, Math.min(width - GRID, point.x))),
    y: snap(Math.max(GRID, Math.min(height - GRID, point.y))),
  };
}

function jitterInCell(cell: Cell, rand: () => number): Point {
  return { x: cell.x0 + rand() * (cell.x1 - cell.x0), y: cell.y0 + rand() * (cell.y1 - cell.y0) };
}

/**
 * Expanding ring search over `component`'s own cells for the nearest
 * unclaimed one — the last-resort fallback when a jittered target keeps
 * landing outside the component or on already-claimed ground. Bounded by
 * the component's own cell span, so it always terminates. Falls back to the
 * component's center cell (always free by construction) rather than an
 * arbitrary clamped point, so this can never hand back a point sitting
 * inside a barrier even in the pathological exhausted case.
 */
function ringSearchInComponent(
  point: Point,
  component: FreeComponent,
  footprint: ReadonlySet<string>,
  barriers: BarrierField,
): Point {
  const baseCx = Math.round(point.x / GRID);
  const baseCy = Math.round(point.y / GRID);
  const { minCx, maxCx, minCy, maxCy } = component.bounds;
  const maxRadius = maxCx - minCx + (maxCy - minCy) + 2;

  const search = (rejectInk: boolean): Point | null => {
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const dyAbs = radius - Math.abs(dx);
        const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];

        for (const dy of dys) {
          const cx = baseCx + dx;
          const cy = baseCy + dy;
          const key = `${cx},${cy}`;
          if (!component.cells.has(key)) continue;
          if (footprint.has(key)) continue;

          const candidate = { x: cx * GRID, y: cy * GRID };
          if (rejectInk && pointInSoftBarrier(barriers, candidate)) continue;

          return candidate;
        }
      }
    }

    return null;
  };

  // Two passes on purpose. A component whose free cells are all covered in ink
  // (a dense text column) must still receive a pad: a via sitting on a glyph is
  // a cosmetic miss, a component with no pad at all is a missing trace. So the
  // ink-avoiding pass is a preference, not a requirement, and only its failure
  // falls through to the original ink-blind search.
  const inkFree = search(true);
  if (inkFree) return inkFree;

  const anyFree = search(false);
  if (anyFree) return anyFree;

  console.warn(
    "[CircuitField] ringSearchInComponent exhausted its component — reusing the component center",
    point,
  );
  // Guaranteed free of hard barriers (it is a component cell), but *not*
  // guaranteed ink-free. Accepted in this pathological case.
  return cellKeyToPoint(component.centerCell);
}

/**
 * Picks a target pad within `cell`, hard-confined to `component`'s own free
 * cells (never a soft accept — a candidate outside the component, whether
 * because it's barrier-blocked or because it belongs to a different
 * disconnected free region, is always rejected and re-jittered), retried up
 * to 8 times, then falling back to `ringSearchInComponent` rather than ever
 * emitting a target the tree can't route to cleanly.
 */
function pickTargetPointInComponent(
  cell: Cell,
  component: FreeComponent,
  footprint: ReadonlySet<string>,
  barriers: BarrierField,
  rand: () => number,
): Point {
  // Soft rects never reach `component.cells`, so the ink check has to be an
  // explicit exact test here — this is the pad/via half of the ink invariant,
  // the counterpart to `walkFromStart`/`attachRoute`'s segment tests.
  const acceptable = (candidate: Point) => {
    const key = cellKey(candidate);
    return (
      component.cells.has(key) && !footprint.has(key) && !pointInSoftBarrier(barriers, candidate)
    );
  };

  let point = jitterInCell(cell, rand);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapped = { x: snap(point.x), y: snap(point.y) };
    if (acceptable(snapped)) return snapped;
    point = jitterInCell(cell, rand);
  }

  const snapped = { x: snap(point.x), y: snap(point.y) };
  if (acceptable(snapped)) return snapped;

  return ringSearchInComponent(snapped, component, footprint, barriers);
}

/**
 * Branch 0 has nothing else to attach to yet, so it walks unconstrained
 * within its component — the same per-segment random walk `buildTraceFromStart`
 * used to do before every later trace was validated against it, now also
 * hard-rejecting any segment that would step onto a barrier-blocked cell or
 * leave the free component (the two are mostly the same check: a component
 * boundary is always a barrier cell or the canvas edge, by construction of
 * `findFreeComponents`). Still tracks its own visited cells to avoid
 * self-collision, stopping the walk early (fewer than the intended segment
 * count) rather than ever forcing a collision or a barrier crossing.
 *
 * The component test is a *cell* test, so it cannot see ink: soft rects never
 * enter `barriers.cells` by design. Without the explicit
 * `segmentCrossesBarrier` reject below, branch 0 of every tree in every
 * component would grow straight through text on every page — and because this
 * is the only barrier-unaware step in the pipeline, the symptom would look like
 * a classifier defect rather than a generation one.
 */
function walkFromStart(
  start: Point,
  width: number,
  height: number,
  component: FreeComponent,
  barriers: BarrierField,
  rand: () => number,
): Point[] {
  const points: Point[] = [start];
  const visited = new Set<string>([cellKey(start)]);
  // More segments, and a strong (not absolute — occasional straight run
  // reads as natural, always-alternating reads as a saw blade) bias toward
  // flipping axis each step, so a branch reads as a zigzag PCB trace rather
  // than a couple of long straight legs.
  const segments = 3 + Math.floor(rand() * 5);
  let lastHorizontal: boolean | undefined;

  for (let s = 0; s < segments; s += 1) {
    let placed = false;

    for (let attempt = 0; attempt < 6 && !placed; attempt += 1) {
      const horizontal =
        lastHorizontal === undefined
          ? rand() < 0.5
          : rand() < 0.75
            ? !lastHorizontal
            : lastHorizontal;
      const magnitude = (40 + Math.floor(rand() * 4) * 20) * (rand() < 0.5 ? -1 : 1);
      const prev = points[points.length - 1] as Point;
      const next = clampToLattice(
        horizontal ? { x: prev.x + magnitude, y: prev.y } : { x: prev.x, y: prev.y + magnitude },
        width,
        height,
      );

      if (next.x === prev.x && next.y === prev.y) continue;

      const segmentCells = densify([prev, next]).map((point) => cellKey(point));
      const revisits = segmentCells.some((key, idx) => idx > 0 && visited.has(key));
      const leavesComponent = segmentCells.some((key) => !component.cells.has(key));

      if (revisits || leavesComponent) continue;
      if (segmentCrossesBarrier(barriers, prev, next)) continue;

      segmentCells.forEach((key) => visited.add(key));
      points.push(next);
      placed = true;
      lastHorizontal = horizontal;
    }

    if (!placed) break;
  }

  return points;
}

/**
 * Connects `target` to the nearest lattice point already in this
 * component's tree footprint, reusing `route-engine.ts`'s own elbow/BFS-
 * corridor machinery — the same primitives `buildRoute` uses for live crawl
 * retargeting. Both the anchor search and the BFS corridor fallback are
 * confined to `footprint` (this component's own claimed cells only —
 * components never share adjacent free cells, so there is never a need to
 * search beyond it), and every candidate segment is now a hard reject
 * against `barriers`, not a soft occlusion-cost tiebreak: an elbow that
 * clips a buffered occluder rect is disqualified outright rather than
 * merely disfavored, and the BFS corridor treats every barrier-blocked cell
 * as occupied.
 */
/**
 * Two-corner "staircase" alternative to a plain one-corner elbow: anchor to
 * a mid column/row, jog to the target's own column/row, then in. Purely
 * cosmetic — offered only as an extra candidate `attachRoute` may pick
 * alongside the plain elbows, subject to the exact same collision/barrier
 * checks — so it can only ever make an attach point read more like a real
 * PCB trace's staggered bends, never bypass a barrier a plain elbow
 * wouldn't.
 */
function doglegCandidates(anchor: Point, target: Point, rand: () => number): Point[][] {
  const candidates: Point[][] = [];
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;

  if (Math.abs(dx) >= GRID * 2) {
    const steps = Math.round(dx / GRID);
    const split = 1 + Math.floor(rand() * (Math.abs(steps) - 1));
    const midX = anchor.x + split * GRID * Math.sign(dx);
    candidates.push(
      densify([anchor, { x: midX, y: anchor.y }, { x: midX, y: target.y }, target]).slice(1, -1),
    );
  }

  if (Math.abs(dy) >= GRID * 2) {
    const steps = Math.round(dy / GRID);
    const split = 1 + Math.floor(rand() * (Math.abs(steps) - 1));
    const midY = anchor.y + split * GRID * Math.sign(dy);
    candidates.push(
      densify([anchor, { x: anchor.x, y: midY }, { x: target.x, y: midY }, target]).slice(1, -1),
    );
  }

  return candidates;
}

// How many of the nearest footprint cells `attachRoute` will try as an anchor
// before degrading to an ink-blind corridor.
//
// Whether a clean route exists depends mostly on which side of an ink line the
// anchor sits on, and the single nearest cell is often the wrong side — so this
// is the highest-leverage knob on ink violations by a wide margin. Measured
// over 40 seeds x 24 traces on two layouts (scattered ink lines, and a hard
// article panel with ink in the gutters), counting segments that cross ink:
//
//   K:        1     2     4     8    12    16    24
//   scattered 198   137   80    45   21    9     5
//   article   309   225   142   20   4     0     0
//
// 16 is where the realistic article layout reaches zero. Cost is a corridor
// BFS per extra anchor, but only when the elbow/dogleg tier already failed:
// 0.96ms/call at K=1 vs 1.29ms at K=16, on a function that runs once per
// structural commit rather than per frame. Hard-barrier violations were zero at
// every K — this knob only ever trades time for ink fidelity.
const ANCHOR_CANDIDATES = 16;

function attachRoute(
  target: Point,
  footprint: Set<string>,
  footprintOwner: Map<string, number>,
  width: number,
  height: number,
  barriers: BarrierField,
  rand: () => number,
): { ownerIndex: number; body: Point[] } {
  const targetKey = cellKey(target);
  const maxCx = Math.round(width / GRID);
  const maxCy = Math.round(height / GRID);

  // The nearest `ANCHOR_CANDIDATES` footprint cells, ascending — not just the
  // nearest one. See that constant for why, and for the measurements.
  const nearest: { key: string; cx: number; cy: number; distance: number }[] = [];

  for (const key of footprint) {
    const [cx, cy] = key.split(",").map(Number) as [number, number];
    const distance = Math.hypot(cx * GRID - target.x, cy * GRID - target.y);

    if (nearest.length < ANCHOR_CANDIDATES) {
      nearest.push({ key, cx, cy, distance });
      nearest.sort((a, b) => a.distance - b.distance);
      continue;
    }

    const worst = nearest[nearest.length - 1] as (typeof nearest)[number];
    if (distance >= worst.distance) continue;

    nearest[nearest.length - 1] = { key, cx, cy, distance };
    nearest.sort((a, b) => a.distance - b.distance);
  }

  /**
   * One anchor's worth of the degradation ladder.
   *
   * Tier 1 — elbow/dogleg candidates, rejected on collision or on the full
   * hard-union-soft segment test.
   *
   * Tier 2 — corridor BFS treating ink as occupied, with the densified result
   * re-checked against the exact test: `softCells` is a lattice approximation
   * of geometry finer than the lattice, so clearing it does not prove the
   * segments are clear.
   *
   * Tier 3 (`avoidInk: false`, only after every anchor has failed tiers 1-2) —
   * this function's behaviour before text was a barrier at all: tested against
   * `surfaceOnlyBarriers`, so text is gone from the lattice *and* the exact rects.
   * Guaranteed surface-clear, may clip a glyph, and accepted **silently**. The
   * silence is deliberate: text can make a corridor genuinely impossible, and the
   * warn at the end means "a component's own footprint was unreachable from
   * itself", a real defect that a text-dense page would otherwise bury.
   *
   * Narrowing only the exact rects here and leaving text in `cells` is the
   * specific mistake to avoid — the tier then fails on the text it was meant to
   * ignore, which is invisible in review and shows up as a warning storm.
   */
  const attemptFrom = (
    candidate: (typeof nearest)[number],
    avoidInk: boolean,
  ): { ownerIndex: number; body: Point[] } | null => {
    const anchor: Point = { x: candidate.cx * GRID, y: candidate.cy * GRID };
    const allowed = new Set([candidate.key, targetKey]);
    // The blind tier tests against a field with text removed from the lattice as
    // well as from the exact rects. Text is cell-blocking now, so leaving
    // `barriers` in place here would make this tier no more permissive than the
    // one above it and the warn below would fire on ordinary prose.
    const field = avoidInk ? barriers : surfaceOnlyBarriers(barriers);

    const collides = (points: Point[]) =>
      points.some((point) => {
        const key = cellKey(point);
        if (allowed.has(key)) return false;
        return footprint.has(key) || isCellBlocked(field, point);
      });

    const crossesBarrier = (points: Point[]) => {
      let prev = anchor;
      for (const point of points) {
        if (segmentCrossesBarrier(field, prev, point)) return true;
        prev = point;
      }
      return segmentCrossesBarrier(field, prev, target);
    };

    const elbowCandidates = [
      connectorViaElbow(anchor, target, { x: target.x, y: anchor.y }),
      connectorViaElbow(anchor, target, { x: anchor.x, y: target.y }),
    ];

    const validElbowCandidates = elbowCandidates.filter(
      (points) => !collides(points) && !crossesBarrier(points),
    );
    const validDoglegCandidates = doglegCandidates(anchor, target, rand).filter(
      (points) => !collides(points) && !crossesBarrier(points),
    );

    // Favor a staggered dogleg over a plain single-bend elbow about a third of
    // the time it's available — enough to break up long runs of identical
    // L-shaped joints into something that reads as a denser, more branchy
    // circuit, without replacing the elbow as the common case.
    let interior: Point[] | null =
      validDoglegCandidates.length > 0 && rand() < 0.35
        ? (validDoglegCandidates[Math.floor(rand() * validDoglegCandidates.length)] as Point[])
        : validElbowCandidates.length === 0
          ? null
          : validElbowCandidates.reduce((best, points) =>
              points.length < best.length ? points : best,
            );

    if (!interior) {
      const corridorOccupied = new Set(footprint);
      field.cells.forEach((key) => corridorOccupied.add(key));
      if (avoidInk) barriers.softCells.forEach((key) => corridorOccupied.add(key));
      // After the barrier unions, not before: an anchor or target cell may
      // itself sit on ink, and re-adding it here is what lets a route escape.
      corridorOccupied.delete(candidate.key);
      corridorOccupied.delete(targetKey);

      const corridor = bfsConnectorCells(
        { cx: candidate.cx, cy: candidate.cy },
        cellOf(target),
        corridorOccupied,
        { minX: 0, maxX: maxCx, minY: 0, maxY: maxCy },
      );

      if (corridor) {
        const viaCorridor = densify([anchor, ...corridor, target]).slice(1, -1);
        if (!avoidInk || !crossesBarrier(viaCorridor)) interior = viaCorridor;
      }
    }

    if (!interior) return null;

    // `connectorViaElbow`/`bfsConnectorCells` route through `densify`, whose
    // `prev + dx * (s / steps)` interpolation can drift a fractional epsilon
    // off an exact GRID multiple — invisible for live-crawl rendering but not
    // exact enough for generation output, which the "every vertex on the
    // lattice" invariant checks precisely.
    return {
      ownerIndex: footprintOwner.get(candidate.key) as number,
      body: [anchor, ...interior, target].map((point) => ({
        x: snap(point.x),
        y: snap(point.y),
      })),
    };
  };

  for (const candidate of nearest) {
    const attached = attemptFrom(candidate, true);
    if (attached) return attached;
  }

  const fallbackAnchor = nearest[0] as (typeof nearest)[number];
  const inkBlind = attemptFrom(fallbackAnchor, false);
  if (inkBlind) return inkBlind;

  // Should essentially never happen: a component's own claimed footprint is
  // always reachable from itself under BFS by construction. A canary, not an
  // expected path — the direct elbow fallback here may cross a barrier, which
  // the warning flags for investigation.
  const anchor: Point = { x: fallbackAnchor.cx * GRID, y: fallbackAnchor.cy * GRID };
  console.warn(
    "[CircuitField] attachRoute found no barrier-clear corridor — falling back to a direct elbow",
    { anchor, target },
  );

  return {
    ownerIndex: footprintOwner.get(fallbackAnchor.key) as number,
    body: [anchor, ...connectorViaElbow(anchor, target, { x: target.x, y: anchor.y }), target].map(
      (point) => ({ x: snap(point.x), y: snap(point.y) }),
    ),
  };
}

/**
 * Deterministic procedural PCB-trace layout: a forest of rectilinear
 * spanning trees, one per connected free component of the canvas under
 * `barriers` (see `findFreeComponents`), together holding exactly `count`
 * branches (see `allocateSlots`). A single hard-barrier occluder spanning
 * the canvas (e.g. a full-width footer) used to leave nothing for a
 * single-tree generator to grow into on one side; growing one tree per free
 * region instead means every disconnected pocket of space still fills with
 * trace geometry rather than sitting empty.
 *
 * Within a component, every branch after its own first attaches to the
 * existing structure at exactly one point (see `attachRoute`), so each tree
 * is acyclic by construction — no rejection, no starvation, no
 * fallback-to-stub. `roots` records the trace index of each tree's first
 * branch (`Trace.depth === 0`), and `Trace.treeIndex` ties every branch back
 * to the component it grew in.
 */
export function generateTraces(
  width: number,
  height: number,
  seed: number,
  barriers: BarrierField,
  count: number,
): CircuitTree {
  const rand = mulberry32(seed);
  const components = findFreeComponents(barriers, width, height);
  const adjacency = new Map<string, Set<string>>();
  const traces: Trace[] = [];
  const roots: number[] = [];

  if (components.length === 0) {
    console.warn("[CircuitField] generateTraces found no free space under the current barrier set");
    return { traces, adjacency, roots };
  }

  const slots = allocateSlots(components, count, MIN_CELLS_PER_TREE);

  components.forEach((component, componentIdx) => {
    const slotCount = slots[componentIdx] ?? 0;
    if (slotCount <= 0) return;

    const targetCells = assignTargetCellsForComponent(component, slotCount, rand);
    const localFootprint = new Set<string>();
    const localFootprintOwner = new Map<string, number>();
    const depths = new Map<number, number>();

    const claim = (points: Point[], ownerIndex: number) => {
      const dense = densify(points);

      dense.forEach((point, idx) => {
        const key = cellKey(point);
        if (!localFootprintOwner.has(key)) localFootprintOwner.set(key, ownerIndex);
        localFootprint.add(key);

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

    for (let j = 0; j < slotCount; j += 1) {
      const traceIndex = traces.length;
      const target = pickTargetPointInComponent(
        targetCells[j] as Cell,
        component,
        localFootprint,
        barriers,
        rand,
      );

      if (j === 0) {
        const points = walkFromStart(target, width, height, component, barriers, rand);
        traces.push({
          id: `t${traceIndex}`,
          points,
          length: polylineLength(points),
          depth: 0,
          treeIndex: componentIdx,
        });
        depths.set(traceIndex, 0);
        roots.push(traceIndex);
        claim(points, traceIndex);
        continue;
      }

      const { ownerIndex, body } = attachRoute(
        target,
        localFootprint,
        localFootprintOwner,
        width,
        height,
        barriers,
        rand,
      );
      const depth = (depths.get(ownerIndex) ?? 0) + 1;

      traces.push({
        id: `t${traceIndex}`,
        points: body,
        length: polylineLength(body),
        depth,
        treeIndex: componentIdx,
      });
      depths.set(traceIndex, depth);
      claim(body, traceIndex);
    }
  });

  return { traces, adjacency, roots };
}
