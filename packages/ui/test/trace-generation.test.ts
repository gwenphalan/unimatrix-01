import { describe, expect, it } from "vitest";

import { GridGraph } from "../src/components/grid-graph.js";
import { GRID, densify, recomputeCorners } from "../src/components/grid-math.js";
import { type KeepOut, generateTraces } from "../src/components/trace-generation.js";

// Mirrors the keep-out formula in CircuitField's `targetTraces` memo
// (packages/ui/src/components/circuit-field.tsx) — kept local rather than
// exported, since only this test needs to reproduce it.
function keepOutFor(width: number, height: number): KeepOut {
  return {
    x0: width * 0.14,
    y0: height * 0.1,
    x1: width * 0.86,
    y1: height * 0.78,
  };
}

const SCENARIOS = [
  { width: 1440, height: 900, seed: 1, count: 24 },
  { width: 1440, height: 900, seed: 2, count: 24 },
  { width: 375, height: 812, seed: 3, count: 14 },
  { width: 2560, height: 1440, seed: 4, count: 48 },
];

describe("generateTraces invariants (circuit-field-plan.md 'Hard invariants')", () => {
  for (const { width, height, seed, count } of SCENARIOS) {
    const label = `${width}x${height} seed=${seed} count=${count}`;
    const traces = generateTraces(width, height, seed, keepOutFor(width, height), count);

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
            expect(point.x % GRID).toBe(0);
            expect(point.y % GRID).toBe(0);
          });
        });
      });

      it("never closes a loop across any trace, or the combined shape of several traces", () => {
        // Replays the same edges in the same order `generateTraces` added
        // them through its own shared GridGraph — if this ever returns
        // null, a cycle slipped past the real generator's own check.
        const graph = new GridGraph();

        traces.forEach((trace) => {
          const trial = graph.tryAdd(trace.points);
          expect(trial, `trace ${trace.id} closed a loop`).not.toBeNull();
          if (trial) graph.adopt(trial);
        });
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
    });
  }
});
