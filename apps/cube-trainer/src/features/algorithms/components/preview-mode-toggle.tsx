import { RiBox3Line, RiEyeOffLine, RiGridLine } from "@remixicon/react";
import { ToggleGroup, ToggleGroupItem } from "@unimatrix/ui/public";

import type { DiagramPreviewMode } from "@/features/algorithms/preview-mode";
import { previewModesForSet } from "@/features/algorithms/preview-mode";
import type { AlgorithmSetId } from "@/features/algorithms/types";

const MODE_OPTIONS: Record<DiagramPreviewMode, { icon: typeof RiGridLine; label: string }> = {
  hidden: { icon: RiEyeOffLine, label: "Hidden" },
  "top-down": { icon: RiGridLine, label: "Top" },
  "two-sided": { icon: RiBox3Line, label: "2-Side" },
};

export interface PreviewModeToggleProps {
  /** Must already be resolved for `setId` - Radix leaves the group unselected otherwise. */
  mode: DiagramPreviewMode;
  onChange: (mode: DiagramPreviewMode) => void;
  setId: AlgorithmSetId;
}

export function PreviewModeToggle({ mode, onChange, setId }: PreviewModeToggleProps) {
  return (
    <ToggleGroup
      aria-label="Preview mode"
      onValueChange={(value) => {
        if (value) onChange(value as DiagramPreviewMode);
      }}
      type="single"
      value={mode}
      variant="outline"
    >
      {previewModesForSet(setId).map((option) => {
        const { icon: Icon, label } = MODE_OPTIONS[option];

        return (
          <ToggleGroupItem aria-label={label} key={option} value={option}>
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
