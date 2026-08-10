import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDrillPoolMode,
  enableOnlyLearnedCases,
  isCaseEnabled,
  mirrorLearnedCaseToPool,
  readCasePool,
  readDrillPoolMode,
  setCaseEnabled,
  setCasesEnabled,
} from "@/lib/pool-storage";

describe("pool storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty record when nothing is stored", () => {
    expect(readCasePool("oll")).toEqual({});
  });

  it("persists and reads back a case's enabled state", () => {
    setCaseEnabled("oll", "oll-1", false);

    expect(readCasePool("oll")).toEqual({ "oll-1": false });
  });

  it("keeps oll and pll pools separate", () => {
    setCaseEnabled("oll", "oll-1", false);
    setCaseEnabled("pll", "pll-ua", false);

    expect(readCasePool("oll")).toEqual({ "oll-1": false });
    expect(readCasePool("pll")).toEqual({ "pll-ua": false });
  });

  it("applies a bulk change in one write, merging with what was already stored", () => {
    setCaseEnabled("oll", "oll-1", false);

    // The "one write" half of the claim, not just the merge: spying after the setup call means
    // only the bulk change is counted. A per-case loop would show one write per id.
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    setCasesEnabled("oll", { "oll-2": false, "oll-3": true });

    // `setCasesEnabled` also writes the mode, which is a real write of its own - filter to the
    // pool key so the "one write" claim survives that.
    const poolWrites = setItem.mock.calls.filter(([key]) => key === "cflop:pool:oll");

    expect(poolWrites).toHaveLength(1);
    expect(readCasePool("oll")).toEqual({ "oll-1": false, "oll-2": false, "oll-3": true });
    // Restored by the shared `afterEach` in `test/setup.ts`, so a failure above cannot leak it.
  });

  it("refuses to persist a malformed record rather than storing something reads discard", () => {
    const badChanges = { "oll-1": "yes" } as unknown as Record<string, boolean>;

    expect(() => setCasesEnabled("oll", badChanges)).toThrow();
    expect(readCasePool("oll")).toEqual({});
  });

  it("rejects a missing change set instead of spreading it into a silent no-op", () => {
    setCaseEnabled("oll", "oll-1", false);

    // `{ ...pool, ...null }` is a no-op, so without parsing `changes` this would rewrite the
    // pool unchanged and report success - the one failure mode the merged-result check cannot see.
    for (const bad of [null, undefined]) {
      expect(() => setCasesEnabled("oll", bad as unknown as Record<string, boolean>)).toThrow();
    }

    expect(readCasePool("oll")).toEqual({ "oll-1": false });
  });

  it("lets a bulk change overwrite an existing entry", () => {
    setCaseEnabled("oll", "oll-1", false);
    setCasesEnabled("oll", { "oll-1": true });

    expect(readCasePool("oll")).toEqual({ "oll-1": true });
  });

  it("discards malformed stored data instead of throwing", () => {
    window.localStorage.setItem("cflop:pool:oll", "not valid json");
    expect(readCasePool("oll")).toEqual({});

    window.localStorage.setItem("cflop:pool:oll", JSON.stringify({ "oll-1": "not-a-boolean" }));
    expect(readCasePool("oll")).toEqual({});
  });
});

describe("isCaseEnabled", () => {
  it("defaults to enabled when a case has no recorded entry", () => {
    expect(isCaseEnabled({}, "oll-1")).toBe(true);
  });

  it("honors an explicit disabled entry", () => {
    expect(isCaseEnabled({ "oll-1": false }, "oll-1")).toBe(false);
  });

  it("honors an explicit enabled entry", () => {
    expect(isCaseEnabled({ "oll-1": true }, "oll-1")).toBe(true);
  });
});

describe("drill pool mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to manual when nothing is stored", () => {
    expect(readDrillPoolMode("oll")).toBe("manual");
  });

  it("turns the mode on and writes the changes together", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true, "oll-2": false });

    expect(readDrillPoolMode("oll")).toBe("only-learned");
    expect(readCasePool("oll")).toEqual({ "oll-1": true, "oll-2": false });
  });

  it("resets to manual on setCaseEnabled", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });
    setCaseEnabled("oll", "oll-2", true);

    expect(readDrillPoolMode("oll")).toBe("manual");
  });

  it("resets to manual on setCasesEnabled", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });
    setCasesEnabled("oll", { "oll-2": true });

    expect(readDrillPoolMode("oll")).toBe("manual");
  });

  it("leaves the mode alone when setCasesEnabled throws on malformed input", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });
    const badChanges = { "oll-2": "yes" } as unknown as Record<string, boolean>;

    expect(() => setCasesEnabled("oll", badChanges)).toThrow();
    expect(readDrillPoolMode("oll")).toBe("only-learned");
  });

  it("clears the mode without touching the pool", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });
    clearDrillPoolMode("oll");

    expect(readDrillPoolMode("oll")).toBe("manual");
    expect(readCasePool("oll")).toEqual({ "oll-1": true });
  });

  it("does nothing under the manual mode", () => {
    mirrorLearnedCaseToPool("oll", "oll-1", true);

    expect(readCasePool("oll")).toEqual({});
  });

  it("writes true under the only-learned mode", () => {
    enableOnlyLearnedCases("oll", {});
    mirrorLearnedCaseToPool("oll", "oll-1", true);

    expect(readCasePool("oll")).toEqual({ "oll-1": true });
  });

  it("writes an explicit false that survives readCasePool, rather than an absent entry", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });
    mirrorLearnedCaseToPool("oll", "oll-1", false);

    expect(readCasePool("oll")).toEqual({ "oll-1": false });
    expect(isCaseEnabled(readCasePool("oll"), "oll-1")).toBe(false);
  });

  it("keeps oll and pll modes independent", () => {
    enableOnlyLearnedCases("oll", { "oll-1": true });

    expect(readDrillPoolMode("oll")).toBe("only-learned");
    expect(readDrillPoolMode("pll")).toBe("manual");
  });
});
