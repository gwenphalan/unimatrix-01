import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCasePool } from "@/features/algorithms/use-case-pool";
import { readCasePool, readDrillPoolMode } from "@/lib/pool-storage";

describe("useCasePool", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts in the manual mode when nothing is stored", () => {
    const { result } = renderHook(() => useCasePool("oll"));

    expect(result.current.onlyLearned).toBe(false);
  });

  it("seeds onlyLearned from a stored only-learned mode", () => {
    window.localStorage.setItem("cflop:pool-mode:oll", "only-learned");

    const { result } = renderHook(() => useCasePool("oll"));

    expect(result.current.onlyLearned).toBe(true);
  });

  it("enableOnlyLearned applies the changes and turns the mode on", () => {
    const { result } = renderHook(() => useCasePool("oll"));

    act(() => {
      result.current.enableOnlyLearned({ "oll-1": true, "oll-2": false });
    });

    expect(result.current.onlyLearned).toBe(true);
    expect(result.current.pool).toEqual({ "oll-1": true, "oll-2": false });
    expect(readDrillPoolMode("oll")).toBe("only-learned");
  });

  it("clearOnlyLearned turns the mode off without touching the pool", () => {
    const { result } = renderHook(() => useCasePool("oll"));

    act(() => {
      result.current.enableOnlyLearned({ "oll-1": true });
    });
    act(() => {
      result.current.clearOnlyLearned();
    });

    expect(result.current.onlyLearned).toBe(false);
    expect(readCasePool("oll")).toEqual({ "oll-1": true });
  });

  it("setEnabled flips an active only-learned mode back to manual", () => {
    const { result } = renderHook(() => useCasePool("oll"));

    act(() => {
      result.current.enableOnlyLearned({ "oll-1": true });
    });
    act(() => {
      result.current.setEnabled("oll-2", false);
    });

    expect(result.current.onlyLearned).toBe(false);
    expect(readDrillPoolMode("oll")).toBe("manual");
  });

  it("setManyEnabled flips an active only-learned mode back to manual", () => {
    const { result } = renderHook(() => useCasePool("oll"));

    act(() => {
      result.current.enableOnlyLearned({ "oll-1": true });
    });
    act(() => {
      result.current.setManyEnabled({ "oll-2": false });
    });

    expect(result.current.onlyLearned).toBe(false);
    expect(readDrillPoolMode("oll")).toBe("manual");
  });
});
