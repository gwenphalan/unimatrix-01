/**
 * The editing surface, kept out of both other entry points on purpose.
 *
 * This split is not stylistic. Measured on this app's production build: a
 * barrel's whole re-export graph lands in the chunk that imports it, whether
 * or not anything imports the symbols. Adding one line — `export {
 * MarkdownEditor }` — to `./public` took the eagerly-loaded set (every script
 * `index.html` preloads) from 954.55 kB to 1452.14 kB raw, 289.62 kB to
 * 458.87 kB gzipped: CodeMirror, shipped to every anonymous reader on every
 * page, with nothing in `apps/web` importing it. Measure it that way rather
 * than by chunk name — rolldown reshuffles chunk boundaries and names between
 * tree states, so the eager total is the number that stays comparable.
 *
 * Three cheaper explanations were tested and ruled out. `sideEffects: false`
 * and `treeshake: { moduleSideEffects: false }` each changed nothing. Nor is
 * the cause the dynamic *namespace* import in
 * `apps/web/src/features/content/lazy-public-markdown.tsx`: replacing that
 * `await import("@unimatrix/ui/public")` with a static named import left the
 * editor in the eager set all the same. Dropping the export from `./public`
 * is the only change that moved it back behind a lazy boundary.
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
