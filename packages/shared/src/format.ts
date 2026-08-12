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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** A calendar-free approximation: every month is 30 days, every year 12 of those. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 12 * MONTH_MS;

/**
 * How long ago a timestamp was, as a short label — `4h ago`, `24d ago`.
 *
 * Pairs with {@link formatPublishedDate} rather than replacing it: the date
 * answers *when*, this answers *how stale*, and a reader scanning a column of
 * dates for the oldest one is doing arithmetic the label can do for them.
 *
 * `null` for a value that cannot be parsed, so the caller renders the raw date
 * alone instead of an age it has no basis for. A timestamp in the future reads
 * as `just now`: a few seconds of clock skew between a server and a browser is
 * far likelier than a genuinely future date, and `in 4s` would be noise.
 *
 * Approximate above a day by design — an operator asking how stale a
 * credential is wants the order of magnitude, not the remainder.
 */
export function formatAge(value: string, now: number = Date.now()): string | null {
  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  const elapsed = now - parsed;

  if (elapsed < MINUTE_MS) {
    return "just now";
  }

  if (elapsed < HOUR_MS) {
    return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`;
  }

  if (elapsed < DAY_MS) {
    return `${String(Math.floor(elapsed / HOUR_MS))}h ago`;
  }

  if (elapsed < MONTH_MS) {
    return `${String(Math.floor(elapsed / DAY_MS))}d ago`;
  }

  if (elapsed < YEAR_MS) {
    return `${String(Math.floor(elapsed / MONTH_MS))}mo ago`;
  }

  return `${String(Math.floor(elapsed / YEAR_MS))}y ago`;
}
