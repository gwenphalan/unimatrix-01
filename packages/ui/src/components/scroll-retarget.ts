import { GRID, type Point, type RoutePoint, cellKey } from "./grid-math.js";
import { type Occluder, type Rect, occlusionWeightAt } from "./occlusion.js";
import { clampToLattice } from "./trace-generation.js";

// A local nudge, not a re-placement — how far from its current tip a
// retarget candidate is allowed to land. Needs a real-browser visual pass
// to tune, same caveat as `OCCLUDER_FALLOFF_PX`'s own existing comment.
const RETARGET_SEARCH_RADIUS_CELLS = 3;
const RETARGET_MAX_ATTEMPTS = 10;

export type TraceTip = { id: string; point: Point };

/**
 * Union of every trace's live body cells except `excludeId`'s own — the
 * footprint a retarget candidate must avoid to not collide with another
 * live trace.
 */
export function buildOccupiedFootprint(liveBodies: ReadonlyMap<string, readonly RoutePoint[]>, excludeId: string): Set<string> {
  const occupied = new Set<string>();

  liveBodies.forEach((body, id) => {
    if (id === excludeId) return;
    body.forEach((point) => occupied.add(cellKey(point)));
  });

  return occupied;
}

function rectContains(point: Point, rect: Rect, margin: number): boolean {
  return (
    point.x >= rect.x0 - margin &&
    point.x <= rect.x1 + margin &&
    point.y >= rect.y0 - margin &&
    point.y <= rect.y1 + margin
  );
}

/**
 * Trace ids whose *tip* (the only endpoint a scroll retarget can actually
 * relocate — see `retargetTip`) currently falls within `margin` of one of
 * `dirtyRects`. Tests the tip only, not the whole body: flagging a trace
 * whose mid-body geometry crosses a moved occluder would test for a fix
 * this mechanism can't deliver.
 */
export function findAffectedTraceIds(tips: readonly TraceTip[], dirtyRects: readonly Rect[], margin: number): string[] {
  if (dirtyRects.length === 0) return [];

  return tips.filter((tip) => dirtyRects.some((rect) => rectContains(tip.point, rect, margin))).map((tip) => tip.id);
}

/**
 * Finds a point along the tip's own final segment line that scores
 * strictly better than its current position under `occlusionWeightAt`,
 * without colliding with any other live trace's footprint or the trace's
 * own body. Movement is constrained to extending/retracting along the
 * existing final segment's own axis (never perpendicular) — the tip's
 * immediate predecessor (`pivot`) is colinear with the trace's real sparse
 * control point one segment back (dense subdivision preserves the
 * original segment's line), so any point on that same line keeps both the
 * dense body *and* the sparse point list the caller reconstructs from it
 * axis-aligned; a perpendicular nudge would need a second leg (an elbow)
 * whose orientation must match the *sparse* polyline's existing direction
 * to stay axis-aligned there too, which this module has no visibility
 * into — an in-line nudge sidesteps that requirement entirely.
 *
 * Returns `null` — an intentional "leave it alone", not a bug — when the
 * tip's own cell is already claimed by another trace's anchor
 * (sole-ownership guard: per `attachRoute`'s "nearest footprint point, any
 * cell, not just endpoints" semantics, a shared cell means some other
 * trace depends on this exact point, so it must never move), or when no
 * candidate along the line clears both the collision checks and the
 * strict-improvement bar. Soft-occlusion is "never hard-excluded" by
 * design — a trace staying under a moving occluder with no better local
 * option on its own line is an acceptable degrade.
 */
export function retargetTip(
  body: readonly RoutePoint[],
  occupied: ReadonlySet<string>,
  occluders: readonly Occluder[],
  width: number,
  height: number,
  rand: () => number = Math.random,
): Point | null {
  if (body.length < 2) return null;

  const tip = body[body.length - 1] as RoutePoint;
  const pivot = body[body.length - 2] as RoutePoint;

  if (occupied.has(cellKey(tip))) return null;

  const axis: "x" | "y" | null = pivot.y === tip.y ? "x" : pivot.x === tip.x ? "y" : null;
  if (!axis) return null; // guards against a malformed (non-axis-aligned) body rather than assuming

  const ownCells = new Set<string>();
  for (let i = 0; i < body.length - 1; i += 1) {
    ownCells.add(cellKey(body[i] as RoutePoint));
  }

  const currentWeight = occlusionWeightAt(tip.x, tip.y, occluders);
  let best: Point | null = null;
  let bestWeight = currentWeight;

  for (let attempt = 0; attempt < RETARGET_MAX_ATTEMPTS; attempt += 1) {
    const steps = Math.round((rand() * 2 - 1) * RETARGET_SEARCH_RADIUS_CELLS);
    if (steps === 0) continue;

    const raw: Point = axis === "x" ? { x: tip.x + steps * GRID, y: tip.y } : { x: tip.x, y: tip.y + steps * GRID };
    const candidate = clampToLattice(raw, width, height);
    if (candidate.x === pivot.x && candidate.y === pivot.y) continue;
    if (candidate.x === tip.x && candidate.y === tip.y) continue;

    const candidateSteps = Math.round(
      (axis === "x" ? candidate.x - pivot.x : candidate.y - pivot.y) / GRID,
    );
    const direction = candidateSteps > 0 ? 1 : -1;
    let blocked = false;

    for (let s = 1; s <= Math.abs(candidateSteps); s += 1) {
      const point: Point =
        axis === "x" ? { x: pivot.x + s * direction * GRID, y: pivot.y } : { x: pivot.x, y: pivot.y + s * direction * GRID };
      const key = cellKey(point);
      // The cell at s === Math.abs(candidateSteps) is the candidate itself,
      // which is expected to replace the vacated tip cell — everything
      // strictly between pivot and the candidate must be clear.
      if (s < Math.abs(candidateSteps) && (occupied.has(key) || ownCells.has(key))) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (occupied.has(cellKey(candidate)) || ownCells.has(cellKey(candidate))) continue;

    const weight = occlusionWeightAt(candidate.x, candidate.y, occluders);
    if (weight > bestWeight) {
      best = candidate;
      bestWeight = weight;
    }
  }

  return best;
}
