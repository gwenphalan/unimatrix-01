import { describe, expect, it } from "vitest";

import { createFrameBudgetProbe } from "../src/components/frame-budget.js";

function feed(probe: { record(ts: number): string }, deltas: number[], start = 0): string[] {
  const verdicts: string[] = [];
  let ts = start;
  verdicts.push(probe.record(ts)); // establishes prevTimestamp, always "pending"
  deltas.forEach((delta) => {
    ts += delta;
    verdicts.push(probe.record(ts));
  });
  return verdicts;
}

describe("createFrameBudgetProbe", () => {
  it("stays pending until enough post-warmup samples are collected", () => {
    const probe = createFrameBudgetProbe({ samples: 40, warmupSamples: 3 });
    const deltas = Array.from({ length: 39 }, () => 16.7);
    const verdicts = feed(probe, deltas);
    expect(verdicts.every((v) => v === "pending")).toBe(true);
  });

  it("steady ~60fps deltas (16.7ms) resolve to ok", () => {
    const probe = createFrameBudgetProbe({ samples: 40, warmupSamples: 3 });
    const deltas = Array.from({ length: 45 }, () => 16.7);
    const verdicts = feed(probe, deltas);
    expect(verdicts.at(-1)).toBe("ok");
  });

  it("steady ~30fps deltas (33.3ms) resolve to ok (a real 30Hz panel isn't punished)", () => {
    const probe = createFrameBudgetProbe({ samples: 40, warmupSamples: 3 });
    const deltas = Array.from({ length: 45 }, () => 33.3);
    const verdicts = feed(probe, deltas);
    expect(verdicts.at(-1)).toBe("ok");
  });

  it("steady 50ms deltas (uniformly slow device) resolve to over via the baseline arm", () => {
    const probe = createFrameBudgetProbe({ samples: 40, warmupSamples: 3 });
    const deltas = Array.from({ length: 45 }, () => 50);
    const verdicts = feed(probe, deltas);
    expect(verdicts.at(-1)).toBe("over");
  });

  it("16.7ms baseline with 60% of frames dropped to 50ms resolves to over via the ratio arm", () => {
    const probe = createFrameBudgetProbe({ samples: 40, warmupSamples: 3 });
    // 3 warmup deltas (discarded) + 40 counted deltas, 24 of them (60%) at
    // 50ms — needs the full warmup+samples length to actually reach a
    // verdict, not just 40 raw deltas.
    const warmup = [16.7, 16.7, 16.7];
    const counted = Array.from({ length: 40 }, (_, i) => (i % 5 < 3 ? 50 : 16.7));
    const verdicts = feed(probe, [...warmup, ...counted]);
    expect(verdicts.at(-1)).toBe("over");
  });

  it("excludes warmup samples from the verdict window", () => {
    const probe = createFrameBudgetProbe({ samples: 5, warmupSamples: 3 });
    // 3 warmup deltas of 200ms (would blow any budget) followed by 5 clean 16.7ms deltas.
    const deltas = [200, 200, 200, 16.7, 16.7, 16.7, 16.7, 16.7];
    const verdicts = feed(probe, deltas);
    expect(verdicts.at(-1)).toBe("ok");
  });

  it("returns a cached verdict once resolved instead of re-evaluating", () => {
    const probe = createFrameBudgetProbe({ samples: 5, warmupSamples: 0 });
    const deltas = Array.from({ length: 5 }, () => 16.7);
    feed(probe, deltas);
    // Feed a run of terrible deltas after resolution; verdict must not flip.
    const after = feed(probe, [200, 200, 200]);
    expect(after.every((v) => v === "ok")).toBe(true);
  });
});
