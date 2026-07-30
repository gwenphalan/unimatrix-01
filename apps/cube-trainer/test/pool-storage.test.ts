import { beforeEach, describe, expect, it } from "vitest";

import { isCaseEnabled, readCasePool, setCaseEnabled, setCasesEnabled } from "@/lib/pool-storage";

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
    setCasesEnabled("oll", { "oll-2": false, "oll-3": true });

    expect(readCasePool("oll")).toEqual({ "oll-1": false, "oll-2": false, "oll-3": true });
  });

  it("lets a bulk change overwrite an existing entry", () => {
    setCaseEnabled("oll", "oll-1", false);
    setCasesEnabled("oll", { "oll-1": true });

    expect(readCasePool("oll")).toEqual({ "oll-1": true });
  });

  it("discards malformed stored data instead of throwing", () => {
    window.localStorage.setItem("cube-trainer:pool:oll", "not valid json");
    expect(readCasePool("oll")).toEqual({});

    window.localStorage.setItem(
      "cube-trainer:pool:oll",
      JSON.stringify({ "oll-1": "not-a-boolean" }),
    );
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
