import { z } from "zod";

import {
  DEFAULT_PREVIEW_MODE,
  DIAGRAM_PREVIEW_MODES,
  type DiagramPreviewMode,
} from "@/features/algorithms/preview-mode";

/**
 * Learn and Drill keep separate preferences on purpose: drilling is a recall test, so hiding
 * the preview there is the common case, while a teaching pass usually wants it visible. One
 * shared key would make the two modes fight over the same value.
 */
export type PreviewModeScope = "drill" | "learn";

const previewModeSchema = z.enum(DIAGRAM_PREVIEW_MODES);

function storageKey(scope: PreviewModeScope): string {
  return `cube-trainer:preview-mode:${scope}`;
}

export function readPreviewMode(scope: PreviewModeScope): DiagramPreviewMode {
  let raw: string | null;

  try {
    raw = window.localStorage.getItem(storageKey(scope));
  } catch {
    return DEFAULT_PREVIEW_MODE;
  }

  const parsed = previewModeSchema.safeParse(raw);

  return parsed.success ? parsed.data : DEFAULT_PREVIEW_MODE;
}

export function writePreviewMode(scope: PreviewModeScope, mode: DiagramPreviewMode): void {
  try {
    window.localStorage.setItem(storageKey(scope), mode);
  } catch {
    // Storage can be unavailable (private browsing, quota). The preference is
    // best-effort and safe to drop silently in that case.
  }
}
