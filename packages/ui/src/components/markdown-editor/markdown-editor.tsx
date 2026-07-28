import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { PublicMarkdown } from "../public-markdown.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { markdownLivePreview, markdownLivePreviewTheme } from "./live-preview.js";

/**
 * - `live`: markdown text with rendered styling and syntax hidden off-cursor.
 * - `raw`: the same text with the decorations detached.
 * - `preview`: read-only render through the site's own markdown renderer.
 */
export const MARKDOWN_EDITOR_MODES = ["live", "raw", "preview"] as const;

export type MarkdownEditorMode = (typeof MARKDOWN_EDITOR_MODES)[number];

const MODE_LABELS: Record<MarkdownEditorMode, string> = {
  live: "Live",
  raw: "Raw",
  preview: "Preview",
};

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
  /** Accessible name for the editing surface. */
  label: string;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  readOnly?: boolean;
}

const editableCompartment = new Compartment();
const livePreviewCompartment = new Compartment();

const baseTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "0.75rem", caretColor: "var(--foreground)" },
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
 * reformat it, and `preview` renders through `PublicMarkdown`, the exact
 * component the public site uses.
 *
 * Lives behind `@unimatrix/ui/editor` rather than `./public` so CodeMirror
 * stays out of the public site's dependency graph entirely.
 */
export const MarkdownEditor = React.forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      className,
      defaultMode = "live",
      editorClassName,
      label,
      mode: controlledMode,
      onChange,
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

    // The updateListener is installed once, so it must not close over a stale
    // callback when the consumer re-renders with a new one.
    onChangeRef.current = onChange;

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
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{label}</span>
          <ToggleGroup
            aria-label={`${label} view mode`}
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

        <div
          className={cn(
            "min-h-64 overflow-auto border border-input bg-background",
            editorClassName,
          )}
        >
          {/*
           * The editor host stays mounted in every mode. Unmounting it for the
           * preview would destroy the view, and with it the undo history and
           * cursor position.
           */}
          <div className={cn(mode === "preview" && "hidden")} ref={hostRef} />

          {mode === "preview" ? (
            <div className="public-markdown px-4 py-3">
              <PublicMarkdown markdown={value} />
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
