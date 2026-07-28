import { beforeEach, describe, expect, it } from "vitest";

import { previewModesForSet, resolvePreviewMode } from "@/features/algorithms/preview-mode";
import { readPreviewMode, writePreviewMode } from "@/lib/preview-mode-storage";

describe("previewModesForSet", () => {
  it("offers OLL top-down and hidden only", () => {
    expect(previewModesForSet("oll")).toEqual(["top-down", "hidden"]);
  });

  it("offers PLL the two-sided mode as well", () => {
    expect(previewModesForSet("pll")).toEqual(["top-down", "two-sided", "hidden"]);
  });
});

describe("resolvePreviewMode", () => {
  it("passes through a mode the set offers", () => {
    expect(resolvePreviewMode("oll", "hidden")).toBe("hidden");
    expect(resolvePreviewMode("pll", "two-sided")).toBe("two-sided");
  });

  it("falls back to top-down when OLL is asked for the two-sided mode", () => {
    expect(resolvePreviewMode("oll", "two-sided")).toBe("top-down");
  });
});

describe("preview mode storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to top-down when nothing is stored", () => {
    expect(readPreviewMode("learn")).toBe("top-down");
    expect(readPreviewMode("drill")).toBe("top-down");
  });

  it("persists and reads back a mode", () => {
    writePreviewMode("drill", "hidden");

    expect(readPreviewMode("drill")).toBe("hidden");
  });

  it("keeps learn and drill preferences separate", () => {
    writePreviewMode("learn", "two-sided");
    writePreviewMode("drill", "hidden");

    expect(readPreviewMode("learn")).toBe("two-sided");
    expect(readPreviewMode("drill")).toBe("hidden");
  });

  it("discards an unrecognized stored value instead of rendering an empty toggle", () => {
    window.localStorage.setItem("cube-trainer:preview-mode:learn", "isometric");

    expect(readPreviewMode("learn")).toBe("top-down");
  });
});
