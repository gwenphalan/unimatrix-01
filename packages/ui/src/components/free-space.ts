import { GRID, type Point } from "./grid-math.js";
import type { BarrierField } from "./occlusion.js";

export type FreeComponent = {
  id: number;
  cells: Set<string>;
  size: number;
  bounds: { minCx: number; maxCx: number; minCy: number; maxCy: number };
  centerCell: string;
};

function cellPoint(key: string): Point {
  const [cx, cy] = key.split(",").map(Number) as [number, number];
  return { x: cx * GRID, y: cy * GRID };
}

/**
 * Distance-transform-ish pick: the component cell farthest (by 4-neighbour
 * BFS distance) from the component's own boundary — used as the tree root
 * seed for its forest, so each tree radiates from the most "interior" point
 * of its free region rather than an arbitrary corner.
 */
function pickCenterCell(cells: Set<string>): string {
  const boundary: string[] = [];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  cells.forEach((key) => {
    const [cx, cy] = key.split(",").map(Number) as [number, number];
    const isBoundary = directions.some(([dx, dy]) => !cells.has(`${cx + (dx as number)},${cy + (dy as number)}`));
    if (isBoundary) boundary.push(key);
  });

  if (boundary.length === 0) {
    return cells.values().next().value as string;
  }

  const distances = new Map<string, number>();
  let queue = boundary;
  boundary.forEach((key) => distances.set(key, 0));

  while (queue.length > 0) {
    const next: string[] = [];

    for (const key of queue) {
      const [cx, cy] = key.split(",").map(Number) as [number, number];
      const d = distances.get(key) as number;

      for (const [dx, dy] of directions) {
        const nKey = `${cx + (dx as number)},${cy + (dy as number)}`;
        if (!cells.has(nKey) || distances.has(nKey)) continue;
        distances.set(nKey, d + 1);
        next.push(nKey);
      }
    }

    queue = next;
  }

  let best = boundary[0] as string;
  let bestDistance = -1;

  distances.forEach((distance, key) => {
    if (distance > bestDistance) {
      bestDistance = distance;
      best = key;
    }
  });

  return best;
}

/**
 * 4-neighbour flood fill of every unblocked lattice cell within the same
 * 1-cell-inset canvas bounds `clampToLattice` uses, split into connected
 * components and sorted by size descending. A hard-barrier occluder can
 * split the free canvas into disjoint regions (e.g. a full-width bar) —
 * this is what lets `trace-generation.ts` grow one tree per region instead
 * of one tree straddling a wall it can't cross.
 */
export function findFreeComponents(field: BarrierField, width: number, height: number): FreeComponent[] {
  const maxCx = Math.max(1, Math.round(width / GRID) - 1);
  const maxCy = Math.max(1, Math.round(height / GRID) - 1);
  const visited = new Set<string>();
  const components: FreeComponent[] = [];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let nextId = 0;

  for (let cx = 1; cx <= maxCx; cx += 1) {
    for (let cy = 1; cy <= maxCy; cy += 1) {
      const startKey = `${cx},${cy}`;
      if (visited.has(startKey) || field.cells.has(startKey)) continue;

      const cells = new Set<string>();
      let minCx = cx;
      let maxCxSeen = cx;
      let minCy = cy;
      let maxCySeen = cy;
      const stack = [startKey];
      visited.add(startKey);

      while (stack.length > 0) {
        const key = stack.pop() as string;
        cells.add(key);
        const [kx, ky] = key.split(",").map(Number) as [number, number];
        minCx = Math.min(minCx, kx);
        maxCxSeen = Math.max(maxCxSeen, kx);
        minCy = Math.min(minCy, ky);
        maxCySeen = Math.max(maxCySeen, ky);

        for (const [dx, dy] of directions) {
          const nx = kx + (dx as number);
          const ny = ky + (dy as number);
          if (nx < 1 || nx > maxCx || ny < 1 || ny > maxCy) continue;
          const nKey = `${nx},${ny}`;
          if (visited.has(nKey) || field.cells.has(nKey)) continue;
          visited.add(nKey);
          stack.push(nKey);
        }
      }

      components.push({
        id: nextId,
        cells,
        size: cells.size,
        bounds: { minCx, maxCx: maxCxSeen, minCy, maxCy: maxCySeen },
        centerCell: pickCenterCell(cells),
      });
      nextId += 1;
    }
  }

  return components.sort((a, b) => b.size - a.size);
}

/**
 * Slots-per-component allocation, proportional to size, with at least one
 * slot for any component holding at least `minCellsPerTree` cells (so a
 * viable pocket of free space always gets its own tree rather than being
 * rounded down to zero) and any remainder folded into the largest
 * component. Always sums to exactly `count`.
 */
export function allocateSlots(components: readonly FreeComponent[], count: number, minCellsPerTree: number): number[] {
  if (components.length === 0 || count <= 0) return components.map(() => 0);

  const eligible = components.map((c) => c.size >= minCellsPerTree);
  const totalSize = components.reduce((sum, c) => sum + c.size, 0) || 1;
  const slots = components.map((c, i) => (eligible[i] ? Math.max(1, Math.floor((c.size / totalSize) * count)) : 0));

  let assigned = slots.reduce((sum, n) => sum + n, 0);

  // Nothing eligible (every component smaller than the floor): fall back to
  // giving every slot to the single largest component rather than returning
  // an all-zero allocation that would silently drop the count contract.
  if (assigned === 0 && components.length > 0) {
    slots[0] = count;
    return slots;
  }

  let largestIndex = 0;
  components.forEach((c, i) => {
    if (c.size > (components[largestIndex] as FreeComponent).size) largestIndex = i;
  });

  if (assigned < count) {
    slots[largestIndex] = (slots[largestIndex] as number) + (count - assigned);
  } else if (assigned > count) {
    let excess = assigned - count;
    for (let i = slots.length - 1; i >= 0 && excess > 0; i -= 1) {
      if (i === largestIndex) continue;
      const reducible = Math.min(excess, (slots[i] as number) - (eligible[i] ? 1 : 0));
      if (reducible <= 0) continue;
      slots[i] = (slots[i] as number) - reducible;
      excess -= reducible;
    }
    if (excess > 0) {
      slots[largestIndex] = Math.max(0, (slots[largestIndex] as number) - excess);
    }
  }

  assigned = slots.reduce((sum, n) => sum + n, 0);
  if (assigned !== count) {
    slots[largestIndex] = (slots[largestIndex] as number) + (count - assigned);
  }

  return slots;
}

export function cellKeyToPoint(key: string): Point {
  return cellPoint(key);
}
