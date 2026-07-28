/**
 * Screen geometry for the two-sided (isometric corner) diagram. Kept separate from the SVG
 * component so the projection is testable as plain data rather than through a rendered tree.
 *
 * The projection is the standard isometric one over the same xyz frame `model.ts` uses
 * (x: L->R, y: D->U, z: B->F): +x goes right-and-down the screen, +z goes left-and-down, +y
 * goes straight up. That puts F on the screen-left, R on the screen-right, and U as a rhombus
 * above both - the U-F-R corner pointing at the viewer. Only three faces are ever visible, so
 * there is no hidden-surface ordering to get wrong.
 */
const COS_30 = Math.cos(Math.PI / 6);
const SIN_30 = 0.5;

/** Half the cube's edge length in model units; face planes sit at +/- this. */
const HALF = 1.5;

/**
 * Chosen so the silhouette's height (6 model units) fills 160px, matching how much of its own
 * 180px viewBox the top-down diagram covers. Both views therefore read at the same weight and
 * a mode switch does not resize the cube.
 */
const SCALE = 160 / (2 * HALF * 2);

export const CORNER_VIEWBOX_SIZE = 180;

const CENTER = CORNER_VIEWBOX_SIZE / 2;

export type CornerFace = "front" | "right" | "top";

export interface CornerCellPolygon {
  face: CornerFace;
  row: number;
  col: number;
  /** An SVG `points` attribute value. */
  points: string;
}

/** Projects a model-space point to SVG user units inside `CORNER_VIEWBOX_SIZE`. */
export function projectCornerPoint(x: number, y: number, z: number): readonly [number, number] {
  return [CENTER + (x - z) * COS_30 * SCALE, CENTER + ((x + z) * SIN_30 - y) * SCALE];
}

function toPoints(corners: readonly (readonly [number, number, number])[]): string {
  return corners
    .map(([x, y, z]) => {
      const [screenX, screenY] = projectCornerPoint(x, y, z);
      return `${screenX.toFixed(3)},${screenY.toFixed(3)}`;
    })
    .join(" ");
}

/**
 * Each face's cell corners in its own (row, col) convention from `model.ts`, wound so the
 * quad stays simple: the projection is affine on a face's plane, so a rectangle wound in
 * order stays a parallelogram wound in order.
 */
function cellCorners(
  face: CornerFace,
  row: number,
  col: number,
): readonly (readonly [number, number, number])[] {
  switch (face) {
    case "top": {
      // U: row 0 touches B (z = -HALF side), col 0 touches L (x = -HALF side).
      const [x0, x1] = [col - HALF, col + 1 - HALF];
      const [z0, z1] = [row - HALF, row + 1 - HALF];
      return [
        [x0, HALF, z0],
        [x1, HALF, z0],
        [x1, HALF, z1],
        [x0, HALF, z1],
      ];
    }
    case "front": {
      // F: row 0 touches U, col 0 touches L.
      const [x0, x1] = [col - HALF, col + 1 - HALF];
      const [y0, y1] = [HALF - row, HALF - row - 1];
      return [
        [x0, y0, HALF],
        [x1, y0, HALF],
        [x1, y1, HALF],
        [x0, y1, HALF],
      ];
    }
    case "right": {
      // R: row 0 touches U, col 0 touches F (z = +HALF side).
      const [z0, z1] = [HALF - col, HALF - col - 1];
      const [y0, y1] = [HALF - row, HALF - row - 1];
      return [
        [HALF, y0, z0],
        [HALF, y0, z1],
        [HALF, y1, z1],
        [HALF, y1, z0],
      ];
    }
    default:
      throw new Error(`Unrecognized corner face: ${String(face)}`);
  }
}

function facePolygons(face: CornerFace): CornerCellPolygon[] {
  const polygons: CornerCellPolygon[] = [];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      polygons.push({ col, face, points: toPoints(cellCorners(face, row, col)), row });
    }
  }

  return polygons;
}

/** The 9 cells of each visible face, in row-major order per face. Constant, so computed once. */
export const CORNER_CELLS: Readonly<Record<CornerFace, readonly CornerCellPolygon[]>> = {
  front: facePolygons("front"),
  right: facePolygons("right"),
  top: facePolygons("top"),
};

/** The outer hexagon of the three visible faces, for a single crisp silhouette stroke. */
export const CORNER_SILHOUETTE = toPoints([
  [-HALF, HALF, -HALF],
  [HALF, HALF, -HALF],
  [HALF, -HALF, -HALF],
  [HALF, -HALF, HALF],
  [-HALF, -HALF, HALF],
  [-HALF, HALF, HALF],
]);
