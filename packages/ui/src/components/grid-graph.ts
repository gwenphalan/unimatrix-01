import { GRID, type Point, cellKey } from "./grid-math.js";

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
export class GridGraph {
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

  /** Test-support only: true if `x` and `y` have been unioned into the same
   * component (production code no longer needs this — generation is acyclic
   * by construction, see `trace-generation.ts`). */
  sameComponent(x: string, y: string): boolean {
    return this.find(x) === this.find(y);
  }

  /** Test-support only: number of distinct components across every point
   * this graph has ever seen. */
  componentCount(): number {
    const roots = new Set<string>();
    for (const key of this.parent.keys()) roots.add(this.find(key));
    return roots.size;
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
