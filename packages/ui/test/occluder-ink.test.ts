import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_INK_RECTS_PER_ELEMENT,
  coalesceInkRects,
  measureInkRects,
} from "../src/components/occluder-ink.js";
import type { Rect } from "../src/components/occlusion.js";

function line(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 };
}

describe("coalesceInkRects", () => {
  it("drops rects too small to be ink on either side", () => {
    expect(coalesceInkRects([line(0, 0, 4, 20), line(0, 0, 200, 3)])).toEqual([]);
  });

  /**
   * Inline markup (`<a>`, `<code>`, `<strong>`) splits one visual line into
   * several client rects whose tops differ by a subpixel or two.
   */
  it("rejoins fragments of the same visual line", () => {
    expect(
      coalesceInkRects([
        line(100, 100, 180, 124),
        line(182, 100.5, 240, 124),
        line(242, 100, 300, 124),
      ]),
    ).toEqual([line(100, 100, 300, 124)]);
  });

  /** A full-width paragraph should cost one rect, not one per line. */
  it("collapses a stack of full-width lines into a single block", () => {
    expect(
      coalesceInkRects([
        line(100, 100, 700, 124),
        line(100, 128, 700, 152),
        line(100, 156, 700, 180),
      ]),
    ).toEqual([line(100, 100, 700, 180)]);
  });

  /**
   * The same collapse at this repo's *measured* body-text geometry, which the
   * case above does not reach: `apps/web` `/about` reports 19px of ink on a 28px
   * line pitch, a 9px gap. The original 6px merge threshold rejected that, so a
   * three-line paragraph stayed three 19px rects — each one under
   * `occluder-scan.ts`'s 40px hard floor, and therefore on the soft channel the
   * routing fallback is allowed to ignore. The merge is what makes body text a
   * hard barrier, so it is pinned to real numbers rather than round ones.
   */
  it("collapses lines at the real 19px-ink-on-28px-pitch body geometry", () => {
    const rects = coalesceInkRects([
      line(227, 163, 1013, 182),
      line(227, 191, 1031, 210),
      line(227, 219, 566, 238),
    ]);

    // The two full-width lines merge to 47px tall — over the 40px floor, so this
    // block claims lattice cells. The ragged last line is only 42% as wide as the
    // block above it, so `INK_BLOCK_OVERLAP_RATIO` keeps it separate and it stays
    // soft. That is not a gap in coverage: the merged block's buffered span snaps
    // outward to whole grid rows, which already covers the short line's band.
    expect(rects).toEqual([line(227, 163, 1031, 210), line(227, 219, 566, 238)]);
  });

  /**
   * The asymmetry that makes ink worth measuring at all: a short heading above
   * wide body text keeps its tight width instead of being unioned out to the
   * paragraph's full span.
   */
  it("keeps a short heading separate from wide body text below it", () => {
    const rects = coalesceInkRects([line(100, 100, 260, 140), line(100, 144, 900, 168)]);

    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual(line(100, 100, 260, 140));
    expect(rects[1]).toEqual(line(100, 144, 900, 168));
  });

  it("keeps lines separated by a large vertical gap apart", () => {
    expect(coalesceInkRects([line(100, 100, 700, 124), line(100, 400, 700, 424)])).toHaveLength(2);
  });

  it("unions the overflow once past the per-element cap", () => {
    const many = Array.from({ length: MAX_INK_RECTS_PER_ELEMENT + 6 }, (_, i) =>
      line(100, i * 100, 300, i * 100 + 24),
    );
    const rects = coalesceInkRects(many);

    expect(rects).toHaveLength(MAX_INK_RECTS_PER_ELEMENT);
    // The final rect spans everything that did not fit.
    expect(rects[MAX_INK_RECTS_PER_ELEMENT - 1]).toEqual(
      line(100, (MAX_INK_RECTS_PER_ELEMENT - 1) * 100, 300, (many.length - 1) * 100 + 24),
    );
  });

  it("returns an empty list for no input", () => {
    expect(coalesceInkRects([])).toEqual([]);
  });
});

describe("measureInkRects", () => {
  /**
   * `Range.prototype.getClientRects` does not exist in the jsdom these tests run
   * on, so the stub is the only way to exercise the measurement path — and its
   * genuine absence is itself worth a test, since that is what production would
   * hit under SSR or any non-layout environment.
   */
  describe("with getClientRects available", () => {
    beforeEach(() => {
      Range.prototype.getClientRects = function getClientRects(this: Range) {
        const text = (this.startContainer.textContent ?? "").trim();
        const rects = text === "" ? [] : [{ left: 150, top: 200, right: 350, bottom: 224 }];

        return Object.assign(rects, {
          item: (i: number) => rects[i] ?? null,
        }) as unknown as DOMRectList;
      };
    });

    afterEach(() => {
      delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
    });

    it("returns rects relative to the element's own box origin", () => {
      const el = document.createElement("p");
      el.textContent = "Some body copy";

      expect(measureInkRects(el, { left: 100, top: 100 })).toEqual([line(50, 100, 250, 124)]);
    });

    it("ignores whitespace-only text nodes", () => {
      const el = document.createElement("div");
      el.append(document.createTextNode("   \n  "));

      expect(measureInkRects(el, { left: 0, top: 0 })).toEqual([]);
    });

    /**
     * A descendant element gets its own visit in the walk, so measuring anything
     * but direct child text here would double-count it.
     */
    it("measures only direct child text nodes", () => {
      const el = document.createElement("div");
      const child = document.createElement("span");
      child.textContent = "nested";
      el.append(child);

      expect(measureInkRects(el, { left: 0, top: 0 })).toEqual([]);
    });
  });

  it("returns no rects when getClientRects is unavailable, rather than throwing", () => {
    expect("getClientRects" in Range.prototype).toBe(false);

    const el = document.createElement("p");
    el.textContent = "Some body copy";

    expect(measureInkRects(el, { left: 0, top: 0 })).toEqual([]);
  });
});
