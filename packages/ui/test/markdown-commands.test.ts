import { describe, expect, it } from "vitest";

import {
  insertLink,
  toggleInlineMarker,
  toggleLinePrefix,
  type MarkdownEdit,
} from "../src/components/markdown-editor/markdown-commands.js";

/** Applies an edit the way the editor's dispatch does, for readable assertions. */
function apply(doc: string, edit: MarkdownEdit): string {
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}

/** Renders the post-edit selection as `«selected»` so it can be asserted too. */
function withSelection(doc: string, edit: MarkdownEdit): string {
  const next = apply(doc, edit);

  return `${next.slice(0, edit.anchor)}«${next.slice(edit.anchor, edit.head)}»${next.slice(edit.head)}`;
}

describe("toggleInlineMarker", () => {
  it("wraps the selection and selects what it wrapped", () => {
    const edit = toggleInlineMarker("make me bold", 8, 12, "**");

    expect(withSelection("make me bold", edit)).toBe("make me **«bold»**");
  });

  it("inserts an empty pair with the caret between the markers", () => {
    const edit = toggleInlineMarker("", 0, 0, "**");

    expect(apply("", edit)).toBe("****");
    expect(edit.anchor).toBe(2);
    expect(edit.head).toBe(2);
  });

  /**
   * Both halves of the same button. A double-click can leave the markers
   * inside the selection or outside it depending on where the drag started, so
   * unwrapping has to recognise each — otherwise pressing bold on bold text
   * would make it bolder.
   */
  it("unwraps markers held inside the selection", () => {
    const edit = toggleInlineMarker("make me **bold**", 8, 16, "**");

    expect(withSelection("make me **bold**", edit)).toBe("make me «bold»");
  });

  it("unwraps markers sitting just outside the selection", () => {
    const edit = toggleInlineMarker("make me **bold**", 10, 14, "**");

    expect(withSelection("make me **bold**", edit)).toBe("make me «bold»");
  });

  /**
   * `*` is a prefix of `**`, so an italic toggle over bold text must not see
   * its own marker in the neighbouring asterisks and unwrap half a pair.
   */
  it("does not mistake one asterisk of a bold pair for italics", () => {
    const edit = toggleInlineMarker("**bold**", 2, 6, "*");

    expect(apply("**bold**", edit)).toBe("***bold***");
  });
});

describe("toggleLinePrefix", () => {
  it("prefixes every line the selection touches, not just the selected text", () => {
    const doc = "one\ntwo";
    const edit = toggleLinePrefix(doc, 1, 5, "- ");

    expect(apply(doc, edit)).toBe("- one\n- two");
  });

  it("removes the prefix when every line already has it", () => {
    const doc = "- one\n- two";
    const edit = toggleLinePrefix(doc, 0, doc.length, "- ");

    expect(apply(doc, edit)).toBe("one\ntwo");
  });

  it("levels a partly-prefixed block up rather than toggling it off", () => {
    const doc = "- one\ntwo";
    const edit = toggleLinePrefix(doc, 0, doc.length, "- ");

    // The line that already had the marker keeps exactly one, so pressing the
    // button twice on a mixed block is a round trip rather than a mess.
    expect(apply(doc, edit)).toBe("- one\n- two");
  });

  /**
   * A blank line between two prefixed lines must not make the block read as
   * "not prefixed", or the button would stop toggling off.
   */
  it("ignores blank lines when deciding the block is already prefixed", () => {
    const doc = "> one\n\n> two";
    const edit = toggleLinePrefix(doc, 0, doc.length, "> ");

    expect(apply(doc, edit)).toBe("one\n\ntwo");
  });

  it("marks an empty document so the button does something on a blank editor", () => {
    const edit = toggleLinePrefix("", 0, 0, "## ");

    expect(apply("", edit)).toBe("## ");
  });
});

describe("insertLink", () => {
  it("keeps the selection as the label and selects the target to type over", () => {
    const doc = "see the docs";
    const edit = insertLink(doc, 8, 12);

    expect(withSelection(doc, edit)).toBe("see the [docs](«url»)");
  });

  it("selects the label placeholder when there was nothing to use as one", () => {
    const edit = insertLink("", 0, 0);

    expect(withSelection("", edit)).toBe("[«text»](url)");
  });
});
