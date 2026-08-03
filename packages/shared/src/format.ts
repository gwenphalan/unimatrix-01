/**
 * Renders a stored publication date as `MM-DD-YY`.
 *
 * Values are not uniform: entries seeded from the repository keep the plain
 * date their frontmatter declared, while anything published through the CMS
 * carries a full ISO timestamp. Both display as a date. An unparseable or
 * absent value falls back to the raw string rather than showing "Invalid
 * Date".
 *
 * Read in UTC, not local time. A stored `2026-03-17` parses as midnight UTC,
 * and reading it back through the viewer's timezone would show the 16th to
 * anyone west of Greenwich — the date a post carries is a label, not an
 * instant, so it must render the same everywhere.
 */
export function formatPublishedDate(value: string | null): string {
  if (value === null) {
    return "";
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return value;
  }

  const date = new Date(parsed);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);

  return `${month}-${day}-${year}`;
}
