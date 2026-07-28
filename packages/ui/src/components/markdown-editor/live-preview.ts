import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Node names produced by `@codemirror/lang-markdown`'s Lezer grammar that
 * carry syntax characters rather than content — `##`, `**`, `` ` ``, `>`, and
 * the bracket/paren runs in a link.
 *
 * These are hidden while the cursor is elsewhere and revealed the moment the
 * caret enters their line, which is what makes the document read as formatted
 * text while still being plain markdown underneath. That is the Obsidian
 * behaviour, and it is only possible because the document *is* the markdown:
 * nothing is serialized, so nothing can be lost.
 */
const SYNTAX_MARK_NODES = new Set([
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
]);

/** Inline nodes styled as their rendered form. */
const STYLED_INLINE_NODES = new Map([
  ["Emphasis", "cm-md-emphasis"],
  ["StrongEmphasis", "cm-md-strong"],
  ["InlineCode", "cm-md-inline-code"],
  ["Strikethrough", "cm-md-strikethrough"],
  ["Link", "cm-md-link"],
  ["URL", "cm-md-url"],
]);

/** Block nodes styled by line, so the whole line picks up the treatment. */
const STYLED_LINE_NODES = new Map([
  ["ATXHeading1", "cm-md-heading-1"],
  ["ATXHeading2", "cm-md-heading-2"],
  ["ATXHeading3", "cm-md-heading-3"],
  ["ATXHeading4", "cm-md-heading-4"],
  ["ATXHeading5", "cm-md-heading-5"],
  ["ATXHeading6", "cm-md-heading-6"],
  ["Blockquote", "cm-md-blockquote"],
  ["FencedCode", "cm-md-code-block"],
  ["CodeBlock", "cm-md-code-block"],
]);

const hiddenMark = Decoration.replace({});

/**
 * Parents whose `URL` child is the target of an explicit `[text](url)` or
 * `![alt](url)` — redundant on screen once the brackets are hidden.
 *
 * A bare autolink is also a `URL` node, but its parent is `Autolink`, and
 * hiding that one would erase the only text the line has.
 */
const LINK_TARGET_PARENTS = new Set(["Link", "Image"]);

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const { state } = view;
  // Lines the caret or a selection touches keep their syntax visible: hiding
  // the characters being edited is exactly when a live-preview editor becomes
  // frustrating.
  const activeLines = new Set<number>();

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;

    for (let line = first; line <= last; line += 1) {
      activeLines.add(line);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const inlineClass = STYLED_INLINE_NODES.get(node.name);

        if (inlineClass !== undefined && node.to > node.from) {
          decorations.push(Decoration.mark({ class: inlineClass }).range(node.from, node.to));
        }

        const lineClass = STYLED_LINE_NODES.get(node.name);

        if (lineClass !== undefined) {
          const firstLine = state.doc.lineAt(node.from).number;
          const lastLine = state.doc.lineAt(node.to).number;

          for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
            const line = state.doc.line(lineNumber);

            decorations.push(Decoration.line({ class: lineClass }).range(line.from));
          }
        }

        const isLinkTarget =
          node.name === "URL" && LINK_TARGET_PARENTS.has(node.node.parent?.name ?? "");

        if ((SYNTAX_MARK_NODES.has(node.name) || isLinkTarget) && node.to > node.from) {
          const lineNumber = state.doc.lineAt(node.from).number;

          if (!activeLines.has(lineNumber)) {
            decorations.push(hiddenMark.range(node.from, node.to));
          }
        }
      },
    });
  }

  // `true` sorts the set. The tree walk emits nodes in document order, but
  // line decorations are pushed from a nested loop and would otherwise break
  // the strict ordering `Decoration.set` requires.
  return Decoration.set(decorations, true);
}

/**
 * Obsidian-style live preview: markdown text, styled as it will render, with
 * syntax characters hidden unless the caret is on their line.
 *
 * Detaching this extension leaves the same document as plain source — which is
 * how the editor's "Raw" mode is implemented.
 */
export const markdownLivePreview: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      // Selection matters as much as document changes here: moving the caret
      // onto a line is what reveals that line's syntax.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export const markdownLivePreviewTheme: Extension = EditorView.theme({
  ".cm-md-heading-1": { fontSize: "1.6em", fontWeight: "500", lineHeight: "1.25" },
  ".cm-md-heading-2": { fontSize: "1.4em", fontWeight: "500", lineHeight: "1.3" },
  ".cm-md-heading-3": { fontSize: "1.2em", fontWeight: "500" },
  ".cm-md-heading-4": { fontSize: "1.1em", fontWeight: "500" },
  ".cm-md-heading-5": { fontWeight: "500" },
  ".cm-md-heading-6": { fontWeight: "500", opacity: "0.85" },
  ".cm-md-blockquote": {
    borderLeft: "2px solid var(--border)",
    paddingLeft: "0.75rem",
    color: "var(--muted-foreground)",
  },
  ".cm-md-code-block": { backgroundColor: "color-mix(in oklab, var(--muted) 45%, transparent)" },
  ".cm-md-strong": { fontWeight: "600" },
  ".cm-md-emphasis": { fontStyle: "italic" },
  ".cm-md-strikethrough": { textDecoration: "line-through" },
  ".cm-md-inline-code": {
    backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)",
    padding: "0.1em 0.3em",
  },
  ".cm-md-link": { color: "var(--primary)" },
  ".cm-md-url": { color: "var(--muted-foreground)" },
});
