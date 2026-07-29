import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import {
  RiBold,
  RiCodeSSlashLine,
  RiCollapseDiagonalLine,
  RiDoubleQuotesL,
  RiExpandDiagonalLine,
  RiH1,
  RiItalic,
  RiLinkM,
  RiListUnordered,
} from "@remixicon/react";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { markdownLivePreview, markdownLivePreviewTheme } from "./live-preview.js";
import {
  insertLink,
  toggleInlineMarker,
  toggleLinePrefix,
  type MarkdownEdit,
} from "./markdown-commands.js";

/**
 * - `live`: markdown text with rendered styling and syntax hidden off-cursor.
 * - `raw`: the same text with the decorations detached.
 *
 * There is no read-only preview mode. `live` already shows the post the way it
 * reads, and the site renders it for real one click away; a third mode that
 * could not be typed into was a tab to leave and come back from rather than a
 * way of working.
 */
export const MARKDOWN_EDITOR_MODES = ["live", "raw"] as const;

export type MarkdownEditorMode = (typeof MARKDOWN_EDITOR_MODES)[number];

const MODE_LABELS: Record<MarkdownEditorMode, string> = {
  live: "Live",
  raw: "Raw",
};

/**
 * Toolbar buttons, in render order. Each is a pure edit over
 * `(document, selection)` so the toolbar's behaviour is testable without an
 * `EditorView` — see `./markdown-commands`.
 *
 * Deliberately short. This is a markdown editor: anything not on this list is
 * still one or two keystrokes away in the document itself, and a toolbar that
 * grows past a single row starts competing with the text for attention.
 */
const TOOLBAR_ACTIONS: {
  key: string;
  label: string;
  icon: typeof RiBold;
  apply: (doc: string, from: number, to: number) => MarkdownEdit;
}[] = [
  {
    key: "bold",
    label: "Bold",
    icon: RiBold,
    apply: (doc, from, to) => toggleInlineMarker(doc, from, to, "**"),
  },
  {
    key: "italic",
    label: "Italic",
    icon: RiItalic,
    apply: (doc, from, to) => toggleInlineMarker(doc, from, to, "*"),
  },
  {
    key: "code",
    label: "Inline code",
    icon: RiCodeSSlashLine,
    apply: (doc, from, to) => toggleInlineMarker(doc, from, to, "`"),
  },
  { key: "link", label: "Link", icon: RiLinkM, apply: insertLink },
  {
    key: "heading",
    label: "Heading",
    icon: RiH1,
    apply: (doc, from, to) => toggleLinePrefix(doc, from, to, "## "),
  },
  {
    key: "list",
    label: "Bullet list",
    icon: RiListUnordered,
    apply: (doc, from, to) => toggleLinePrefix(doc, from, to, "- "),
  },
  {
    key: "quote",
    label: "Quote",
    icon: RiDoubleQuotesL,
    apply: (doc, from, to) => toggleLinePrefix(doc, from, to, "> "),
  },
];

export interface MarkdownEditorHandle {
  /**
   * Replaces the current selection with `text` and focuses the editor. Used
   * for inserting an uploaded image's markdown at the caret.
   */
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Controlled mode. Omit to let the editor own it. */
  mode?: MarkdownEditorMode;
  defaultMode?: MarkdownEditorMode;
  onModeChange?: (mode: MarkdownEditorMode) => void;
  /** Accessible name for the editing surface. Never painted — see the render. */
  label: string;
  /**
   * Rendered at the start of the toolbar row, left of the formatting buttons.
   * The consumer's own visible field label goes here, which is what puts it
   * directly above the editing surface.
   */
  header?: React.ReactNode;
  /**
   * Rendered at the end of the toolbar row, after the formatting buttons.
   * Consumer-specific actions belong here — `apps/web` puts "Insert image"
   * there, which this package cannot own because uploading is an authenticated
   * app concern.
   */
  actions?: React.ReactNode;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  readOnly?: boolean;
  /**
   * Show a control that grows the editing surface to the whole document
   * instead of scrolling inside its box.
   */
  expandable?: boolean;
  /**
   * Called when the expand control is used. Expanded, the editor stops
   * scrolling internally and grows with the document, so a consumer whose
   * layout is height-locked has to release that lock here — nothing above the
   * editor can be reached from inside it.
   */
  onExpandedChange?: (expanded: boolean) => void;
}

const editableCompartment = new Compartment();
const livePreviewCompartment = new Compartment();

const baseTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    // Fill the host rather than the document. Paired with the `flex-1` host
    // element, this is what makes the whole visible box clickable: without it
    // CodeMirror ends at the last line and every click below that lands on a
    // plain `div` that cannot take focus.
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    padding: "0.75rem",
    caretColor: "var(--foreground)",
    // `.cm-content` is the element that actually takes the click, so it has to
    // grow too — `.cm-editor` filling the box is not enough on its own. The
    // 16rem is the editor's floor, and it lives here rather than on the box:
    // on the box it was a hard minimum that overflowed a height-constrained
    // column and painted over whatever sat under it, while here a short box
    // simply scrolls, which is what the scrollbar and the expand control are
    // for.
    minHeight: "max(100%, 16rem)",
  },
  ".cm-line": { padding: "0 0.25rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
  },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

function buildExtensions(options: {
  label: string;
  placeholder: string | undefined;
  readOnly: boolean;
  livePreview: boolean;
  onChange: (value: string) => void;
}): Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    baseTheme,
    markdownLivePreviewTheme,
    EditorView.contentAttributes.of({ "aria-label": options.label, role: "textbox" }),
    ...(options.placeholder === undefined ? [] : [placeholderExtension(options.placeholder)]),
    livePreviewCompartment.of(options.livePreview ? markdownLivePreview : []),
    editableCompartment.of(EditorView.editable.of(!options.readOnly)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onChange(update.state.doc.toString());
      }
    }),
  ];
}

/**
 * Markdown editor with an Obsidian-style live preview.
 *
 * The document is always the raw markdown text — switching modes attaches or
 * detaches decorations, and never rewrites the document. There is no
 * HTML-to-markdown serialization step, so opening and saving a post cannot
 * reformat it.
 *
 * Lives behind `@unimatrix/ui/editor` rather than `./public` so CodeMirror
 * stays out of the public site's dependency graph entirely.
 */
export const MarkdownEditor = React.forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      actions,
      className,
      defaultMode = "live",
      editorClassName,
      expandable = false,
      header,
      label,
      mode: controlledMode,
      onChange,
      onExpandedChange,
      onModeChange,
      placeholder,
      readOnly = false,
      value,
    },
    ref,
  ) {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    const onChangeRef = React.useRef(onChange);
    const [uncontrolledMode, setUncontrolledMode] = React.useState<MarkdownEditorMode>(defaultMode);
    const mode = controlledMode ?? uncontrolledMode;
    const [expanded, setExpanded] = React.useState(false);
    // Whether the collapsed box is actually cutting the document off. The
    // control is an answer to a scrollbar, so without one there is nothing for
    // it to offer and it stays out of the toolbar's way.
    const [overflowing, setOverflowing] = React.useState(false);
    const boxRef = React.useRef<HTMLDivElement | null>(null);

    // The updateListener is installed once, so it must not close over a stale
    // callback when the consumer re-renders with a new one.
    onChangeRef.current = onChange;

    // Measured rather than derived from the document length: what overflows
    // depends on the box's height and the wrapped line count, and both change
    // without the value changing at all — a window resize, a font load, the
    // fields above growing by a row.
    React.useEffect(() => {
      const box = boxRef.current;

      if (box === null || !expandable) {
        return;
      }

      const measure = () => {
        setOverflowing(box.scrollHeight > box.clientHeight + 1);
      };

      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(box);

      for (const child of box.children) {
        observer.observe(child);
      }

      return () => {
        observer.disconnect();
      };
    }, [expandable, expanded, value]);

    React.useEffect(() => {
      const host = hostRef.current;

      if (host === null) {
        return;
      }

      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: value,
          extensions: buildExtensions({
            label,
            placeholder,
            readOnly,
            livePreview: true,
            onChange: (next) => {
              onChangeRef.current(next);
            },
          }),
        }),
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Built once, deliberately: subsequent prop changes are applied through
      // compartments and transactions below, so the document, its undo
      // history, and the cursor all survive a re-render. `value`, `label`,
      // `placeholder`, and `readOnly` are read here only to seed the initial
      // state, which is why they are absent from the dependency list.
    }, []);

    // Mirrors an externally changed `value` into the document, without
    // clobbering what the user is typing (the two are equal in that case).
    React.useEffect(() => {
      const view = viewRef.current;

      if (view === null || view.state.doc.toString() === value) {
        return;
      }

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }, [value]);

    React.useEffect(() => {
      viewRef.current?.dispatch({
        effects: livePreviewCompartment.reconfigure(mode === "live" ? markdownLivePreview : []),
      });
    }, [mode]);

    React.useEffect(() => {
      viewRef.current?.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
      });
    }, [readOnly]);

    React.useImperativeHandle(
      ref,
      () => ({
        insertAtCursor: (text: string) => {
          const view = viewRef.current;

          if (view === null) {
            return;
          }

          const { from, to } = view.state.selection.main;

          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
          view.focus();
        },
        focus: () => {
          viewRef.current?.focus();
        },
      }),
      [],
    );

    /**
     * Applies one toolbar edit and returns focus to the document.
     *
     * Focus matters more than it looks: clicking a toolbar button moves focus
     * to the button, so without this the caret the edit just placed would be
     * invisible and the next keystroke would go nowhere useful.
     */
    const applyToolbarAction = (apply: (typeof TOOLBAR_ACTIONS)[number]["apply"]) => {
      const view = viewRef.current;

      if (view === null) {
        return;
      }

      const { from, to } = view.state.selection.main;
      const edit = apply(view.state.doc.toString(), from, to);

      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.anchor, head: edit.head },
      });
      view.focus();
    };

    const handleModeChange = (next: string) => {
      // The toggle group reports "" when the active item is pressed again;
      // a mode is always required, so that is ignored.
      if (next === "" || !MARKDOWN_EDITOR_MODES.includes(next as MarkdownEditorMode)) {
        return;
      }

      const nextMode = next as MarkdownEditorMode;

      if (controlledMode === undefined) {
        setUncontrolledMode(nextMode);
      }

      onModeChange?.(nextMode);
    };

    return (
      <div className={cn("flex min-h-0 flex-col gap-2", className)}>
        {/* `label` is the accessible name only — it names the editing surface
            and the mode toggle for assistive technology, and is deliberately
            not painted. The visible name is whatever the consumer passes as
            `header`, which sits here so it reads as the label of the box
            directly below it. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {header}

          <div className="flex flex-wrap items-center gap-1">
            {TOOLBAR_ACTIONS.map((action) => (
              <Button
                aria-label={action.label}
                className="size-8"
                disabled={readOnly}
                key={action.key}
                onClick={() => {
                  applyToolbarAction(action.apply);
                }}
                size="icon"
                title={action.label}
                type="button"
                variant="ghost"
              >
                <action.icon aria-hidden="true" className="size-4" />
              </Button>
            ))}

            {actions}

            <ToggleGroup
              aria-label={`${label} view mode`}
              className="ml-1"
              onValueChange={handleModeChange}
              size="sm"
              type="single"
              value={mode}
              variant="outline"
            >
              {MARKDOWN_EDITOR_MODES.map((editorMode) => (
                <ToggleGroupItem key={editorMode} value={editorMode}>
                  {MODE_LABELS[editorMode]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {/* `relative` so the expand control can float over the bottom-right of
            the writing surface. Collapsed, the box takes the leftover space and
            the document scrolls inside it; expanded, `h-auto` lets CodeMirror's
            own height be the document's and the page does the scrolling. */}
        <div
          className={cn(
            "relative flex flex-col border border-input bg-background",
            expanded ? "h-auto" : "flex-1 overflow-auto",
            editorClassName,
          )}
          ref={boxRef}
        >
          {/*
           * `flex-1` on the host, and `height: 100%` on `.cm-editor` inside it,
           * are what make a click land on the editor rather than on dead space.
           * CodeMirror sizes itself to its content by default, so in a box this
           * tall — a full-page editor with a short draft in it — most of what
           * looks like the writing surface belongs to this container, and
           * clicking it does nothing at all.
           */}
          <div className="flex-1" ref={hostRef} />

          {expandable && (expanded || overflowing) ? (
            /* `sticky`, not `absolute`: in the collapsed box the control has to
               stay reachable while the document scrolls under it, and in the
               expanded one it has to stay with the bottom edge rather than sit
               at the end of a very long document. */
            <div className="pointer-events-none sticky bottom-0 flex justify-end p-2">
              <Button
                aria-label={expanded ? "Shrink the editor" : "Expand the editor"}
                aria-pressed={expanded}
                className="pointer-events-auto size-8 bg-background/90 backdrop-blur-sm"
                onClick={() => {
                  // The notification happens here, not inside the updater:
                  // React re-runs functional updaters in Strict Mode to check
                  // they are pure, which would fire this callback twice.
                  const next = !expanded;

                  setExpanded(next);
                  onExpandedChange?.(next);
                }}
                size="icon"
                title={expanded ? "Shrink the editor" : "Expand the editor"}
                type="button"
                variant="outline"
              >
                {expanded ? (
                  <RiCollapseDiagonalLine aria-hidden="true" className="size-4" />
                ) : (
                  <RiExpandDiagonalLine aria-hidden="true" className="size-4" />
                )}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
