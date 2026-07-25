export const GRID = 40;

export type Point = { x: number; y: number };
export type RoutePoint = Point & { corner: boolean };

export function mulberry32(seed: number): () => number {
  let state = seed | 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function cellKey(point: Point): string {
  return `${Math.round(point.x / GRID)},${Math.round(point.y / GRID)}`;
}

export function pathData(points: Point[]): string {
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

export function polylineLength(points: Point[]): number {
  let total = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Point;
    const point = points[i] as Point;
    total += Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y);
  }

  return total;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Expands a sparse, grid-snapped vertex polyline into one point per 40px
 * grid cell along it. `corner` is left `false` here — a single segment
 * can't tell whether it's a real bend without seeing its neighbors — so
 * callers finalize it with `recomputeCorners` once the body/route is
 * fully assembled.
 */
export function densify(points: Point[]): RoutePoint[] {
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
export function recomputeCorners(points: RoutePoint[]): RoutePoint[] {
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

export function pointAtIndex(route: RoutePoint[], index: number): RoutePoint {
  const clamped = Math.max(0, Math.min(route.length - 1, index));
  const lo = Math.floor(clamped);
  const hi = Math.min(route.length - 1, lo + 1);
  const frac = clamped - lo;
  const p0 = route[lo] as RoutePoint;
  const p1 = route[hi] as RoutePoint;

  if (frac === 0) return { x: p0.x, y: p0.y, corner: p0.corner };

  return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac, corner: false };
}
