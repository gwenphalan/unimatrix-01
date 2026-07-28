/**
 * The editing surface, kept out of both other entry points on purpose.
 *
 * This split is not stylistic. Measured on this app's production build: a
 * barrel's whole re-export graph lands in the chunk that imports it, whether
 * or not anything imports the symbols. Adding just `MarkdownEditor` to
 * `./public` took the public chunk from 444.58 kB to 942.26 kB (gzip 139.62
 * to 312.96) — CodeMirror, shipped to every anonymous reader on every page —
 * with nothing in `apps/web` importing it. `sideEffects: false` and
 * `treeshake: { moduleSideEffects: false }` both changed nothing.
 *
 * So `./public` stays the narrow primitive set the public site imports,
 * pinned to an exact export list by `apps/web/test/public-ui-usage.test.ts`,
 * the root barrel stays un-importable from `apps/web`, and everything the
 * editor needs lives here. Anything added here reaches the browser only
 * through a dynamic `import()`; anything moved to `./public` is paid for by
 * every visitor.
 */
export {
  MarkdownEditor,
  MARKDOWN_EDITOR_MODES,
} from "./components/markdown-editor/markdown-editor.js";
export type {
  MarkdownEditorHandle,
  MarkdownEditorMode,
  MarkdownEditorProps,
} from "./components/markdown-editor/markdown-editor.js";
export { markdownLivePreview } from "./components/markdown-editor/live-preview.js";
