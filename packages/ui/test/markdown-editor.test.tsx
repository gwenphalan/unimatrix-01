import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor, type MarkdownEditorHandle } from "../src/editor.js";

function getEditorContent(): HTMLElement {
  return screen.getByRole("textbox", { name: "Post body" });
}

/**
 * Keyboard input is driven through the editor's imperative handle rather than
 * simulated keystrokes: CodeMirror's own input handling depends on
 * `beforeinput`, composition events, and layout measurements that jsdom does
 * not implement, so typed characters would prove nothing about the component.
 * What matters here — the document stays raw markdown, mode changes never
 * rewrite it — is fully observable this way. The Obsidian-style decorations
 * themselves are a real-browser check; jsdom reports no layout.
 */
describe("MarkdownEditor", () => {
  it("mounts with the markdown it was given", () => {
    render(<MarkdownEditor label="Post body" onChange={vi.fn()} value={"# Title\n\nBody copy."} />);

    expect(getEditorContent()).toHaveTextContent("# Title");
    expect(getEditorContent()).toHaveTextContent("Body copy.");
  });

  it("reports edits as raw markdown text", async () => {
    const onChange = vi.fn();
    const ref = React.createRef<MarkdownEditorHandle>();

    render(<MarkdownEditor label="Post body" onChange={onChange} ref={ref} value="" />);

    ref.current?.insertAtCursor("## Heading");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // The reported value is the markdown source, character for character —
    // there is no serialization step that could normalize it.
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("## Heading");
  });

  it("mirrors an externally changed value into the document", () => {
    const { rerender } = render(
      <MarkdownEditor label="Post body" onChange={vi.fn()} value="first" />,
    );

    rerender(<MarkdownEditor label="Post body" onChange={vi.fn()} value="second" />);

    expect(getEditorContent()).toHaveTextContent("second");
    expect(getEditorContent()).not.toHaveTextContent("first");
  });

  it("switches between live and raw without changing the document", () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor label="Post body" onChange={onChange} value={"## Heading\n\nParagraph."} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));
    expect(getEditorContent()).toHaveTextContent("## Heading");

    fireEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(getEditorContent()).toHaveTextContent("## Heading");

    // Mode changes must never edit the document.
    expect(onChange).not.toHaveBeenCalled();
  });

  // There is no read-only third mode: `live` already shows the post the way it
  // reads, and the site renders it for real one click away.
  it("offers only the two editable modes", () => {
    render(<MarkdownEditor label="Post body" onChange={vi.fn()} value="Body." />);

    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Live", "Raw"]);
  });

  it("shows the expand control only once the body overflows its box", () => {
    render(<MarkdownEditor expandable label="Post body" onChange={vi.fn()} value="Body." />);

    // jsdom reports every element as zero-sized, so nothing overflows and the
    // control has nothing to offer. The measured behaviour is checked in a real
    // browser; this pins the "no scrollbar, no control" half of the rule.
    expect(screen.queryByRole("button", { name: /the editor/u })).not.toBeInTheDocument();
  });

  it("reports mode changes to a controlled consumer without moving itself", () => {
    const onModeChange = vi.fn();

    render(
      <MarkdownEditor
        label="Post body"
        mode="live"
        onChange={vi.fn()}
        onModeChange={onModeChange}
        value="text"
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    expect(onModeChange).toHaveBeenCalledWith("raw");
    expect(screen.getByRole("radio", { name: "Live" })).toHaveAttribute("aria-checked", "true");
  });

  it("inserts text at the cursor through its imperative handle", async () => {
    const onChange = vi.fn();
    const ref = React.createRef<MarkdownEditorHandle>();

    render(<MarkdownEditor label="Post body" onChange={onChange} ref={ref} value="intro " />);

    // This is how an uploaded image's markdown link reaches the body.
    ref.current?.insertAtCursor("![diagram](/api/content/assets/abc)");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("![diagram](/api/content/assets/abc)intro ");
    });
  });

  it("marks the surface non-editable when read-only", () => {
    render(<MarkdownEditor label="Post body" onChange={vi.fn()} readOnly value="fixed" />);

    expect(getEditorContent()).toHaveAttribute("contenteditable", "false");
  });
});
