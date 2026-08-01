import type { AlgorithmSetId } from "./types";

/** Ordered as the segmented toggle renders them, least-hidden first. */
export const DIAGRAM_PREVIEW_MODES = ["top-down", "two-sided", "hidden"] as const;

export type DiagramPreviewMode = (typeof DIAGRAM_PREVIEW_MODES)[number];

/**
 * What a view opens on before anything is stored. Two-sided is the richest preview, and PLL -
 * the only set that offers it - is where a learner needs the real side colors. It is not the
 * same value as a set's clamp fallback below, because OLL cannot render it.
 */
export const INITIAL_PREVIEW_MODE: DiagramPreviewMode = "two-sided";

const OLL_PREVIEW_MODES: readonly DiagramPreviewMode[] = ["top-down", "hidden"];
const PLL_PREVIEW_MODES: readonly DiagramPreviewMode[] = ["top-down", "two-sided", "hidden"];

/**
 * Where a mode a set does not offer lands. Per set rather than one shared constant: OLL has no
 * two-sided mode at all, so it must clamp to something else, while PLL clamping to two-sided is
 * what makes `INITIAL_PREVIEW_MODE` reach the toggle unchanged. Written out per set rather than
 * taken from the head of each array above - both arrays start with `top-down`, so that shortcut
 * would silently give PLL the wrong value.
 */
const PREVIEW_MODE_FALLBACKS: Record<AlgorithmSetId, DiagramPreviewMode> = {
  oll: "top-down",
  pll: "two-sided",
};

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
 * value matching none of the rendered items leaves the group with nothing selected. That is also
 * why the fallback is per set: a single shared default would have to be a mode one of the two
 * sets cannot render, and clamping to it would produce exactly that unselected group.
 */
export function resolvePreviewMode(
  setId: AlgorithmSetId,
  mode: DiagramPreviewMode,
): DiagramPreviewMode {
  return previewModesForSet(setId).includes(mode) ? mode : PREVIEW_MODE_FALLBACKS[setId];
}
