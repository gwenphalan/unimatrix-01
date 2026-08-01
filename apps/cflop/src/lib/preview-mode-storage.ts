import { z } from "zod";

import {
  DIAGRAM_PREVIEW_MODES,
  type DiagramPreviewMode,
  INITIAL_PREVIEW_MODE,
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

/**
 * Returns the raw stored preference, or `INITIAL_PREVIEW_MODE` when there is none. The result is
 * not yet safe to render - the selected set may not offer it, which is `resolvePreviewMode`'s job.
 */
export function readPreviewMode(scope: PreviewModeScope): DiagramPreviewMode {
  const parsed = previewModeSchema.safeParse(readStoredValue(storageKey(scope)));

  return parsed.success ? parsed.data : INITIAL_PREVIEW_MODE;
}

export function writePreviewMode(scope: PreviewModeScope, mode: DiagramPreviewMode): void {
  writeStoredValue(storageKey(scope), mode);
}
