import { type Point } from "./grid-math.js";

/**
 * How far behind an idle packet its glowing trail reaches, in px. Kept under
 * two grid cells so a trail never spans more than one corner — a longer tail
 * reads as a smear rather than a moving charge.
 */
export const TRAIL_LENGTH_PX = 72;

/**
 * Number of sub-paths a trail is drawn as. SVG strokes can't taper, so the
 * taper is faked by slicing the trail into this many equal-length pieces and
 * giving each its own (decreasing) width and opacity. Every slice follows the
 * traversed polyline, so the taper bends around corners for free.
 */
export const TRAIL_SEGMENTS = 6;

/**
 * A jump larger than this between consecutive samples means the trail's
 * history no longer describes one continuous walk — a pooled slot was reused
 * by a freshly spawned packet, or the packet graph was rebuilt under it. The
 * history is dropped rather than splicing the old tail onto the new head and
 * drawing a streak across the field.
 */
export const TRAIL_MAX_STEP_PX = 60;

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineArcLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1] as Point, points[i] as Point);
  }
  return total;
}

/**
 * Appends a new head sample to a trail history and trims the tail back to
 * `maxLength` of arc length — by distance walked, not by frame count, so a
 * trail is the same physical length regardless of frame rate or packet speed.
 *
 * The history is stored head-first (index 0 is the packet's current
 * position). Samples that merely continue the current direction replace the
 * head instead of extending the array, so a history holds one vertex per real
 * corner plus the head no matter how long the straight run is.
 *
 * Returns a new array, or the input unchanged when nothing moved.
 */
export function pushTrailPoint(
  trail: readonly Point[],
  point: Point,
  maxLength: number = TRAIL_LENGTH_PX,
  maxStep: number = TRAIL_MAX_STEP_PX,
): Point[] {
  const head = trail[0];

  if (!head) return [point];
  if (head.x === point.x && head.y === point.y) return trail as Point[];
  // Discontinuity: this is a different walk, not a continuation of this one.
  if (distance(head, point) > maxStep) return [point];

  const second = trail[1];
  const collinear =
    second !== undefined &&
    Math.sign(head.x - second.x) === Math.sign(point.x - head.x) &&
    Math.sign(head.y - second.y) === Math.sign(point.y - head.y);
  const extended: Point[] = collinear ? [point, ...trail.slice(1)] : [point, ...trail];

  let walked = 0;
  for (let i = 1; i < extended.length; i += 1) {
    const a = extended[i - 1] as Point;
    const b = extended[i] as Point;
    const length = distance(a, b);

    if (walked + length >= maxLength) {
      return [...extended.slice(0, i), lerp(a, b, (maxLength - walked) / length)];
    }

    walked += length;
  }

  return extended;
}

/**
 * The sub-polyline of `points` between two arc-length offsets, with the cut
 * ends interpolated exactly onto the offsets. Every interior vertex in range
 * is preserved, which is what keeps a slice bent around a corner it spans.
 */
export function slicePolyline(points: readonly Point[], from: number, to: number): Point[] {
  if (points.length < 2 || to <= from) return [];

  const out: Point[] = [];
  let walked = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const length = distance(a, b);
    if (length === 0) continue;

    const start = walked;
    const end = walked + length;
    walked = end;

    if (end <= from || start >= to) continue;

    const t0 = Math.max(0, (from - start) / length);
    const t1 = Math.min(1, (to - start) / length);

    if (out.length === 0) out.push(lerp(a, b, t0));
    out.push(lerp(a, b, t1));
  }

  return out;
}

/**
 * Splits a trail history into `count` equal-arc-length slices ordered
 * head-first, so slice 0 is the brightest/widest piece at the packet itself
 * and the last is the faintest at the tail. A slice shorter than two points
 * comes back empty and its element is simply left hidden.
 */
export function trailSlices(trail: readonly Point[], count: number = TRAIL_SEGMENTS): Point[][] {
  if (trail.length < 2 || count < 1) return [];

  const total = polylineArcLength(trail);
  if (total === 0) return [];

  const step = total / count;
  const slices: Point[][] = [];

  for (let i = 0; i < count; i += 1) {
    slices.push(slicePolyline(trail, i * step, (i + 1) * step));
  }

  return slices;
}
