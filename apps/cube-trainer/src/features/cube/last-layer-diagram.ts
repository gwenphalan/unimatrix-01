import { extractLastLayer } from "./model";
import type { FaceLetter, FaceletCube } from "./model";

export type DiagramSticker =
  { kind: "oriented" } | { kind: "unknown" } | { kind: "color"; face: FaceLetter };

export interface LastLayerDiagram {
  top: DiagramSticker[];
  sides: {
    front: DiagramSticker[];
    right: DiagramSticker[];
    back: DiagramSticker[];
    left: DiagramSticker[];
  };
}

const ORIENTED: DiagramSticker = { kind: "oriented" };
const UNKNOWN: DiagramSticker = { kind: "unknown" };

function orientedOrUnknown(facelet: FaceLetter): DiagramSticker {
  return facelet === "U" ? ORIENTED : UNKNOWN;
}

function colorSticker(facelet: FaceLetter): DiagramSticker {
  return { face: facelet, kind: "color" };
}

/**
 * `extractLastLayer`'s side rows are each 3 facelets in that face's own row-major order
 * (documented on `FaceletCube`), which doesn't match how the row should be drawn next to
 * the top-face square: front/left already read left-to-right/top-to-bottom in drawing
 * order, but back and right are backwards (B's own col 0 touches R, not L; R's own col 0
 * touches F, not B) - matching the model's documented U-face convention (col 0 = left,
 * touching L; row 0 = back).
 */
function toDrawingOrder(row: FaceLetter[], reversed: boolean): FaceLetter[] {
  // `row` is always the fixed 3-facelet slice `extractLastLayer` returns for one side.
  const [a, b, c] = row as [FaceLetter, FaceLetter, FaceLetter];
  return reversed ? [c, b, a] : [a, b, c];
}

function buildDiagram(
  cube: FaceletCube,
  sideSticker: (facelet: FaceLetter) => DiagramSticker,
): LastLayerDiagram {
  const { sideRows, top } = extractLastLayer(cube);

  return {
    sides: {
      back: toDrawingOrder(sideRows.back, true).map(sideSticker),
      front: toDrawingOrder(sideRows.front, false).map(sideSticker),
      left: toDrawingOrder(sideRows.left, false).map(sideSticker),
      right: toDrawingOrder(sideRows.right, true).map(sideSticker),
    },
    top: top.map(orientedOrUnknown),
  };
}

/** OLL only guarantees orientation - side stickers show whether they're oriented (peeking the top color), never their actual color. */
export function deriveOllDiagram(cube: FaceletCube): LastLayerDiagram {
  return buildDiagram(cube, orientedOrUnknown);
}

/** PLL never touches orientation (top is read the same way and will naturally show fully oriented) - side stickers show their actual color, since permutation is what a PLL diagram communicates. */
export function derivePllDiagram(cube: FaceletCube): LastLayerDiagram {
  return buildDiagram(cube, colorSticker);
}

/**
 * The isometric two-sided view: the whole U face plus the last-layer row of F and R, drawn as
 * a cube corner. Unlike `LastLayerDiagram`, whose `right` row is reversed to read outward from
 * the flat net, both rows here are in `extractLastLayer`'s own slice order, which is already
 * left-to-right on screen for a viewer facing the U-F-R corner: F's col 0 touches L (screen
 * left) and R's col 0 touches F (also screen left, since +z projects leftward).
 */
export interface CornerDiagram {
  /** 9 stickers in the same row-major U order as `LastLayerDiagram.top` (row 0 touches B). */
  top: DiagramSticker[];
  /** 3 stickers, screen left-to-right. */
  front: DiagramSticker[];
  /** 3 stickers, screen left-to-right (F-adjacent first). */
  right: DiagramSticker[];
}

function buildCornerDiagram(
  cube: FaceletCube,
  sideSticker: (facelet: FaceLetter) => DiagramSticker,
): CornerDiagram {
  const { sideRows, top } = extractLastLayer(cube);

  return {
    front: sideRows.front.map(sideSticker),
    right: sideRows.right.map(sideSticker),
    top: top.map(orientedOrUnknown),
  };
}

/** Only PLL offers the two-sided view (see `previewModesForSet`), so only its derivation exists. */
export function derivePllCornerDiagram(cube: FaceletCube): CornerDiagram {
  return buildCornerDiagram(cube, colorSticker);
}

export const DIAGRAM_PALETTE: Record<FaceLetter, string> = {
  B: "#3b82f6",
  D: "#f8fafc",
  F: "#22c55e",
  L: "#f97316",
  R: "#ef4444",
  U: "#eab308",
};

export const DIAGRAM_UNKNOWN_COLOR = "#52525b";

/**
 * The two layers below the last layer in the two-sided view. Deliberately darker than
 * `DIAGRAM_UNKNOWN_COLOR` so "this facelet is irrelevant to the case" never reads the same as
 * OLL's "this facelet's color is unknown".
 */
export const DIAGRAM_LOWER_LAYER_COLOR = "#3f3f46";

export function diagramStickerColor(sticker: DiagramSticker): string {
  if (sticker.kind === "unknown") return DIAGRAM_UNKNOWN_COLOR;
  if (sticker.kind === "oriented") return DIAGRAM_PALETTE.U;
  return DIAGRAM_PALETTE[sticker.face];
}
