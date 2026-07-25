import { describe, expect, it } from "vitest";

import { GridGraph } from "../src/components/grid-graph.js";
import { cellKey, densify, recomputeCorners } from "../src/components/grid-math.js";
import type { Occluder } from "../src/components/occlusion.js";
import { generateTraces } from "../src/components/trace-generation.js";

// Reuses the old single hardcoded keep-out rect (pre-Session-C's fixed
// 14–86%/10–78% formula) as one continuity occluder case, alongside a bare
// `occluders: []` baseline and a couple of multi-occluder/edge-count cases.
const SCENARIOS: { width: number; height: number; seed: number; count: number; occluders: Occluder[] }[] = [
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

describe("generateTraces invariants (circuit-field-plan.md 'Hard invariants')", () => {
  for (const { width, height, seed, count, occluders } of SCENARIOS) {
    const label = `${width}x${height} seed=${seed} count=${count} occluders=${occluders.length}`;
    const { traces, adjacency } = generateTraces(width, height, seed, occluders, count);

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

      it("never closes a loop, and forms a single connected component", () => {
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
          expect(graph.componentCount()).toBe(1);
        }
      });

      it("forms a single spanning tree: edges == vertices - 1", () => {
        // A guarantee the old greedy/rejection-based generator could never
        // make (it could produce disconnected forests via fallback stubs) —
        // acyclic-by-construction generation should satisfy this exactly,
        // every time, for any occluder configuration.
        const vertices = new Set<string>();
        let edges = 0;

        traces.forEach((trace) => {
          const dense = densify(trace.points);
          dense.forEach((point) => vertices.add(cellKey(point)));
          edges += Math.max(0, dense.length - 1);
        });

        if (traces.length > 0) {
          expect(edges).toBe(vertices.size - 1);
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

      it("has non-negative depth, rooted at branch 0", () => {
        if (traces.length === 0) return;
        expect(traces[0]!.depth).toBe(0);
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

describe("regression: near-total occlusion no longer produces degenerate stubs", () => {
  const width = 1440;
  const height = 900;
  // Covers nearly the entire viewport — the scenario that used to starve the
  // old rejection-based generator into fallback stubs/degenerates.
  const occluders: Occluder[] = [{ x0: 10, y0: 10, x1: width - 10, y1: height - 10 }];
  const { traces } = generateTraces(width, height, 7, occluders, 24);

  it("still yields exactly `count` traces with no zero-length degenerate stubs", () => {
    expect(traces).toHaveLength(24);
    traces.forEach((trace) => {
      expect(trace.length).toBeGreaterThan(0);
    });
  });
});
