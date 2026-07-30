import { z } from "zod";

import {
  DEFAULT_PREVIEW_MODE,
  DIAGRAM_PREVIEW_MODES,
  type DiagramPreviewMode,
} from "@/features/algorithms/preview-mode";

import { readStoredValue, writeStoredValue } from "./local-storage";

/**
 * Learn and Drill keep separate preferences on purpose: drilling is a recall test, so hiding
 * the preview there is the common case, while a teaching pass usually wants it visible. One
 * shared key would make the two modes fight over the same value.
 */
export type PreviewModeScope = "drill" | "learn";

const previewModeSchema = z.enum(DIAGRAM_PREVIEW_MODES);

function storageKey(scope: PreviewModeScope): string {
  return `preview-mode:${scope}`;
}

export function readPreviewMode(scope: PreviewModeScope): DiagramPreviewMode {
  const parsed = previewModeSchema.safeParse(readStoredValue(storageKey(scope)));

  return parsed.success ? parsed.data : DEFAULT_PREVIEW_MODE;
}

export function writePreviewMode(scope: PreviewModeScope, mode: DiagramPreviewMode): void {
  writeStoredValue(storageKey(scope), mode);
}
