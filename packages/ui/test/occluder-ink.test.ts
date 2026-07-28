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
