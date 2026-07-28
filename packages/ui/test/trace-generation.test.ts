import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { GridGraph } from "../src/components/grid-graph.js";
import { cellKey, densify, recomputeCorners } from "../src/components/grid-math.js";
import { findFreeComponents } from "../src/components/free-space.js";
import {
  type Occluder,
  buildBarrierField,
  isCellBlocked,
  pointInSoftBarrier,
  segmentCrossesBarrier,
} from "../src/components/occlusion.js";
import { generateTraces } from "../src/components/trace-generation.js";

// Reuses the old single hardcoded keep-out rect (pre-Session-C's fixed
// 14–86%/10–78% formula) as one continuity occluder case, alongside a bare
// `occluders: []` baseline and a couple of multi-occluder/edge-count cases.
const SCENARIOS: {
  width: number;
  height: number;
  seed: number;
  count: number;
  occluders: Occluder[];
}[] = [
  { width: 1440, height: 900, seed: 1, count: 24, occluders: [] },
  {
    width: 1440,
    height: 900,
    seed: 2,
    count: 24,
    occluders: [{ x0: 1440 * 0.14, y0: 900 * 0.1, x1: 1440 * 0.86, y1: 900 * 0.78 }],
  },
  { width: 375, height: 812, seed: 3, count: 14, occluders: [] },
  {
    width: 2560,
    height: 1440,
    seed: 4,
    count: 48,
    occluders: [
      { x0: 0, y0: 0, x1: 2560, y1: 200 },
      { x0: 0, y0: 1240, x1: 2560, y1: 1440 },
    ],
  },
  { width: 1440, height: 900, seed: 5, count: 1, occluders: [] },
  { width: 1440, height: 900, seed: 6, count: 2, occluders: [] },
];

describe("generateTraces invariants", () => {
  for (const { width, height, seed, count, occluders } of SCENARIOS) {
    const label = `${width}x${height} seed=${seed} count=${count} occluders=${occluders.length}`;
    const barriers = buildBarrierField(occluders);
    const { traces, adjacency, roots } = generateTraces(width, height, seed, barriers, count);

    describe(label, () => {
      it("returns exactly `count` traces with stable slot identity", () => {
        expect(traces).toHaveLength(count);
        traces.forEach((trace, i) => {
          expect(trace.id).toBe(`t${i}`);
        });
      });

      it("emits only axis-aligned segments (no diagonals)", () => {
        traces.forEach((trace) => {
          for (let i = 1; i < trace.points.length; i += 1) {
            const prev = trace.points[i - 1]!;
            const point = trace.points[i]!;
            const dx = point.x - prev.x;
            const dy = point.y - prev.y;

            expect(dx === 0 || dy === 0).toBe(true);
          }
        });
      });

      it("keeps every vertex on the GRID lattice", () => {
        traces.forEach((trace) => {
          trace.points.forEach((point) => {
            expect(point.x % 40).toBe(0);
            expect(point.y % 40).toBe(0);
          });
        });
      });

      it("never routes a vertex or densified segment cell inside a barrier", () => {
        traces.forEach((trace) => {
          const dense = densify(trace.points);
          dense.forEach((point) => {
            expect(isCellBlocked(barriers, point)).toBe(false);
          });
        });
      });

      it("never closes a loop, and forms exactly one connected component per tree", () => {
        // Replays every trace's edges through a fresh GridGraph — if this
        // ever returns null, a cycle slipped past construction (a trace
        // retracing itself, two traces retracing the same stretch, or a
        // cycle only visible in the combined shape of several traces).
        const graph = new GridGraph();

        traces.forEach((trace) => {
          const trial = graph.tryAdd(trace.points);
          expect(trial, `trace ${trace.id} closed a loop`).not.toBeNull();
          if (trial) graph.adopt(trial);
        });

        if (traces.length > 0) {
          expect(graph.componentCount()).toBe(roots.length);
        }
      });

      it("forms a forest: edges == vertices - treeCount", () => {
        // A guarantee the old greedy/rejection-based generator could never
        // make (it could produce disconnected forests via fallback stubs) —
        // acyclic-by-construction generation should satisfy this exactly,
        // every time, for any barrier configuration, now generalized from a
        // single spanning tree to one tree per free component.
        const vertices = new Set<string>();
        let edges = 0;

        traces.forEach((trace) => {
          const dense = densify(trace.points);
          dense.forEach((point) => vertices.add(cellKey(point)));
          edges += Math.max(0, dense.length - 1);
        });

        if (traces.length > 0) {
          expect(edges).toBe(vertices.size - roots.length);
        }
      });

      it("marks a via only at a real bend, never mid-straight-run", () => {
        traces.forEach((trace) => {
          const body = recomputeCorners(densify(trace.points));

          body.forEach((point, idx) => {
            if (idx === 0 || idx === body.length - 1 || !point.corner) return;

            const prev = body[idx - 1]!;
            const next = body[idx + 1]!;
            const inDirection = { x: Math.sign(point.x - prev.x), y: Math.sign(point.y - prev.y) };
            const outDirection = { x: Math.sign(next.x - point.x), y: Math.sign(next.y - point.y) };

            expect(inDirection).not.toEqual(outDirection);
          });
        });
      });

      it("has non-negative depth, each tree rooted at depth 0", () => {
        if (traces.length === 0) return;
        roots.forEach((rootIndex) => {
          expect(traces[rootIndex]!.depth).toBe(0);
        });
        traces.forEach((trace) => {
          expect(trace.depth).toBeGreaterThanOrEqual(0);
        });
      });

      it("adjacency covers every trace's own consecutive points", () => {
        traces.forEach((trace) => {
          const dense = densify(trace.points);

          for (let i = 1; i < dense.length; i += 1) {
            const a = cellKey(dense[i - 1]!);
            const b = cellKey(dense[i]!);

            expect(adjacency.get(a)?.has(b)).toBe(true);
            expect(adjacency.get(b)?.has(a)).toBe(true);
          }
        });
      });
    });
  }
});

describe("forest generation under a partitioned viewport", () => {
  const width = 1440;
  const height = 900;
  // A full-width bar across the middle severs the canvas into two disjoint
  // free regions under 4-connectivity — no single tree can reach both, so
  // this is the scenario a single-spanning-tree generator could never
  // satisfy the count contract on.
  const occluders: Occluder[] = [{ x0: 0, y0: 400, x1: width, y1: 500 }];
  const barriers = buildBarrierField(occluders);
  const { traces, roots } = generateTraces(width, height, 9, barriers, 24);

  it("still yields exactly `count` traces", () => {
    expect(traces).toHaveLength(24);
  });

  it("grows at least two independent trees, one per side of the bar", () => {
    expect(roots.length).toBeGreaterThanOrEqual(2);
  });

  it("never routes a vertex inside the barrier", () => {
    traces.forEach((trace) => {
      densify(trace.points).forEach((point) => {
        expect(isCellBlocked(barriers, point)).toBe(false);
      });
    });
  });
});

describe("regression: heavy (but not total) occlusion no longer produces degenerate stubs", () => {
  const width = 1440;
  const height = 900;
  // A large central occluder leaving a real free border on every edge
  // (unlike a near-total occluder, which would legitimately barricade the
  // entire lattice under hard barriers — see the "fully barricaded canvas"
  // case below) — the scenario that used to starve the old rejection-based
  // generator into fallback stubs/degenerates.
  const occluders: Occluder[] = [{ x0: 120, y0: 120, x1: width - 120, y1: height - 120 }];
  const barriers = buildBarrierField(occluders);
  const { traces } = generateTraces(width, height, 7, barriers, 24);

  it("still yields exactly `count` traces with no zero-length degenerate stubs", () => {
    expect(traces).toHaveLength(24);
    traces.forEach((trace) => {
      expect(trace.length).toBeGreaterThan(0);
    });
  });
});

describe("regression: a fully barricaded canvas degrades gracefully", () => {
  // `ReturnType<typeof vi.spyOn>` degraded to `any` under vitest 4, which the
  // no-unsafe-* rules correctly rejected. `MockInstance` names the type directly
  // and keeps `console.warn`'s signature attached.
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns no traces and warns, rather than routing through a barrier", () => {
    const width = 400;
    const height = 300;
    const occluders: Occluder[] = [{ x0: -100, y0: -100, x1: width + 100, y1: height + 100 }];
    const barriers = buildBarrierField(occluders);
    const { traces, roots } = generateTraces(width, height, 11, barriers, 24);

    expect(traces).toHaveLength(0);
    expect(roots).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("soft (ink) barriers", () => {
  const width = 1440;
  const height = 900;
  // Eight scattered lines of text, each 24px tall — thinner than the 40px
  // lattice pitch, so no lattice point sits inside most of them and only the
  // exact segment test can enforce them.
  const inkLines: Occluder[] = Array.from({ length: 8 }, (_, i) => ({
    x0: 200 + (i % 2) * 320,
    y0: 100 + i * 90,
    x1: 700 + (i % 2) * 320,
    y1: 124 + i * 90,
    kind: "soft" as const,
  }));
  const barriers = buildBarrierField(inkLines);
  const { traces } = generateTraces(width, height, 21, barriers, 24);

  it("leaves the free-space flood fill untouched, so ink cannot split the canvas", () => {
    expect(findFreeComponents(barriers, width, height)).toHaveLength(1);
  });

  it("still yields exactly `count` traces", () => {
    expect(traces).toHaveLength(24);
  });

  /**
   * The regression test for `walkFromStart`, which rejected only on
   * self-collision and leaving the free component and never tested segments
   * against the barrier field at all. Since soft rects deliberately never
   * enter `cells`, branch 0 of every tree in every component would otherwise
   * grow straight through ink on every page — and the bug would read as a
   * classifier defect, nowhere near this file.
   */
  it("routes no segment through ink", () => {
    traces.forEach((trace) => {
      for (let i = 1; i < trace.points.length; i += 1) {
        const prev = trace.points[i - 1]!;
        const point = trace.points[i]!;
        expect(segmentCrossesBarrier(barriers, prev, point)).toBe(false);
      }
    });
  });

  it("places no vertex on ink, so no pad or via lands on a glyph", () => {
    traces.forEach((trace) => {
      densify(trace.points).forEach((point) => {
        expect(pointInSoftBarrier(barriers, point)).toBe(false);
      });
    });
  });
});

/**
 * The layout this repo actually ships on an article route: one hard panel
 * (`.site-panel max-w-4xl`) with the page's remaining ink in the gutters beside
 * it. Swept over seeds rather than pinned to one, because the anchor search is
 * seed-sensitive and a single lucky seed would hide a regression.
 *
 * Two invariants, deliberately at different strengths. Hard-barrier clearance is
 * absolute and must never regress. Ink clearance is best-effort by design — the
 * ink-blind corridor tier exists so a trace is never dropped and no warning is
 * emitted — but on this layout the tiered ladder reaches zero, so zero is what
 * gets pinned. If a future change trades ink fidelity for something else, this
 * is the test that should have to be edited deliberately.
 */
describe("article panel with gutter ink, swept across seeds", () => {
  const width = 1440;
  const height = 900;
  const occluders: Occluder[] = [
    { x0: 272, y0: 0, x1: 1168, y1: height, kind: "hard" },
    ...Array.from({ length: 6 }, (_, i) => ({
      x0: 40,
      y0: 120 + i * 70,
      x1: 240,
      y1: 144 + i * 70,
      kind: "soft" as const,
    })),
  ];
  const barriers = buildBarrierField(occluders);

  for (const seed of [31, 32, 33, 34, 35]) {
    describe(`seed=${seed}`, () => {
      const { traces } = generateTraces(width, height, seed, barriers, 24);

      it("yields exactly `count` traces with no degenerate stubs", () => {
        expect(traces).toHaveLength(24);
        traces.forEach((trace) => {
          expect(trace.length).toBeGreaterThan(0);
        });
      });

      it("never violates a hard barrier", () => {
        traces.forEach((trace) => {
          densify(trace.points).forEach((point) => {
            expect(isCellBlocked(barriers, point)).toBe(false);
          });
        });
      });

      it("stays clear of ink as well", () => {
        traces.forEach((trace) => {
          for (let i = 1; i < trace.points.length; i += 1) {
            expect(segmentCrossesBarrier(barriers, trace.points[i - 1]!, trace.points[i]!)).toBe(
              false,
            );
          }
        });
      });
    });
  }
});

describe("soft barriers degrade silently rather than warning", () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  /**
   * Ink can make a corridor genuinely impossible, and the honest answer there
   * is a route that clips a glyph — a cosmetic miss. It must never be a
   * console warning: `attachRoute`'s canary means "a component's own footprint
   * was unreachable from itself", which is a real defect, and a page dense
   * enough in text would otherwise bury it under a warn storm.
   */
  it("produces traces without warning under near-total ink coverage", () => {
    const width = 1440;
    const height = 900;
    const ink: Occluder[] = Array.from({ length: 20 }, (_, i) => ({
      x0: 0,
      y0: i * 45,
      x1: width,
      y1: i * 45 + 38,
      kind: "soft" as const,
    }));
    const barriers = buildBarrierField(ink);
    const { traces } = generateTraces(width, height, 23, barriers, 24);

    expect(traces).toHaveLength(24);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
