/**
 * Paint classification for automatic occluder discovery — the pure half.
 *
 * Every function here takes plain values, never a DOM node, so the whole
 * decision surface is testable without a layout engine or a stylesheet. The
 * DOM walk that feeds it lives in `occluder-scan.ts`.
 *
 * The question these answer is *"does this element paint something over the
 * circuit field?"* — not *"is it interactive?"*, not *"is it semantically
 * content?"*. That distinction matters: this codebase's own
 * `CasePreviewCard` is a `<button class="site-panel">`, a fully interactive
 * element that is also one of the most visually solid surfaces on the page.
 */

/** The subset of `CSSStyleDeclaration` classification actually reads. */
export type OccluderStyle = {
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly backdropFilter?: string | undefined;
  readonly webkitBackdropFilter?: string | undefined;
  readonly display: string;
  readonly visibility: string;
  readonly opacity: string;
};

/**
 * Elements that paint their own content with no CSS background involved. Note
 * these are compared upper-cased: `tagName` is uppercase for HTML elements but
 * *lowercase* for SVG ones, so `<svg>` would silently miss a naive check.
 */
export const REPLACED_TAGS: ReadonlySet<string> = new Set([
  "IMG",
  "SVG",
  "VIDEO",
  "CANVAS",
  "PICTURE",
  "IFRAME",
  "OBJECT",
  "EMBED",
]);

/** Tags that never render a box, so the walk should not descend into them. */
export const NON_RENDERING_TAGS: ReadonlySet<string> = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TEMPLATE",
  "NOSCRIPT",
  "TITLE",
  "HEAD",
  "BR",
  "WBR",
]);

/**
 * Minimum background alpha that counts as painting a surface.
 *
 * Low on purpose. The instinct is to require something near-opaque, but the
 * dominant real surface in this repo is `.site-panel`, which is
 * `bg-background/80 backdrop-blur-xl` — translucent. A threshold tuned for
 * "opaque" would reject most of the elements this feature exists to find.
 */
export const HARD_SURFACE_ALPHA_MIN = 0.05;

/**
 * Alpha channel of a computed colour, 0-1.
 *
 * Must handle modern colour syntax, not just `rgba()`. Tailwind v4 emits
 * `color-mix(in oklab, var(--background) 80%, transparent)`, and a browser's
 * *computed* value for that resolves to an `oklab(L a b / 0.8)` or
 * `color(srgb … / 0.8)` form — a slash-separated alpha, with no commas
 * anywhere. Reading only the legacy 4th comma component would score every
 * `.site-panel` in the codebase as fully opaque by accident, which happens to
 * be the right answer for the wrong reason, and as 0 for a genuinely
 * transparent one.
 *
 * An unparseable value returns 1 (assume it paints): a surface wrongly treated
 * as transparent puts traces underneath it, which is the failure this whole
 * feature exists to prevent.
 */
export function colorAlpha(value: string): number {
  const text = value.trim().toLowerCase();

  if (text === "" || text === "none" || text === "transparent") return 0;

  const slash = text.lastIndexOf("/");
  if (slash !== -1) return parseAlphaToken(text.slice(slash + 1));

  // Legacy comma form: `rgba(r, g, b, a)` / `hsla(h, s, l, a)`. The modern
  // space-separated `rgb(0 0 0)` has no commas and falls through to opaque,
  // which is correct — no alpha channel means no transparency.
  const parts = text.split(",");
  if (parts.length === 4) return parseAlphaToken(parts[3] as string);

  return 1;
}

function parseAlphaToken(token: string): number {
  const text = token.replace(/[)\s]/g, "");
  const percent = text.endsWith("%");
  const parsed = Number.parseFloat(percent ? text.slice(0, -1) : text);

  if (!Number.isFinite(parsed)) return 1;

  return Math.min(1, Math.max(0, percent ? parsed / 100 : parsed));
}

/**
 * `backdrop-filter` is the single strongest occlusion signal in this codebase.
 * A blurred backdrop is visually solid regardless of how transparent its own
 * background colour is — it is precisely what makes `.site-panel` read as a
 * panel rather than a tinted pane of glass.
 */
export function hasBackdropFilter(style: OccluderStyle): boolean {
  return isSetValue(style.backdropFilter) || isSetValue(style.webkitBackdropFilter);
}

function isSetValue(value: string | undefined): boolean {
  if (value === undefined) return false;
  const text = value.trim().toLowerCase();
  return text !== "" && text !== "none";
}

/** Whether this element paints a surface over the background. */
export function paintsSurface(style: OccluderStyle, tagName: string): boolean {
  if (REPLACED_TAGS.has(tagName.toUpperCase())) return true;
  if (isSetValue(style.backgroundImage)) return true;
  if (hasBackdropFilter(style)) return true;

  return colorAlpha(style.backgroundColor) > HARD_SURFACE_ALPHA_MIN;
}

/**
 * Whether this element renders at all. `false` prunes the whole subtree, since
 * none of these three properties can be un-inherited by a descendant.
 *
 * `Element.prototype.checkVisibility` would express this directly but is
 * unavailable in the jsdom version these tests run on, so the computed-style
 * triple is the primary implementation rather than a fallback. Anything
 * unparseable counts as visible — the same "assume it paints" bias as
 * `colorAlpha`.
 */
export function isVisibleStyle(style: OccluderStyle): boolean {
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;

  const opacity = Number.parseFloat(style.opacity);

  return !(Number.isFinite(opacity) && opacity <= 0);
}

/**
 * Author override read from `data-circuit-occluder`.
 *
 * - `"surface"` — stamped by `useCircuitOccluder`. The manual registry owns
 *   this element's rect, so discovery skips it *and its subtree*, which is what
 *   keeps a manually registered panel from being counted twice.
 * - `"skip"` — do not occlude anything in this subtree.
 * - `"none"` — this element is not a surface, but its children are still
 *   eligible. The author-visible encoding of "don't register the whole content
 *   area, register the panels inside it".
 */
export type OccluderDirective = "surface" | "skip" | "none";

export function occluderDirective(el: Element): OccluderDirective | null {
  const value = el.getAttribute("data-circuit-occluder");

  if (value === "surface" || value === "skip" || value === "none") return value;

  return null;
}
