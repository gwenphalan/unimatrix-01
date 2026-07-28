import type { Rect } from "./occlusion.js";

/**
 * Ink measurement: the rects a *text-bearing* element actually paints.
 *
 * The element's own box is the wrong answer here, and not by a small margin. An
 * `<h1 class="max-w-4xl">Projects</h1>` has a block box spanning its whole
 * container while its glyphs cover maybe 200px — registering the box would
 * carve a full-width hole in the trace field for one short word. `Range`
 * client rects give the real line boxes instead.
 */

/** Below this on either side, a rect is decoration or measurement noise. */
export const MIN_INK_SIDE_PX = 6;

/**
 * Vertical tolerance for "these belong to the same visual line". Inline markup
 * (`<a>`, `<code>`, `<strong>`) fragments a line into several client rects
 * whose tops can differ by a subpixel or two.
 */
const INK_LINE_MERGE_PX = 2;

/** Maximum vertical gap between lines that still merges into one block. */
const INK_BLOCK_MERGE_PX = 6;

/**
 * Minimum horizontal overlap ratio for two stacked lines to merge into a
 * block. The asymmetry this creates is the entire point: a full-width
 * paragraph's lines overlap almost totally and collapse into one rect, while a
 * short heading sitting above wide body text does not merge and keeps its tight
 * ink width.
 */
const INK_BLOCK_OVERLAP_RATIO = 0.6;

/** Past this many rects for one element, the overflow unions into one rect. */
export const MAX_INK_RECTS_PER_ELEMENT = 12;

function canMeasureRanges(): boolean {
  return (
    typeof Range !== "undefined" &&
    typeof Range.prototype.getClientRects === "function" &&
    typeof document !== "undefined"
  );
}

/**
 * Merges rects into visual lines, then lines into blocks. Pure given its input,
 * which is what makes the interesting behaviour testable without a layout
 * engine.
 */
export function coalesceInkRects(rects: readonly Rect[]): Rect[] {
  const usable = rects.filter(
    (rect) => rect.x1 - rect.x0 >= MIN_INK_SIDE_PX && rect.y1 - rect.y0 >= MIN_INK_SIDE_PX,
  );

  if (usable.length === 0) return [];

  const sorted = usable.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: Rect[] = [];

  for (const rect of sorted) {
    const open = lines[lines.length - 1];

    if (open && Math.abs(open.y0 - rect.y0) <= INK_LINE_MERGE_PX) {
      lines[lines.length - 1] = union(open, rect);
      continue;
    }

    lines.push({ ...rect });
  }

  const blocks: Rect[] = [];

  for (const line of lines) {
    const open = blocks[blocks.length - 1];

    if (
      open &&
      line.y0 - open.y1 <= INK_BLOCK_MERGE_PX &&
      overlapRatio(open, line) >= INK_BLOCK_OVERLAP_RATIO
    ) {
      blocks[blocks.length - 1] = union(open, line);
      continue;
    }

    blocks.push({ ...line });
  }

  if (blocks.length <= MAX_INK_RECTS_PER_ELEMENT) return blocks;

  const kept = blocks.slice(0, MAX_INK_RECTS_PER_ELEMENT - 1);
  const overflow = blocks.slice(MAX_INK_RECTS_PER_ELEMENT - 1);

  return [...kept, overflow.reduce(union)];
}

function union(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Shared horizontal span as a fraction of the **wider** rect's width.
 *
 * The wider one, not the narrower: a short heading sits fully inside a wide
 * paragraph's horizontal span, so dividing by the narrower width scores that
 * pair 1.0 and merges them — unioning the heading out to the paragraph's full
 * width, which is the exact over-registration measuring ink was meant to avoid.
 * Against the wider width the same pair scores 0.2 and stays separate, while
 * two genuinely full-width lines still score ~1.0.
 */
function overlapRatio(a: Rect, b: Rect): number {
  const shared = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  if (shared <= 0) return 0;

  const wider = Math.max(a.x1 - a.x0, b.x1 - b.x0);
  if (wider <= 0) return 0;

  return shared / wider;
}

/**
 * Ink rects for `el`, in coordinates **local to `box`** (offsets from the
 * element's own origin).
 *
 * Local rather than viewport coordinates so the scroll path can re-derive
 * viewport rects from a single `getBoundingClientRect` per element, with no
 * `getComputedStyle` and no `Range` work per scroll tick.
 *
 * Only *direct* child text nodes are measured. Every descendant element gets
 * its own visit in the walk, so descending here would double-count.
 */
export function measureInkRects(el: Element, box: { left: number; top: number }): Rect[] {
  if (!canMeasureRanges()) return [];

  const viewportRects: Rect[] = [];

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue;
    if ((node.textContent ?? "").trim() === "") continue;

    const range = document.createRange();
    range.selectNodeContents(node);

    for (const rect of Array.from(range.getClientRects())) {
      viewportRects.push({
        x0: rect.left,
        y0: rect.top,
        x1: rect.right,
        y1: rect.bottom,
      });
    }
  }

  return coalesceInkRects(viewportRects).map((rect) => ({
    x0: rect.x0 - box.left,
    y0: rect.y0 - box.top,
    x1: rect.x1 - box.left,
    y1: rect.y1 - box.top,
  }));
}
