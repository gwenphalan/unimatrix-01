import { beforeEach, describe, expect, it } from "vitest";

import {
  INITIAL_PREVIEW_MODE,
  previewModesForSet,
  resolvePreviewMode,
} from "@/features/algorithms/preview-mode";
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

  it("resolves the untouched initial mode to something each set renders", () => {
    // The storage-miss default is two-sided, which only PLL offers. Resolving it per set is the
    // whole reason the clamp fallback is not one shared constant.
    expect(resolvePreviewMode("pll", INITIAL_PREVIEW_MODE)).toBe("two-sided");
    expect(resolvePreviewMode("oll", INITIAL_PREVIEW_MODE)).toBe("top-down");
    expect(previewModesForSet("oll")).toContain(resolvePreviewMode("oll", INITIAL_PREVIEW_MODE));
    expect(previewModesForSet("pll")).toContain(resolvePreviewMode("pll", INITIAL_PREVIEW_MODE));
  });
});

describe("preview mode storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to two-sided when nothing is stored", () => {
    expect(readPreviewMode("learn")).toBe("two-sided");
    expect(readPreviewMode("drill")).toBe("two-sided");
  });

  it("opens PLL on two-sided and OLL on top-down with nothing stored", () => {
    expect(resolvePreviewMode("pll", readPreviewMode("learn"))).toBe("two-sided");
    expect(resolvePreviewMode("oll", readPreviewMode("learn"))).toBe("top-down");
  });

  it("lets a stored preference win over the default for both sets", () => {
    writePreviewMode("learn", "hidden");

    expect(resolvePreviewMode("pll", readPreviewMode("learn"))).toBe("hidden");
    expect(resolvePreviewMode("oll", readPreviewMode("learn"))).toBe("hidden");
  });

  it("keeps a stored two-sided through a round trip via OLL", () => {
    writePreviewMode("learn", "two-sided");

    // OLL renders top-down without rewriting the preference, so PLL still gets two-sided back.
    expect(resolvePreviewMode("oll", readPreviewMode("learn"))).toBe("top-down");
    expect(readPreviewMode("learn")).toBe("two-sided");
    expect(resolvePreviewMode("pll", readPreviewMode("learn"))).toBe("two-sided");
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
    window.localStorage.setItem("cflop:preview-mode:learn", "isometric");

    expect(readPreviewMode("learn")).toBe("two-sided");
  });
});
