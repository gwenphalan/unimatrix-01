import { useCallback, useState } from "react";

import type { DiagramPreviewMode } from "@/features/algorithms/preview-mode";
import {
  type PreviewModeScope,
  readPreviewMode,
  writePreviewMode,
} from "@/lib/preview-mode-storage";

export interface UsePreviewModeResult {
  /** The raw stored preference - clamp it with `resolvePreviewMode` before rendering. */
  previewMode: DiagramPreviewMode;
  setPreviewMode: (mode: DiagramPreviewMode) => void;
}

export function usePreviewMode(scope: PreviewModeScope): UsePreviewModeResult {
  const [previewMode, setStoredMode] = useState<DiagramPreviewMode>(() => readPreviewMode(scope));

  const setPreviewMode = useCallback(
    (mode: DiagramPreviewMode) => {
      writePreviewMode(scope, mode);
      setStoredMode(mode);
    },
    [scope],
  );

  return { previewMode, setPreviewMode };
}
