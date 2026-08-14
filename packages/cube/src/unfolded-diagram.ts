import { DIAGRAM_PALETTE } from "./last-layer-diagram.js";
import { FACE_ORDER, faceletIndex } from "./model.js";
import type { FaceLetter, FaceletCube } from "./model.js";

/**
 * A cross-shaped unfolded net of all six faces, rather than the last-layer views' three-or-fewer
 * faces. Keys are net positions (which square of the cross); values are each of that square's 9
 * facelets, each holding the face letter it started on (its colour) - same convention as
 * `FaceletCube` itself. Unlike `LastLayerDiagram`, a net position's facelets need not match its
 * key: after scrambling, the square drawn at "R" can show facelets whose home face is anything.
 */
export type UnfoldedCubeDiagram = Record<FaceLetter, FaceLetter[]>;

/**
 * Reads one facelet the way `readFacelet` in `engine.ts` does - throwing on a missing index -
 * rather than the way `extractLastLayer` in `model.ts` does, which slices with no length check.
 * A short or malformed `FaceletCube` would otherwise produce `undefined` entries that flow all
 * the way to `PALETTE[undefined]` (itself `undefined`) and render as SVG's default black: six
 * black cells with lint, typecheck, tests and coverage all green.
 */
function readFacelet(cube: FaceletCube, face: FaceLetter, row: number, col: number): FaceLetter {
  const value = cube[faceletIndex(face, row, col)];
  if (value === undefined) {
    throw new Error(`Facelet cube missing a value for face ${face} at row ${row}, col ${col}`);
  }
  return value;
}

/**
 * Every face is drawn row 0 at the top, col 0 at the left, straight out of the model's own
 * row/col convention (documented on `FaceletCube`) - there is no `toDrawingOrder`-style row
 * reversal here, including on B and R. That reversal exists in `last-layer-diagram.ts` only
 * because those rows are drawn as flaps folded *around* the U square in the last-layer view; in
 * a cross net every face is drawn flat, so its own row-major order is already the drawing order.
 * B reads left-to-right in the same sense as the others because `model.ts` documents B's col 0 as
 * touching R, which sits immediately left of B in this net's middle band.
 */
export function deriveUnfoldedDiagram(cube: FaceletCube): UnfoldedCubeDiagram {
  const readFace = (face: FaceLetter): FaceLetter[] => {
    const facelets: FaceLetter[] = [];

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        facelets.push(readFacelet(cube, face, row, col));
      }
    }

    return facelets;
  };

  // Written out rather than accumulated into a `{} as UnfoldedCubeDiagram`: the cast would let a
  // missing face through the typechecker, and a missing face is a whole undrawn square.
  return {
    B: readFace("B"),
    D: readFace("D"),
    F: readFace("F"),
    L: readFace("L"),
    R: readFace("R"),
    U: readFace("U"),
  };
}

/**
 * The standard western scheme held white-up, green-front - `DIAGRAM_PALETTE` held yellow-up,
 * green-front (see that constant's own comment). Swapping U<->D and L<->R is a half turn about
 * the F-B axis (`z2`: U and D swap, L and R swap, F and B stay fixed), which is
 * orientation-preserving and so cannot introduce a mirror. Derived from `DIAGRAM_PALETTE` rather
 * than six fresh hex literals, so the two constants can never drift out of the relationship that
 * makes both of them correct. `DIAGRAM_PALETTE` keeps its own values: the last-layer derivations
 * are read yellow-up and are correct as they stand.
 */
export const WHITE_UP_DIAGRAM_PALETTE: Record<FaceLetter, string> = {
  B: DIAGRAM_PALETTE.B,
  D: DIAGRAM_PALETTE.U,
  F: DIAGRAM_PALETTE.F,
  L: DIAGRAM_PALETTE.R,
  R: DIAGRAM_PALETTE.L,
  U: DIAGRAM_PALETTE.D,
};

/**
 * The fill color for one net cell: looks up the home face of the facelet sitting at that grid
 * position in `WHITE_UP_DIAGRAM_PALETTE`. Throws the same way `readFacelet` does above, rather
 * than indexing the palette with `undefined` - `UnfoldedCubeDiagram`'s type only promises 9
 * entries per face, `noUncheckedIndexedAccess` doesn't know `deriveUnfoldedDiagram` always keeps
 * that promise.
 */
export function unfoldedNetCellColor(diagram: UnfoldedCubeDiagram, cell: UnfoldedNetCell): string {
  const facelet = diagram[cell.face][cell.row * 3 + cell.col];
  if (facelet === undefined) {
    throw new Error(
      `Unfolded diagram missing a facelet for face ${cell.face} at row ${cell.row}, col ${cell.col}`,
    );
  }
  return WHITE_UP_DIAGRAM_PALETTE[facelet];
}

const CELL = 40;
const NET_COLS = 12;
const NET_ROWS = 9;

/**
 * Blank space between the net's outer edge and the canvas edge. An SVG root clips at its viewBox
 * and a stroke straddles the path it outlines, so without this the face outlines lying on the
 * boundary - L's left, U's top, B's right, D's bottom - would lose their outer half and render at
 * half the weight of every interior seam. `corner-projection.ts` leaves the same kind of room.
 */
const MARGIN = 2;

/** Edge length, in SVG user units, of one net cell - what a consuming view sizes its `<rect>`s with. */
export const UNFOLDED_NET_CELL_SIZE = CELL;

export const UNFOLDED_NET_WIDTH = NET_COLS * CELL + 2 * MARGIN;
export const UNFOLDED_NET_HEIGHT = NET_ROWS * CELL + 2 * MARGIN;

/** Each face's top-left corner, in cells, within the 12x9-cell net grid. */
const FACE_ORIGIN_CELLS: Record<FaceLetter, { col: number; row: number }> = {
  B: { col: 9, row: 3 },
  D: { col: 3, row: 6 },
  F: { col: 3, row: 3 },
  L: { col: 0, row: 3 },
  R: { col: 6, row: 3 },
  U: { col: 3, row: 0 },
};

export interface UnfoldedNetCell {
  col: number;
  face: FaceLetter;
  row: number;
  x: number;
  y: number;
}

function buildNetCells(): UnfoldedNetCell[] {
  const cells: UnfoldedNetCell[] = [];

  for (const face of FACE_ORDER) {
    const origin = FACE_ORIGIN_CELLS[face];

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        cells.push({
          col,
          face,
          row,
          x: MARGIN + (origin.col + col) * CELL,
          y: MARGIN + (origin.row + row) * CELL,
        });
      }
    }
  }

  return cells;
}

/** The net grid's 54 cells (9 per face), computed once at module load. */
export const UNFOLDED_NET_CELLS: readonly UnfoldedNetCell[] = buildNetCells();

function buildFaceOutlines(): {
  face: FaceLetter;
  height: number;
  width: number;
  x: number;
  y: number;
}[] {
  return FACE_ORDER.map((face) => {
    const origin = FACE_ORIGIN_CELLS[face];

    return {
      face,
      height: 3 * CELL,
      width: 3 * CELL,
      x: MARGIN + origin.col * CELL,
      y: MARGIN + origin.row * CELL,
    };
  });
}

/** The six 120x120 face outlines, computed once at module load. */
export const UNFOLDED_NET_FACE_OUTLINES: readonly {
  face: FaceLetter;
  height: number;
  width: number;
  x: number;
  y: number;
}[] = buildFaceOutlines();
