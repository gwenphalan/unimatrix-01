/**
 * Text transforms behind the editor's formatting toolbar.
 *
 * Pure functions over `(document, selection)` rather than CodeMirror commands:
 * every interesting case here is a string question — is this already bold, is
 * every selected line already a list item — and answering it without an
 * `EditorView` means the toolbar's behaviour is testable in jsdom, where
 * CodeMirror's own layout does not run.
 *
 * Each returns one replacement plus where the selection lands afterwards, in
 * the coordinates of the document that replacement produces.
 */
export interface MarkdownEdit {
  /** Text replacing `[from, to)`. */
  insert: string;
  from: number;
  to: number;
  /** Selection after the edit, in post-edit coordinates. */
  anchor: number;
  head: number;
}

/**
 * Wraps the selection in `marker`, or unwraps it when it is already wrapped —
 * so the same button both applies and removes emphasis, the way every editor
 * with a bold button behaves.
 *
 * Markers are recognised both inside the selection (`**bold**` selected whole)
 * and immediately around it (`bold` selected between existing asterisks),
 * because which of the two a double-click produces depends on where the user
 * started dragging.
 *
 * With nothing selected this inserts the pair and puts the caret between them,
 * so typing continues inside the emphasis.
 */
export function toggleInlineMarker(
  doc: string,
  from: number,
  to: number,
  marker: string,
): MarkdownEdit {
  const selected = doc.slice(from, to);
  const width = marker.length;

  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(width, selected.length - width);

    // `*` is a prefix of `**`, so italics over `**bold**` would otherwise strip
    // one asterisk from each side and quietly demote it to italic. A marker
    // still touching the result means the run is longer than this marker, and
    // this is not the button that owns it.
    if (!inner.startsWith(marker) && !inner.endsWith(marker)) {
      return { insert: inner, from, to, anchor: from, head: from + inner.length };
    }
  }

  if (
    doc.slice(from - width, from) === marker &&
    doc.slice(to, to + width) === marker &&
    doc.slice(from - width * 2, from - width) !== marker &&
    doc.slice(to + width, to + width * 2) !== marker
  ) {
    return {
      insert: selected,
      from: from - width,
      to: to + width,
      anchor: from - width,
      head: from - width + selected.length,
    };
  }

  return {
    insert: `${marker}${selected}${marker}`,
    from,
    to,
    anchor: from + width,
    head: from + width + selected.length,
  };
}

function lineStartAt(doc: string, index: number): number {
  return doc.lastIndexOf("\n", Math.max(index - 1, 0)) + 1;
}

function lineEndAt(doc: string, index: number): number {
  const next = doc.indexOf("\n", index);

  return next === -1 ? doc.length : next;
}

/**
 * Adds `prefix` to every line the selection touches, or removes it from all of
 * them when every one already has it.
 *
 * Whole lines, not the selected characters: a heading marker halfway through a
 * line is not a heading, so the edit is widened to the line boundaries and the
 * selection afterwards covers the block it rewrote.
 *
 * Blank lines are skipped when deciding whether the block is already prefixed —
 * a `- ` on an empty line would otherwise be required before the button would
 * toggle off.
 */
export function toggleLinePrefix(
  doc: string,
  from: number,
  to: number,
  prefix: string,
): MarkdownEdit {
  const blockStart = lineStartAt(doc, from);
  // A selection is `[from, to)`, so a `to` sitting immediately after a newline
  // belongs to the previous line — selecting "one\n" in "one\ntwo" must not
  // prefix "two". Only a non-empty selection is stepped back; a collapsed
  // cursor at that position really is on the next line.
  const blockEnd = lineEndAt(doc, from === to ? to : to - 1);
  const lines = doc.slice(blockStart, blockEnd).split("\n");
  const meaningful = lines.filter((line) => line.trim().length > 0);
  const isPrefixed = meaningful.length > 0 && meaningful.every((line) => line.startsWith(prefix));

  const next = lines
    .map((line) => {
      if (isPrefixed) {
        return line.startsWith(prefix) ? line.slice(prefix.length) : line;
      }

      // An empty document, or a blank line inside the block, still gets the
      // marker when the block is being turned on — otherwise pressing the list
      // button on an empty editor would do nothing at all.
      return line.startsWith(prefix) ? line : `${prefix}${line}`;
    })
    .join("\n");

  return {
    insert: next,
    from: blockStart,
    to: blockEnd,
    anchor: blockStart,
    head: blockStart + next.length,
  };
}

const LINK_LABEL_PLACEHOLDER = "text";
const LINK_TARGET_PLACEHOLDER = "url";

/**
 * Inserts a markdown link around the selection.
 *
 * The selection lands on whichever half still needs typing: the target when
 * there was selected text to use as the label, the label when there was not.
 */
export function insertLink(doc: string, from: number, to: number): MarkdownEdit {
  const selected = doc.slice(from, to);
  const label = selected.length === 0 ? LINK_LABEL_PLACEHOLDER : selected;
  const insert = `[${label}](${LINK_TARGET_PLACEHOLDER})`;

  if (selected.length === 0) {
    return { insert, from, to, anchor: from + 1, head: from + 1 + label.length };
  }

  const targetStart = from + label.length + 3;

  return {
    insert,
    from,
    to,
    anchor: targetStart,
    head: targetStart + LINK_TARGET_PLACEHOLDER.length,
  };
}
