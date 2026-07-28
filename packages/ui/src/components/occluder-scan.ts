import { GRID } from "./grid-math.js";
import {
  NON_RENDERING_TAGS,
  type OccluderStyle,
  isVisibleStyle,
  occluderDirective,
  paintsSurface,
} from "./occluder-classify.js";
import { MIN_INK_SIDE_PX, measureInkRects } from "./occluder-ink.js";
import type { OccluderKind, Rect } from "./occlusion.js";

/**
 * Automatic occluder discovery: walk the DOM and classify what paints over the
 * circuit field, so surfaces no longer have to be registered by hand.
 *
 * The load-bearing rule is **ancestor subsumption** — once an element is a hard
 * surface, the walk stops there, because everything inside it is already
 * covered by its rect. Three consequences follow, and they are the reason this
 * is cheap enough to do at all:
 *
 * 1. Cost tracks the number of *surfaces*, not the size of the DOM. A markdown
 *    article of 800 elements inside one `.site-panel` costs exactly one visit.
 * 2. Discovery converges on roughly the same rect set the manual registrations
 *    produced, rather than an explosion of nested boxes.
 * 3. The deliberate decision not to register the whole content area falls out
 *    for free instead of needing a special case: a bare layout wrapper paints
 *    nothing, so it is skipped and its painting children are found instead.
 */

/** Minimum side for a *hard* rect. Below it, an element demotes to ink. */
const MIN_HARD_SIDE_PX = GRID;

/**
 * Whether a rect is big enough to be a hard barrier.
 *
 * Applied to ink as well as to painting boxes, and that is the load-bearing
 * decision in this module. Ink started out unconditionally soft, on the reasoning
 * that a paragraph in `cells` could split the canvas into disconnected free
 * regions. It can, and a page of prose does get sparser for it — but soft is
 * advisory: the routing ladder's third tier is hard-only by design, so on a page
 * with an empty half a trace still ran 13-23px from an `<h1>`'s glyphs, at glyph
 * height, and no soft buffer can prevent that (see `SOFT_OCCLUDER_BUFFER_PX`).
 * Hard is the only tier nothing is allowed to ignore, and it is the tier the
 * lattice snap applies to, which is where real clearance comes from.
 *
 * The floor is what keeps this from being reckless: a block of ink has to be at
 * least one grid cell on both axes before it can claim lattice cells, so a merged
 * paragraph or a display heading qualifies while a lone 19px line of small text
 * or a 20px icon stays soft. One element can produce both kinds at once — its
 * sized ink and its stray fragments are pushed as two separate surfaces.
 */
function isHardSized(rect: Rect): boolean {
  return rect.x1 - rect.x0 >= MIN_HARD_SIDE_PX && rect.y1 - rect.y0 >= MIN_HARD_SIDE_PX;
}

const MAX_SCAN_ELEMENTS = 4000;
const MAX_SCAN_DEPTH = 40;
const MAX_HARD_RECTS = 64;
/**
 * The hot cap. `segmentCrossesBarrier` scans this list per candidate segment
 * per trace, and `walkFromStart`'s reject multiplies that by roughly six
 * attempts per segment.
 */
const MAX_SOFT_RECTS = 256;

/** Marks our own SVG layers, so the scan never occludes against itself. */
export const CIRCUIT_FIELD_MARKER = "data-circuit-field";
export const CIRCUIT_OVERLAY_MARKER = "data-circuit-overlay";

export type DiscoveredSurface = {
  readonly el: Element;
  readonly kind: OccluderKind;
  /**
   * Rects **local to the element's own box origin**. A hard surface has exactly
   * one, spanning its box; ink has one per coalesced *block* (`coalesceInkRects`
   * merges adjacent lines, so a paragraph is usually one rect, not one per
   * line). One element can produce two entries — an `"ink"` one for the blocks
   * that clear `MIN_HARD_SIDE_PX` and a `"soft"` one for the remainder.
   *
   * Local rather than viewport coordinates is what makes the discovery /
   * measurement split work: re-deriving viewport rects on scroll costs one
   * `getBoundingClientRect` per element and no style or `Range` work at all.
   */
  readonly localRects: readonly Rect[];
};

export type ScanViewport = { readonly width: number; readonly height: number };

export type ScanOptions = {
  /** Injectable for tests; defaults to `window.getComputedStyle`. */
  readonly computeStyle?: (el: Element) => OccluderStyle;
  readonly maxElements?: number;
  readonly maxDepth?: number;
  readonly maxHardRects?: number;
  readonly maxSoftRects?: number;
};

// No cast needed: `CSSStyleDeclaration` is structurally assignable to
// `OccluderStyle`, which is the point of declaring the narrow shape rather than
// depending on the full DOM type.
function defaultComputeStyle(el: Element): OccluderStyle {
  return window.getComputedStyle(el);
}

/**
 * Keeps the largest-area rects when a cap is hit. Dropping the *smallest* would
 * be the intuitive choice and is the wrong one: a cap is reached on pages dense
 * with small ink, and the rects that matter visually are the big ones.
 *
 * `MAX_HARD_RECTS` is a **shared** budget since text blocks became `"ink"` and
 * started riding in the same list as painting surfaces, so this ranks a
 * paragraph against a panel purely by area. The bad case, if the cap is ever
 * reached, is a wide text block (786x47 is ~37k px²) evicting a small card and
 * putting a trace back under a real surface — the exact failure automatic
 * discovery exists to remove. Live counts are 3-6 hard entries per route across
 * all three apps, so this is latent, not active; if it ever goes live, split the
 * budget by kind rather than raising the number.
 */
function capByArea(surfaces: DiscoveredSurface[], limit: number): DiscoveredSurface[] {
  if (surfaces.length <= limit) return surfaces;

  const area = (surface: DiscoveredSurface) =>
    surface.localRects.reduce((sum, rect) => sum + (rect.x1 - rect.x0) * (rect.y1 - rect.y0), 0);

  return surfaces
    .slice()
    .sort((a, b) => area(b) - area(a))
    .slice(0, limit);
}

/**
 * Discovers every occluding surface beneath `root`.
 *
 * `root` itself is **never classified** — the stack is seeded with its children.
 * This is structural, not a tunable threshold. The scan root in every consuming
 * app is `document.body`, which carries `.grid-backdrop`: an opaque background
 * colour plus five gradient layers. Classifying it would make it a hard surface
 * covering the whole viewport, subsumption would stop the walk on the very
 * first element, and the field would be empty on every page of every app. The
 * grid backdrop *is* the background the circuit field paints over; occluding
 * against it is incoherent.
 */
export function scanOccluders(
  root: Element,
  viewport: ScanViewport,
  options: ScanOptions = {},
): DiscoveredSurface[] {
  const computeStyle = options.computeStyle ?? defaultComputeStyle;
  const maxElements = options.maxElements ?? MAX_SCAN_ELEMENTS;
  const maxDepth = options.maxDepth ?? MAX_SCAN_DEPTH;

  const hard: DiscoveredSurface[] = [];
  const soft: DiscoveredSurface[] = [];
  let visited = 0;

  const stack: { el: Element; depth: number }[] = [];
  pushChildren(root, 0, stack);

  while (stack.length > 0) {
    if (visited >= maxElements) break;

    const { el, depth } = stack.pop() as { el: Element; depth: number };
    visited += 1;

    if (depth > maxDepth) continue;
    if (NON_RENDERING_TAGS.has(el.tagName.toUpperCase())) continue;
    // A dedicated marker rather than `aria-hidden`: our own layers are
    // aria-hidden, but so is every decorative icon on the page, and those are
    // legitimate ink.
    if (el.hasAttribute(CIRCUIT_FIELD_MARKER) || el.hasAttribute(CIRCUIT_OVERLAY_MARKER)) continue;

    const directive = occluderDirective(el);
    // `"surface"` means a live `useCircuitOccluder` owns this rect. Skipping the
    // subtree — not just the element — is what preserves subsumption for
    // manually registered panels.
    if (directive === "surface" || directive === "skip") continue;

    const style = computeStyle(el);
    // `inert` travels with the visually-hidden states in this codebase (the
    // condensed header carries `opacity-0` and `inert` together), and an inert
    // subtree is never the interactive surface a reader is looking at.
    if (!isVisibleStyle(style) || el.hasAttribute("inert")) continue;

    const box = el.getBoundingClientRect();
    const width = box.right - box.left;
    const height = box.bottom - box.top;

    // Zero-area *before* the viewport cull, not after: a collapsed box has no
    // meaningful position, so culling it by position would prune a wrapper whose
    // children are perfectly visible. A `display: contents` or margin-collapsed
    // wrapper reports 0x0 at the origin and would read as "off the top-left".
    if (width <= 0 || height <= 0) {
      pushChildren(el, depth + 1, stack);
      continue;
    }

    if (isOffViewport(box, viewport)) continue;

    if (directive !== "none" && paintsSurface(style, el.tagName)) {
      const local: Rect = { x0: 0, y0: 0, x1: width, y1: height };

      if (isHardSized(local)) {
        hard.push({ el, kind: "hard", localRects: [local] });
      } else if (width >= MIN_INK_SIDE_PX && height >= MIN_INK_SIDE_PX) {
        // Demoted, not dropped. A 14px icon or a 36px-tall input paints, but a
        // hard rect snaps outward to whole lattice cells and would carve a hole
        // several times the element's own size.
        soft.push({ el, kind: "soft", localRects: [local] });
      }

      // Subsumption: stop here either way. A demoted-to-ink element is still a
      // painted surface covering its own children.
      continue;
    }

    // `<svg>` reaches here only via `data-circuit-occluder="none"`; its children
    // are `SVGElement` path/g nodes rather than layout boxes.
    if (el.tagName.toUpperCase() !== "SVG") {
      const inkRects = measureInkRects(el, { left: box.left, top: box.top });

      if (inkRects.length > 0) {
        const hardInk = inkRects.filter(isHardSized);
        const softInk = inkRects.filter((rect) => !isHardSized(rect));

        if (hardInk.length > 0) hard.push({ el, kind: "ink", localRects: hardInk });
        if (softInk.length > 0) soft.push({ el, kind: "soft", localRects: softInk });
      }

      pushChildren(el, depth + 1, stack);
    }
  }

  return [
    ...capByArea(hard, options.maxHardRects ?? MAX_HARD_RECTS),
    ...capByArea(soft, options.maxSoftRects ?? MAX_SOFT_RECTS),
  ];
}

function pushChildren(el: Element, depth: number, stack: { el: Element; depth: number }[]): void {
  const children = el.children;

  for (let i = children.length - 1; i >= 0; i -= 1) {
    stack.push({ el: children[i] as Element, depth });
  }
}

function isOffViewport(
  box: { left: number; top: number; right: number; bottom: number },
  viewport: ScanViewport,
): boolean {
  return (
    box.right <= 0 || box.bottom <= 0 || box.left >= viewport.width || box.top >= viewport.height
  );
}
