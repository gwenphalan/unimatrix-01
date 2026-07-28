import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OccluderStyle } from "../src/components/occluder-classify.js";
import {
  CIRCUIT_FIELD_MARKER,
  type DiscoveredSurface,
  scanOccluders,
} from "../src/components/occluder-scan.js";
import type { Rect } from "../src/components/occlusion.js";

const VIEWPORT = { width: 1440, height: 900 };

/**
 * jsdom applies no stylesheet, so a Tailwind class name computes to `"none"` /
 * `""` and cannot drive classification. Inline `style` attributes *are*
 * reflected, and this reader turns them into the structural shape the
 * classifier wants — which keeps these tests exercising the real decision tree
 * rather than a mock of it.
 */
function readInlineStyle(el: Element): OccluderStyle {
  const inline = (el as HTMLElement).style;

  return {
    backgroundColor: inline.backgroundColor,
    backgroundImage: inline.backgroundImage,
    backdropFilter: inline.getPropertyValue("backdrop-filter"),
    display: inline.display || "block",
    visibility: inline.visibility || "visible",
    opacity: inline.opacity || "1",
  };
}

/** jsdom reports every rect as zero-sized, so geometry has to be stubbed. */
function withBox(el: Element, x0: number, y0: number, x1: number, y1: number): Element {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 }),
  });

  return el;
}

function panel(x0: number, y0: number, x1: number, y1: number): HTMLElement {
  const el = document.createElement("div");
  // Stands in for `.site-panel` — translucent with a blurred backdrop.
  el.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  el.style.setProperty("backdrop-filter", "blur(24px)");
  withBox(el, x0, y0, x1, y1);

  return el;
}

function plain(x0: number, y0: number, x1: number, y1: number): HTMLElement {
  const el = document.createElement("div");
  withBox(el, x0, y0, x1, y1);

  return el;
}

/**
 * Viewport-coordinate ink rects per text node, for the `Range.getClientRects`
 * stub the ink-tiering block installs. Keyed by the text node because
 * `selectNodeContents` makes it the range's `startContainer`.
 */
const INK = new WeakMap<Node, Rect[]>();

function inked(el: HTMLElement, rects: Rect[]): HTMLElement {
  const node = document.createTextNode("copy");
  el.append(node);
  INK.set(node, rects);

  return el;
}

function scan(
  root: Element,
  options: Parameters<typeof scanOccluders>[2] = {},
): DiscoveredSurface[] {
  return scanOccluders(root, VIEWPORT, { computeStyle: readInlineStyle, ...options });
}

function root(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  withBox(el, 0, 0, 1440, 900);

  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("scanOccluders", () => {
  /**
   * The regression guard on the root-node rule. Every consuming app's scan root
   * is `<body class="grid-backdrop">`, which paints an opaque colour plus five
   * gradients. Classifying the root would make it one viewport-sized hard rect,
   * subsumption would stop the walk immediately, and the field would be empty on
   * every page of every app — a failure that reads as an over-aggressive alpha
   * threshold rather than a root-node bug.
   */
  it("never classifies the root itself, however heavily it paints", () => {
    const backdrop = panel(0, 0, 1440, 900);
    backdrop.style.backgroundImage = "linear-gradient(0deg, red 1px, transparent 1px)";
    backdrop.append(panel(100, 100, 400, 300));

    const surfaces = scan(backdrop);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 300, y1: 200 }]);
  });

  it("emits one hard rect per painting surface, in element-local coordinates", () => {
    const container = root();
    container.append(panel(100, 120, 500, 400));

    const surfaces = scan(container);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.kind).toBe("hard");
    expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 400, y1: 280 }]);
  });

  /** The load-bearing rule: cost tracks surfaces, not DOM size. */
  it("stops descending into a hard surface", () => {
    const container = root();
    const outer = panel(100, 100, 500, 400);
    outer.append(panel(120, 120, 300, 300));
    container.append(outer);

    expect(scan(container)).toHaveLength(1);
  });

  /**
   * Reproduces the deliberate decision not to register a whole content area as
   * one flat occluder — and does it as a consequence of the rules rather than a
   * special case.
   */
  it("descends through a non-painting wrapper to the panels inside it", () => {
    const container = root();
    const wrapper = plain(0, 0, 1440, 900);
    wrapper.append(panel(100, 100, 400, 300), panel(600, 100, 900, 300));
    container.append(wrapper);

    const surfaces = scan(container);

    expect(surfaces).toHaveLength(2);
    expect(surfaces.every((surface) => surface.kind === "hard")).toBe(true);
  });

  /**
   * A hard rect snaps outward to whole lattice cells, so a 14px icon would carve
   * a hole several times its own size. Demoted, not dropped.
   */
  it("demotes a painting element smaller than one grid cell to ink", () => {
    const container = root();
    container.append(panel(100, 100, 118, 118));

    const surfaces = scan(container);

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.kind).toBe("soft");
  });

  it("drops a painting element too small to be ink either", () => {
    const container = root();
    container.append(panel(100, 100, 103, 103));

    expect(scan(container)).toEqual([]);
  });

  /**
   * The tier text lands in is the whole reason this change exists. Soft is
   * advisory — the routing ladder's hard-only fallback may ignore it — so a
   * paragraph or heading big enough to claim lattice cells has to reach the hard
   * channel or traces run right up against the glyphs.
   */
  describe("ink tiering", () => {
    beforeEach(() => {
      Range.prototype.getClientRects = function getClientRects(this: Range) {
        const rects = (INK.get(this.startContainer) ?? []).map((rect) => ({
          left: rect.x0,
          top: rect.y0,
          right: rect.x1,
          bottom: rect.y1,
        }));

        return Object.assign(rects, {
          item: (i: number) => rects[i] ?? null,
        }) as unknown as DOMRectList;
      };
    });

    afterEach(() => {
      delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
    });

    it("routes ink at least one grid cell on both axes into the cell-blocking channel", () => {
      const container = root();
      // `apps/web` `/about`'s intro paragraph: two merged 19px lines, 47px tall.
      container.append(
        inked(plain(227, 163, 1031, 210), [{ x0: 227, y0: 163, x1: 1031, y1: 210 }]),
      );

      const surfaces = scan(container);

      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.kind).toBe("ink");
      expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 804, y1: 47 }]);
    });

    it("keeps a lone line of ink too short for the lattice soft", () => {
      const container = root();
      container.append(inked(plain(227, 219, 566, 238), [{ x0: 227, y0: 219, x1: 566, y1: 238 }]));

      const surfaces = scan(container);

      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.kind).toBe("soft");
    });

    /**
     * One element, both channels. The rect index in the provider's discovered key
     * is per-surface, so pushing the same element twice stays collision-free.
     */
    it("splits one element's ink across both channels by size", () => {
      const container = root();
      container.append(
        inked(plain(227, 163, 1031, 500), [
          { x0: 227, y0: 163, x1: 1031, y1: 210 },
          { x0: 227, y0: 480, x1: 566, y1: 499 },
        ]),
      );

      const surfaces = scan(container);

      expect(surfaces.map((surface) => surface.kind)).toEqual(["ink", "soft"]);
      expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 804, y1: 47 }]);
      expect(surfaces[1]!.localRects).toEqual([{ x0: 0, y0: 317, x1: 339, y1: 336 }]);
    });
  });

  describe("directives", () => {
    it("skips a manually registered surface and its subtree", () => {
      const container = root();
      const registered = panel(100, 100, 500, 400);
      registered.setAttribute("data-circuit-occluder", "surface");
      registered.append(panel(120, 120, 300, 300));
      container.append(registered);

      expect(scan(container)).toEqual([]);
    });

    it("skips a `skip` subtree entirely", () => {
      const container = root();
      const ignored = plain(0, 0, 1440, 900);
      ignored.setAttribute("data-circuit-occluder", "skip");
      ignored.append(panel(100, 100, 400, 300));
      container.append(ignored);

      expect(scan(container)).toEqual([]);
    });

    it("skips a `none` element but still finds its children", () => {
      const container = root();
      const opted = panel(0, 0, 1440, 900);
      opted.setAttribute("data-circuit-occluder", "none");
      opted.append(panel(100, 100, 400, 300));
      container.append(opted);

      const surfaces = scan(container);

      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 300, y1: 200 }]);
    });
  });

  it("ignores its own field layer via the dedicated marker", () => {
    const container = root();
    const field = panel(0, 0, 1440, 900);
    field.setAttribute(CIRCUIT_FIELD_MARKER, "");
    field.setAttribute("aria-hidden", "true");
    container.append(field);

    expect(scan(container)).toEqual([]);
  });

  describe("visibility", () => {
    it("prunes a subtree hidden by opacity", () => {
      const container = root();
      const wrapper = plain(0, 0, 1440, 900);
      wrapper.style.opacity = "0";
      wrapper.append(panel(100, 100, 400, 300));
      container.append(wrapper);

      expect(scan(container)).toEqual([]);
    });

    it("prunes a display:none subtree", () => {
      const container = root();
      const wrapper = plain(0, 0, 1440, 900);
      wrapper.style.display = "none";
      wrapper.append(panel(100, 100, 400, 300));
      container.append(wrapper);

      expect(scan(container)).toEqual([]);
    });

    /**
     * `apps/web`'s condensed header carries `opacity-0` and `inert` together, so
     * this rule is what replaces its manual `{ enabled: isCondensed }` guard.
     */
    it("prunes an inert subtree", () => {
      const container = root();
      const wrapper = plain(0, 0, 1440, 900);
      wrapper.setAttribute("inert", "");
      wrapper.append(panel(100, 100, 400, 300));
      container.append(wrapper);

      expect(scan(container)).toEqual([]);
    });

    it("keeps a partially transparent surface", () => {
      const container = root();
      const dimmed = panel(100, 100, 400, 300);
      dimmed.style.opacity = "0.4";
      container.append(dimmed);

      expect(scan(container)).toHaveLength(1);
    });
  });

  describe("viewport culling", () => {
    it("prunes a subtree entirely below the viewport", () => {
      const container = root();
      const wrapper = plain(0, 2000, 1440, 3000);
      wrapper.append(panel(100, 2100, 400, 2300));
      container.append(wrapper);

      expect(scan(container)).toEqual([]);
    });

    it("keeps a surface partly scrolled off the top", () => {
      const container = root();
      container.append(panel(100, -200, 400, 100));

      expect(scan(container)).toHaveLength(1);
    });

    it("descends through a zero-area wrapper", () => {
      const container = root();
      const collapsed = plain(0, 0, 0, 0);
      collapsed.append(panel(100, 100, 400, 300));
      container.append(collapsed);

      expect(scan(container)).toHaveLength(1);
    });
  });

  describe("caps", () => {
    it("keeps the largest hard rects when over the cap", () => {
      const container = root();
      container.append(panel(0, 0, 60, 60), panel(100, 100, 900, 800), panel(0, 200, 60, 260));

      const surfaces = scan(container, { maxHardRects: 1 });

      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.localRects).toEqual([{ x0: 0, y0: 0, x1: 800, y1: 700 }]);
    });

    it("stops walking at the element budget", () => {
      const container = root();
      for (let i = 0; i < 40; i += 1) container.append(panel(0, i * 20, 100, i * 20 + 18));

      expect(scan(container, { maxElements: 5 }).length).toBeLessThanOrEqual(5);
    });

    it("stops descending past the depth cap", () => {
      const container = root();
      let cursor: HTMLElement = container;
      for (let i = 0; i < 8; i += 1) {
        const next = plain(0, 0, 1440, 900);
        cursor.append(next);
        cursor = next;
      }
      cursor.append(panel(100, 100, 400, 300));

      expect(scan(container, { maxDepth: 3 })).toEqual([]);
    });
  });

  /**
   * `checkVisibility` does not exist in this jsdom, which is exactly why the
   * computed-style triple is the primary implementation rather than a fallback.
   */
  it("works without Element.prototype.checkVisibility", () => {
    expect((Element.prototype as { checkVisibility?: unknown }).checkVisibility).toBeUndefined();

    const container = root();
    container.append(panel(100, 100, 400, 300));

    expect(scan(container)).toHaveLength(1);
  });
});
