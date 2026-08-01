import { beforeEach, describe, expect, it } from "vitest";

import { readAlgorithmSet, writeAlgorithmSet } from "@/lib/algorithm-set-storage";

describe("algorithm set storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to OLL when nothing is stored", () => {
    expect(readAlgorithmSet()).toBe("oll");
  });

  it("persists and reads back a set", () => {
    writeAlgorithmSet("pll");

    expect(readAlgorithmSet()).toBe("pll");
  });

  it("discards an unrecognized stored value", () => {
    window.localStorage.setItem("cflop:algorithm-set", "zbll");

    expect(readAlgorithmSet()).toBe("oll");
  });

  it("writes one unscoped key under the current prefix only", () => {
    writeAlgorithmSet("pll");

    expect(window.localStorage.getItem("cflop:algorithm-set")).toBe("pll");
    expect(window.localStorage.getItem("cube-trainer:algorithm-set")).toBeNull();
  });
});
