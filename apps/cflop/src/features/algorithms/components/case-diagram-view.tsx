import { useMemo } from "react";
import { RiEyeOffLine } from "@remixicon/react";
import { derivePllCornerDiagram } from "@unimatrix/cube";
import type { FaceletCube } from "@unimatrix/cube";
import { CornerDiagramView, LastLayerDiagramView } from "@unimatrix/cube/react";

import { deriveDiagramForSet } from "@/features/algorithms/derive-diagram";
import type { DiagramPreviewMode } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";

export interface CaseDiagramViewProps {
  cube: FaceletCube;
  /** Accessible name for the diagram - required here, since a case under study is never decorative. */
  label: string;
  /** Must already be resolved for `setId` - see `resolvePreviewMode`. */
  mode: DiagramPreviewMode;
  setId: AlgorithmSetId;
  size?: number;
}

/**
 * Renders a case in whichever preview mode is active. Derivation lives here rather than in the
 * session hooks because which diagram a case needs is a rendering concern, and deriving it in
 * the component matches how the case-picker cards already work.
 */
export function CaseDiagramView({ cube, label, mode, setId, size = 160 }: CaseDiagramViewProps) {
  const topDownDiagram = useMemo(
    () => (mode === "top-down" ? deriveDiagramForSet(setId, cube) : undefined),
    [cube, mode, setId],
  );
  const cornerDiagram = useMemo(
    () => (mode === "two-sided" ? derivePllCornerDiagram(cube) : undefined),
    [cube, mode],
  );

  if (topDownDiagram) {
    return <LastLayerDiagramView diagram={topDownDiagram} label={label} size={size} />;
  }

  if (cornerDiagram) {
    return <CornerDiagramView diagram={cornerDiagram} label={label} size={size} />;
  }

  return (
    <div
      aria-label={`${label} (preview hidden)`}
      className="flex shrink-0 items-center justify-center gap-1.5 border border-dashed border-border/70 text-xs text-muted-foreground"
      role="img"
      style={{ height: size, width: size }}
    >
      <RiEyeOffLine aria-hidden="true" className="size-4" />
      Hidden
    </div>
  );
}
