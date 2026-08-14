import { cn } from "@unimatrix/ui/public";

import {
  UNFOLDED_NET_CELL_SIZE,
  UNFOLDED_NET_CELLS,
  UNFOLDED_NET_FACE_OUTLINES,
  UNFOLDED_NET_HEIGHT,
  UNFOLDED_NET_WIDTH,
  unfoldedNetCellColor,
} from "../unfolded-diagram.js";
import type { UnfoldedCubeDiagram } from "../unfolded-diagram.js";

const STROKE_COLOR = "#0f172a";

export interface UnfoldedCubeDiagramViewProps {
  className?: string;
  diagram: UnfoldedCubeDiagram;
  /** Accessible name for the diagram, e.g. a case's display name. Omit to keep the diagram decorative (`aria-hidden`) when the case is being tested rather than shown. */
  label?: string;
  /** Sets the rendered WIDTH only - the net is 4:3, not square like the two sibling views, so the height is derived from it rather than set independently. */
  size?: number;
}

export function UnfoldedCubeDiagramView({
  className,
  diagram,
  label,
  size = 240,
}: UnfoldedCubeDiagramViewProps) {
  return (
    <svg
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={cn("shrink-0", className)}
      height={(size * UNFOLDED_NET_HEIGHT) / UNFOLDED_NET_WIDTH}
      role={label ? "img" : undefined}
      viewBox={`0 0 ${UNFOLDED_NET_WIDTH} ${UNFOLDED_NET_HEIGHT}`}
      width={size}
    >
      {UNFOLDED_NET_CELLS.map((cell) => (
        <rect
          fill={unfoldedNetCellColor(diagram, cell)}
          height={UNFOLDED_NET_CELL_SIZE}
          key={`${cell.face}-${cell.row}-${cell.col}`}
          stroke={STROKE_COLOR}
          strokeWidth={1.5}
          width={UNFOLDED_NET_CELL_SIZE}
          x={cell.x}
          y={cell.y}
        />
      ))}
      {UNFOLDED_NET_FACE_OUTLINES.map((outline) => (
        <rect
          fill="none"
          height={outline.height}
          key={outline.face}
          stroke={STROKE_COLOR}
          strokeWidth={2.5}
          width={outline.width}
          x={outline.x}
          y={outline.y}
        />
      ))}
    </svg>
  );
}
