import { describe, expect, it } from "vitest";

import { GRID } from "../src/components/grid-math.js";
import { type Occluder, buildBarrierField } from "../src/components/occlusion.js";
import { allocateSlots, findFreeComponents } from "../src/components/free-space.js";

describe("findFreeComponents", () => {
  it("returns a single component covering the interior when there are no occluders", () => {
    const width = GRID * 10;
    const height = GRID * 10;
    const field = buildBarrierField([]);
    const components = findFreeComponents(field, width, height);

    expect(components).toHaveLength(1);
    expect(components[0]?.size).toBe((10 - 1) * (10 - 1));
  });

  it("splits into two components across a full-width bar", () => {
    const width = GRID * 20;
    const height = GRID * 20;
    const bar: Occluder = {
      x0: 0,
      y0: height / 2 - GRID / 2,
      x1: width,
      y1: height / 2 + GRID / 2,
    };
    const field = buildBarrierField([bar]);
    const components = findFreeComponents(field, width, height);

    expect(components.length).toBeGreaterThanOrEqual(2);
    // Sorted by size descending.
    for (let i = 1; i < components.length; i += 1) {
      expect(components[i - 1]!.size).toBeGreaterThanOrEqual(components[i]!.size);
    }
  });

  it("picks a center cell that is itself a member of the component", () => {
    const width = GRID * 10;
    const height = GRID * 10;
    const field = buildBarrierField([]);
    const [component] = findFreeComponents(field, width, height);

    expect(component).toBeDefined();
    expect(component?.cells.has(component.centerCell)).toBe(true);
  });

  it("returns no components when the whole canvas is barricaded", () => {
    const width = GRID * 5;
    const height = GRID * 5;
    const field = buildBarrierField([
      { x0: -1000, y0: -1000, x1: width + 1000, y1: height + 1000 },
    ]);

    expect(findFreeComponents(field, width, height)).toHaveLength(0);
  });
});

describe("allocateSlots", () => {
  it("sums to exactly count across multiple components", () => {
    const field = buildBarrierField([]);
    const components = findFreeComponents(field, GRID * 20, GRID * 20);
    // Synthesize a second, smaller component by hand for a genuine
    // multi-component allocation case.
    const big = components[0]!;
    const small = { ...big, id: 1, size: 5, cells: new Set(Array.from(big.cells).slice(0, 5)) };
    const slots = allocateSlots([big, small], 24, 8);

    expect(slots.reduce((sum, n) => sum + n, 0)).toBe(24);
  });

  it("gives zero slots to a component below the minimum-cells floor", () => {
    const field = buildBarrierField([]);
    const [big] = findFreeComponents(field, GRID * 20, GRID * 20);
    const tiny = { ...big!, id: 1, size: 3, cells: new Set(Array.from(big!.cells).slice(0, 3)) };
    const slots = allocateSlots([big!, tiny], 24, 8);

    expect(slots[1]).toBe(0);
    expect(slots[0]).toBe(24);
  });

  it("returns an all-zero allocation for zero count", () => {
    const field = buildBarrierField([]);
    const components = findFreeComponents(field, GRID * 10, GRID * 10);
    expect(allocateSlots(components, 0, 8)).toEqual([0]);
  });

  it("falls back to the largest component when nothing clears the floor", () => {
    const field = buildBarrierField([]);
    const [big] = findFreeComponents(field, GRID * 10, GRID * 10);
    const tiny1 = { ...big!, id: 1, size: 2, cells: new Set(Array.from(big!.cells).slice(0, 2)) };
    const tiny2 = { ...big!, id: 2, size: 1, cells: new Set(Array.from(big!.cells).slice(0, 1)) };
    const slots = allocateSlots([tiny1, tiny2], 10, 8);

    expect(slots.reduce((sum, n) => sum + n, 0)).toBe(10);
    expect(slots[0]).toBe(10);
  });

  /**
   * `generateTraces` renders exactly one path element per requested trace, so
   * both halves of the contract are load-bearing: a total below `count`
   * leaves painted-but-empty path slots, a total above it generates traces
   * with no element to render, and a negative entry silently swallows a
   * component's whole allocation. The eligible-outnumber-slots shapes below
   * are the ones that used to break it — every eligible component floored to
   * one slot over-assigns past `count`, and nothing could then be reduced.
   */
  it("keeps the sum-to-count and non-negative invariants when eligible components outnumber the slots", () => {
    const field = buildBarrierField([]);
    const [big] = findFreeComponents(field, GRID * 20, GRID * 20);
    const sized = (id: number, size: number) => ({
      ...big!,
      id,
      size,
      cells: new Set(Array.from(big!.cells).slice(0, size)),
    });

    const shapes: { components: ReturnType<typeof sized>[]; count: number }[] = [
      {
        components: [sized(0, 40), sized(1, 40), sized(2, 40), sized(3, 40), sized(4, 40)],
        count: 3,
      },
      { components: [sized(0, 400), sized(1, 12), sized(2, 12), sized(3, 12)], count: 2 },
      { components: [sized(0, 10), sized(1, 10)], count: 1 },
      { components: [sized(0, 900), sized(1, 10), sized(2, 10)], count: 3 },
      { components: [sized(0, 40), sized(1, 40), sized(2, 3)], count: 1 },
    ];

    for (const { components, count } of shapes) {
      const slots = allocateSlots(components, count, 8);

      expect(slots.reduce((sum, n) => sum + n, 0)).toBe(count);
      expect(slots.every((n) => n >= 0)).toBe(true);
    }
  });
});
