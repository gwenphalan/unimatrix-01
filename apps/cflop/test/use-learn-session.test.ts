import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import { orderedLearnCases } from "@/features/learn/learn-case-order";
import { useLearnSession } from "@/features/learn/use-learn-session";
import { readCasePool } from "@/lib/pool-storage";
import { readCaseProgress } from "@/lib/progress-storage";

const walkOrder = orderedLearnCases(groupCasesByGroup(getAlgorithmSet("pll")), {});
const [firstCase, secondCase] = walkOrder;
// A case late in the walk, so "the cursor moved to it" cannot be confused with "the cursor
// never moved off zero".
const lateCase = walkOrder[walkOrder.length - 1];

if (!firstCase || !secondCase || !lateCase || lateCase === firstCase) {
  throw new Error("The PLL walk must have several cases for these tests to mean anything.");
}

function markKnown(caseId: string) {
  window.localStorage.setItem("cflop:progress:pll", JSON.stringify({ [caseId]: "known" }));
}

describe("useLearnSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("walks from the start when no case was picked", () => {
    const { result } = renderHook(() => useLearnSession("pll"));

    expect(result.current.currentCase).toBe(firstCase);
    expect(result.current.learned).toBe(false);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoNext).toBe(true);
  });

  it("opens an unlearned picked case at its own place in the walk", () => {
    const { result } = renderHook(() => useLearnSession("pll", lateCase.id));

    expect(result.current.currentCase).toBe(lateCase);
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      result.current.back();
    });

    expect(result.current.currentCase).toBe(walkOrder[walkOrder.length - 2]);
  });

  it("shows a picked learned case with nowhere to navigate", () => {
    markKnown(lateCase.id);

    const { result } = renderHook(() => useLearnSession("pll", lateCase.id));

    expect(result.current.currentCase).toBe(lateCase);
    expect(result.current.learned).toBe(true);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoNext).toBe(false);

    // The walk has no position for it, so the arrows must not quietly move a hidden cursor.
    act(() => {
      result.current.next();
    });
    expect(result.current.currentCase).toBe(lateCase);
  });

  it("restores navigation on the unmarked case when it is handed back to the walk", () => {
    markKnown(lateCase.id);

    const { result } = renderHook(() => useLearnSession("pll", lateCase.id));

    act(() => {
      result.current.toggleLearned();
    });

    expect(readCaseProgress("pll")).toEqual({ [lateCase.id]: "new" });
    expect(result.current.learned).toBe(false);
    // Still on the same case, now with the walk under it rather than pinned outside it.
    expect(result.current.currentCase).toBe(lateCase);
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      result.current.back();
    });
    expect(result.current.currentCase).toBe(walkOrder[walkOrder.length - 2]);
  });

  it("drops a case out of the walk when it is marked learned", () => {
    const { result } = renderHook(() => useLearnSession("pll"));

    act(() => {
      result.current.toggleLearned();
    });

    expect(readCaseProgress("pll")).toEqual({ [firstCase.id]: "known" });
    expect(result.current.currentCase).toBe(secondCase);
  });

  describe("only-learned mode", () => {
    it("leaves the drill pool untouched when the mode is off", () => {
      const { result } = renderHook(() => useLearnSession("pll"));

      act(() => {
        result.current.toggleLearned();
      });

      expect(readCasePool("pll")).toEqual({});
    });

    it("mirrors a mark into the pool when the mode is on", () => {
      window.localStorage.setItem("cflop:pool-mode:pll", "only-learned");

      const { result } = renderHook(() => useLearnSession("pll"));

      act(() => {
        result.current.toggleLearned();
      });

      expect(readCasePool("pll")).toEqual({ [firstCase.id]: true });
    });

    it("mirrors an unmark as an explicit false when the mode is on", () => {
      markKnown(lateCase.id);
      window.localStorage.setItem("cflop:pool-mode:pll", "only-learned");

      const { result } = renderHook(() => useLearnSession("pll", lateCase.id));

      act(() => {
        result.current.toggleLearned();
      });

      expect(readCasePool("pll")).toEqual({ [lateCase.id]: false });
    });
  });
});
