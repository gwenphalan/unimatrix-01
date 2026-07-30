import { cn } from "@unimatrix/ui/public";

import {
  CORNER_CELLS,
  CORNER_SILHOUETTE,
  CORNER_VIEWBOX_SIZE,
  type CornerCellPolygon,
} from "@/features/cube/corner-projection";
import { DIAGRAM_LOWER_LAYER_COLOR, diagramStickerColor } from "@/features/cube/last-layer-diagram";
import type { CornerDiagram, DiagramSticker } from "@/features/cube/last-layer-diagram";

const STROKE_COLOR = "#0f172a";

export interface CornerDiagramViewProps {
  className?: string;
  diagram: CornerDiagram;
  /** Accessible name for the diagram, e.g. a case's display name. Omit to keep the diagram decorative (`aria-hidden`) when the case is being tested rather than shown. */
  label?: string;
  size?: number;
}

/**
 * The two-sided view: the whole U face plus the last-layer row of F and R, drawn as a cube
 * corner. The two layers below the last layer carry no case information, so they render in a
 * flat filler color rather than their real (and, for a last-layer case, always solved) colors.
 */
export function CornerDiagramView({
  className,
  diagram,
  label,
  size = 160,
}: CornerDiagramViewProps) {
  const renderCell = (cell: CornerCellPolygon, sticker: DiagramSticker | undefined) => (
    <polygon
      fill={sticker ? diagramStickerColor(sticker) : DIAGRAM_LOWER_LAYER_COLOR}
      key={`${cell.face}-${cell.row}-${cell.col}`}
      points={cell.points}
      stroke={STROKE_COLOR}
      strokeLinejoin="round"
      strokeWidth={1.5}
    />
  );

  return (
    <svg
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={cn("shrink-0", className)}
      height={size}
      role={label ? "img" : undefined}
      viewBox={`0 0 ${CORNER_VIEWBOX_SIZE} ${CORNER_VIEWBOX_SIZE}`}
      width={size}
    >
      {CORNER_CELLS.top.map((cell) => renderCell(cell, diagram.top[cell.row * 3 + cell.col]))}
      {CORNER_CELLS.front.map((cell) =>
        renderCell(cell, cell.row === 0 ? diagram.front[cell.col] : undefined),
      )}
      {CORNER_CELLS.right.map((cell) =>
        renderCell(cell, cell.row === 0 ? diagram.right[cell.col] : undefined),
      )}
      <polygon
        fill="none"
        points={CORNER_SILHOUETTE}
        stroke={STROKE_COLOR}
        strokeLinejoin="round"
        strokeWidth={2.5}
      />
    </svg>
  );
}
