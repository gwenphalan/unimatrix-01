import { GRID } from "./grid-math.js";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** A DOM-measured registrant rect, in viewport coordinates. */
export type Occluder = Rect;

// Distance (px) beyond an occluder's edge at which its weight reaches 1
// (fully open). Tunable — needs a real-browser visual pass, not derivable
// analytically.
const OCCLUDER_FALLOFF_PX = GRID * 4;
// Weight floor at the occluder's own center — never a hard 0, per the
// soft-everywhere decision: traces may still render (dimmer/rarer) behind
// any registered panel, never fully excluded.
const OCCLUDER_MIN_WEIGHT = 0.12;
// Sampling grid for estimateEffectiveArea, independent of and finer than
// cellsCoveringArea's trace-count-driven coarse tiling — a small occluder
// (e.g. a ~60px header) can fall entirely between coarse cell centers and
// register as contributing ~0 effective-area reduction despite still
// suppressing pad placement locally.
const EFFECTIVE_AREA_SAMPLE_STEP = GRID * 2;

/**
 * Openness (0..1) at a point given all registered occluders — 1 is fully
 * open, `OCCLUDER_MIN_WEIGHT` is the floor at the center of the strongest
 * overlapping occluder. Overlapping occluders combine via `min()` (the
 * strongest single occluder wins) rather than compounding multiplicatively,
 * which would drive weight toward zero as more panels overlap and be harder
 * to reason about visually.
 */
export function occlusionWeightAt(x: number, y: number, occluders: readonly Occluder[]): number {
  let weight = 1;

  for (const rect of occluders) {
    const dx = Math.max(rect.x0 - x, 0, x - rect.x1);
    const dy = Math.max(rect.y0 - y, 0, y - rect.y1);
    const distance = Math.hypot(dx, dy);
    const local = OCCLUDER_MIN_WEIGHT + (1 - OCCLUDER_MIN_WEIGHT) * Math.min(1, distance / OCCLUDER_FALLOFF_PX);

    weight = Math.min(weight, local);
  }

  return weight;
}

/**
 * Openness-weighted usable area of the canvas, for deriving trace count from
 * *available* area instead of raw viewport area. Samples on a fixed grid
 * finer than the trace-count-driven cell tiling (see
 * `EFFECTIVE_AREA_SAMPLE_STEP` above) so small occluders aren't invisible to
 * the estimate.
 */
export function estimateEffectiveArea(width: number, height: number, occluders: readonly Occluder[]): number {
  if (occluders.length === 0) return width * height;

  const cols = Math.max(1, Math.round(width / EFFECTIVE_AREA_SAMPLE_STEP));
  const rows = Math.max(1, Math.round(height / EFFECTIVE_AREA_SAMPLE_STEP));
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  let total = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = (col + 0.5) * cellWidth;
      const cy = (row + 0.5) * cellHeight;

      total += cellWidth * cellHeight * occlusionWeightAt(cx, cy, occluders);
    }
  }

  return total;
}
