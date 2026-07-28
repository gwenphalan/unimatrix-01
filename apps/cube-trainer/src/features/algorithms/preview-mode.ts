import type { AlgorithmSetId } from "./types";

/** Ordered as the segmented toggle renders them, least-hidden first. */
export const DIAGRAM_PREVIEW_MODES = ["top-down", "two-sided", "hidden"] as const;

export type DiagramPreviewMode = (typeof DIAGRAM_PREVIEW_MODES)[number];

export const DEFAULT_PREVIEW_MODE: DiagramPreviewMode = "top-down";

const OLL_PREVIEW_MODES: readonly DiagramPreviewMode[] = ["top-down", "hidden"];
const PLL_PREVIEW_MODES: readonly DiagramPreviewMode[] = ["top-down", "two-sided", "hidden"];

/**
 * OLL has no two-sided mode: the two-sided view exists to read a case's real side colors,
 * which is what PLL communicates. OLL's own side stickers are oriented/unoriented rather
 * than colors, so its toggle stays top-down vs hidden.
 */
export function previewModesForSet(setId: AlgorithmSetId): readonly DiagramPreviewMode[] {
  return setId === "oll" ? OLL_PREVIEW_MODES : PLL_PREVIEW_MODES;
}

/**
 * Clamps a stored preference to something the current set actually offers. The stored value
 * is deliberately left untouched so "two-sided" survives a round trip through OLL, but every
 * consumer - including the toggle's own `value` - must use the resolved mode: handing Radix a
 * value matching none of the rendered items leaves the group with nothing selected.
 */
export function resolvePreviewMode(
  setId: AlgorithmSetId,
  mode: DiagramPreviewMode,
): DiagramPreviewMode {
  return previewModesForSet(setId).includes(mode) ? mode : DEFAULT_PREVIEW_MODE;
}
