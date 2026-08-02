import { describe, expect, it } from "vitest";

import type { AlgorithmCase } from "@/features/algorithms/types";
import type { DrillQueue, Random } from "@/features/trainer/drill-queue";
import { advanceDrillQueue, enabledCaseIds } from "@/features/trainer/drill-queue";
import type { CasePool } from "@/lib/pool-storage";

function makeCase(id: string, caseFrequency = 1): AlgorithmCase {
  return { algorithms: ["R U R' U'"], displayName: id, group: "Test", id, caseFrequency };
}

function idsUpTo(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `c${i}`);
}

/**
 * A deterministic stand-in for `Math.random`, cycling a fixed sequence. The point is only that
 * the shuffle is driven by injected values rather than the global generator - the assertions
 * below are about properties that must hold for every draw, not about one blessed order.
 */
function seededRandom(seed: number): Random {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Deals `count` cases, returning the ids in order. */
function deal(enabledIds: string[], count: number, random: Random): string[] {
  const dealt: string[] = [];
  let queue: DrillQueue | undefined;

  for (let i = 0; i < count; i += 1) {
    const step = advanceDrillQueue(queue, enabledIds, random);
    if (!step) throw new Error("expected a step");
    queue = step.queue;
    dealt.push(step.caseId);
  }

  return dealt;
}

describe("enabledCaseIds", () => {
  it("omits disabled cases", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const pool: CasePool = { a: false, b: false };

    expect(enabledCaseIds(cases, pool)).toEqual(["c"]);
  });

  it("treats cases with no recorded pool entry as enabled", () => {
    expect(enabledCaseIds([makeCase("a"), makeCase("b")], {})).toEqual(["a", "b"]);
  });
});

describe("advanceDrillQueue", () => {
  it("returns undefined when nothing is enabled", () => {
    expect(advanceDrillQueue(undefined, [], seededRandom(1))).toBeUndefined();
    expect(advanceDrillQueue(undefined, [], seededRandom(1))).toBeUndefined();
  });

  it("deals every enabled case exactly once per bag", () => {
    const ids = idsUpTo(12);
    const dealt = deal(ids, 12, seededRandom(7));

    expect([...dealt].sort()).toEqual([...ids].sort());
  });

  it("gives each case exactly one appearance per completed bag over many bags", () => {
    const ids = idsUpTo(9);
    const bags = 20;
    const dealt = deal(ids, ids.length * bags, seededRandom(42));

    for (const id of ids) {
      expect(dealt.filter((dealtId) => dealtId === id)).toHaveLength(bags);
    }

    // Per bag, not merely in total: a picker that dealt one case 40 times and another 0 times
    // across two bags would satisfy the totals above if the counts happened to average out.
    for (let bag = 0; bag < bags; bag += 1) {
      const block = dealt.slice(bag * ids.length, (bag + 1) * ids.length);
      expect(new Set(block).size).toBe(ids.length);
    }
  });

  it("keeps the last three of a bag out of the first three of the next", () => {
    const ids = idsUpTo(10);

    // Several seeds, because a single one can pass a seam rule by luck: with 10 cases the
    // chance of a clean seam without the guard is already better than even.
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
      const dealt = deal(ids, ids.length * 6, seededRandom(seed));

      for (let seam = 1; seam < 6; seam += 1) {
        const tail = dealt.slice(seam * ids.length - 3, seam * ids.length);
        const head = dealt.slice(seam * ids.length, seam * ids.length + 3);

        expect(head.filter((id) => tail.includes(id))).toEqual([]);
      }
    }
  });

  it("never repeats back to back once the pool has two cases", () => {
    for (const size of [2, 3, 4, 5, 6, 20]) {
      const dealt = deal(idsUpTo(size), size * 8, seededRandom(size * 11));

      for (let i = 1; i < dealt.length; i += 1) {
        expect(dealt[i]).not.toBe(dealt[i - 1]);
      }
    }
  });

  it("alternates a two-case pool, the only non-repeating order available", () => {
    const dealt = deal(["a", "b"], 8, seededRandom(3));

    expect(dealt).toEqual(
      dealt[0] === "a"
        ? ["a", "b", "a", "b", "a", "b", "a", "b"]
        : ["b", "a", "b", "a", "b", "a", "b", "a"],
    );
  });

  it("repeats the sole enabled case rather than stalling", () => {
    expect(deal(["a"], 4, seededRandom(9))).toEqual(["a", "a", "a", "a"]);
  });

  it("rebuilds the bag when a case is disabled mid-bag", () => {
    const random = seededRandom(17);
    const first = advanceDrillQueue(undefined, ["a", "b", "c", "d"], random);
    if (!first) throw new Error("expected a step");

    const afterDisable = advanceDrillQueue(first.queue, ["a", "b"], random);

    expect(afterDisable?.queue.order.sort()).toEqual(["a", "b"]);
    expect(["a", "b"]).toContain(afterDisable?.caseId);
  });

  it("rebuilds the bag when a case is enabled mid-bag, without waiting for it to run out", () => {
    const random = seededRandom(23);
    const first = advanceDrillQueue(undefined, ["a", "b", "c"], random);
    if (!first) throw new Error("expected a step");

    const afterEnable = advanceDrillQueue(first.queue, ["a", "b", "c", "d"], random);

    expect(afterEnable?.queue.order.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("still bars the just-dealt case when the rebuild came from a pool change", () => {
    const random = seededRandom(29);
    const ids = idsUpTo(8);
    const first = advanceDrillQueue(undefined, ids, random);
    if (!first) throw new Error("expected a step");

    const rebuilt = advanceDrillQueue(first.queue, [...ids, "extra"], random);

    expect(rebuilt?.caseId).not.toBe(first.caseId);
  });

  it("is pure, so a repeated call from the same state gives the same step", () => {
    // The consuming `setState` updater is invoked twice under StrictMode. Anything that made
    // the second invocation differ would deal - and discard - a case per press in dev.
    const ids = idsUpTo(6);
    const start = advanceDrillQueue(undefined, ids, seededRandom(5));
    if (!start) throw new Error("expected a step");

    const a = advanceDrillQueue(start.queue, ids, seededRandom(5));
    const b = advanceDrillQueue(start.queue, ids, seededRandom(5));

    expect(a).toEqual(b);
  });

  it("ignores caseFrequency, which belongs to Learn", () => {
    // Built from cases with wildly different figures and routed through `enabledCaseIds`, so
    // the whole case-to-id path a weighting bug could hide in is exercised - passing plain ids
    // straight to `deal` would make this a second copy of the exactly-once test above.
    const cases = [makeCase("a", 1), makeCase("b", 50), makeCase("c", 1), makeCase("d", 200)];
    const ids = enabledCaseIds(cases, {});
    const dealt = deal(ids, 40, seededRandom(31));

    // A weighted draw would over-represent whichever case carried the larger figure; a bag
    // deals every case the same number of times whatever the data says.
    for (const id of ids) {
      expect(dealt.filter((dealtId) => dealtId === id)).toHaveLength(10);
    }
  });
});
