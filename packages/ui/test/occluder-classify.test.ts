import { describe, expect, it } from "vitest";

import {
  HARD_SURFACE_ALPHA_MIN,
  type OccluderStyle,
  colorAlpha,
  hasBackdropFilter,
  isVisibleStyle,
  occluderDirective,
  paintsSurface,
} from "../src/components/occluder-classify.js";

function style(overrides: Partial<OccluderStyle> = {}): OccluderStyle {
  return {
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    backdropFilter: "none",
    display: "block",
    visibility: "visible",
    opacity: "1",
    ...overrides,
  };
}

describe("colorAlpha", () => {
  it("treats absent and transparent values as fully transparent", () => {
    expect(colorAlpha("")).toBe(0);
    expect(colorAlpha("none")).toBe(0);
    expect(colorAlpha("transparent")).toBe(0);
    expect(colorAlpha("  TRANSPARENT  ")).toBe(0);
  });

  it("reads the legacy comma-separated alpha channel", () => {
    expect(colorAlpha("rgba(0, 0, 0, 0)")).toBe(0);
    expect(colorAlpha("rgba(12, 34, 56, 0.5)")).toBe(0.5);
    expect(colorAlpha("hsla(0, 0%, 0%, 0.4)")).toBe(0.4);
  });

  /**
   * The case that matters most here. Tailwind v4 emits
   * `color-mix(in oklab, var(--background) 80%, transparent)` for
   * `bg-background/80`, and a browser's computed value resolves that to a
   * slash-separated modern colour with no commas at all — so a reader that only
   * understood `rgba()` would misread every `.site-panel` in the codebase.
   */
  it("reads slash-separated alpha from modern colour syntax", () => {
    expect(colorAlpha("oklab(0.2 0 0 / 0.8)")).toBe(0.8);
    expect(colorAlpha("oklch(0.5 0.1 200 / 0.35)")).toBe(0.35);
    expect(colorAlpha("color(srgb 1 1 1 / 0)")).toBe(0);
    expect(colorAlpha("rgb(0 0 0 / 30%)")).toBe(0.3);
    expect(colorAlpha("lab(50% 40 59.5 / 62%)")).toBe(0.62);
  });

  it("treats a colour with no alpha channel as opaque", () => {
    expect(colorAlpha("rgb(0, 0, 0)")).toBe(1);
    expect(colorAlpha("rgb(0 0 0)")).toBe(1);
    expect(colorAlpha("oklch(0.5 0.1 200)")).toBe(1);
    expect(colorAlpha("#ff0000")).toBe(1);
  });

  /**
   * Biased toward "it paints". A surface wrongly read as transparent puts traces
   * underneath it, which is the exact failure this feature exists to prevent; a
   * transparent region wrongly read as a surface only costs some canvas.
   */
  it("assumes opaque for an unparseable value", () => {
    expect(colorAlpha("rgba(0, 0, 0, notanumber)")).toBe(1);
    expect(colorAlpha("some-future-colour-function(whatever)")).toBe(1);
  });

  it("clamps out-of-range alpha", () => {
    expect(colorAlpha("rgb(0 0 0 / 250%)")).toBe(1);
    expect(colorAlpha("rgb(0 0 0 / -3)")).toBe(0);
  });
});

describe("hasBackdropFilter", () => {
  it("detects both the standard and webkit-prefixed properties", () => {
    expect(hasBackdropFilter(style({ backdropFilter: "blur(24px)" }))).toBe(true);
    expect(
      hasBackdropFilter(style({ backdropFilter: "none", webkitBackdropFilter: "blur(24px)" })),
    ).toBe(true);
  });

  it("is false when unset, empty, or absent", () => {
    expect(hasBackdropFilter(style({ backdropFilter: "none" }))).toBe(false);
    expect(hasBackdropFilter(style({ backdropFilter: "" }))).toBe(false);
    expect(hasBackdropFilter(style({ backdropFilter: undefined }))).toBe(false);
  });
});

describe("paintsSurface", () => {
  /** `.site-panel`: `bg-background/80 backdrop-blur-xl`, this repo's real panel. */
  it("accepts a translucent backdrop-blurred panel", () => {
    expect(
      paintsSurface(
        style({ backgroundColor: "oklab(0.98 0 0 / 0.8)", backdropFilter: "blur(24px)" }),
        "DIV",
      ),
    ).toBe(true);
  });

  it("accepts a low-alpha field like bg-input/30", () => {
    expect(paintsSurface(style({ backgroundColor: "oklab(0.5 0 0 / 0.3)" }), "INPUT")).toBe(true);
  });

  it("accepts a gradient with no background colour at all", () => {
    expect(
      paintsSurface(style({ backgroundImage: "linear-gradient(180deg, red, blue)" }), "DIV"),
    ).toBe(true);
  });

  it("rejects an element that paints nothing", () => {
    expect(paintsSurface(style(), "DIV")).toBe(false);
    expect(paintsSurface(style(), "LABEL")).toBe(false);
    expect(paintsSurface(style(), "P")).toBe(false);
  });

  it("rejects alpha at or below the threshold", () => {
    expect(
      paintsSurface(style({ backgroundColor: `rgb(0 0 0 / ${HARD_SURFACE_ALPHA_MIN})` }), "DIV"),
    ).toBe(false);
  });

  it("accepts replaced elements regardless of background", () => {
    expect(paintsSurface(style(), "IMG")).toBe(true);
    expect(paintsSurface(style(), "VIDEO")).toBe(true);
    expect(paintsSurface(style(), "CANVAS")).toBe(true);
  });

  /**
   * `tagName` is uppercase for HTML elements but *lowercase* for SVG ones, so a
   * naive `REPLACED_TAGS.has(el.tagName)` would silently miss every `<svg>`.
   */
  it("accepts a lowercase svg tagName", () => {
    expect(paintsSurface(style(), "svg")).toBe(true);
  });

  /**
   * `CasePreviewCard` in cube-trainer is a `<button class="site-panel">`.
   * Classification is about paint, never about interactivity.
   */
  it("accepts an interactive element that paints", () => {
    expect(
      paintsSurface(
        style({ backgroundColor: "oklab(0.98 0 0 / 0.8)", backdropFilter: "blur(24px)" }),
        "BUTTON",
      ),
    ).toBe(true);
  });
});

describe("isVisibleStyle", () => {
  it("rejects display:none, hidden, and collapsed", () => {
    expect(isVisibleStyle(style({ display: "none" }))).toBe(false);
    expect(isVisibleStyle(style({ visibility: "hidden" }))).toBe(false);
    expect(isVisibleStyle(style({ visibility: "collapse" }))).toBe(false);
  });

  it("rejects fully transparent elements", () => {
    expect(isVisibleStyle(style({ opacity: "0" }))).toBe(false);
    expect(isVisibleStyle(style({ opacity: "0.0" }))).toBe(false);
  });

  /** cube-trainer's `dimmed` CasePreviewCard is `opacity-40` and still visible. */
  it("accepts a partially transparent element", () => {
    expect(isVisibleStyle(style({ opacity: "0.4" }))).toBe(true);
  });

  it("assumes visible for an unparseable opacity", () => {
    expect(isVisibleStyle(style({ opacity: "" }))).toBe(true);
  });
});

describe("occluderDirective", () => {
  function el(value?: string): Element {
    const node = document.createElement("div");
    if (value !== undefined) node.setAttribute("data-circuit-occluder", value);
    return node;
  }

  it("reads the three known directives", () => {
    expect(occluderDirective(el("surface"))).toBe("surface");
    expect(occluderDirective(el("skip"))).toBe("skip");
    expect(occluderDirective(el("none"))).toBe("none");
  });

  it("returns null when absent or unrecognised", () => {
    expect(occluderDirective(el())).toBeNull();
    expect(occluderDirective(el(""))).toBeNull();
    expect(occluderDirective(el("Surface"))).toBeNull();
  });
});
