import { describe, expect, it } from "vitest";

import { formatAge, formatPublishedDate } from "../src/index.js";

describe("formatPublishedDate", () => {
  it("renders both stored date formats as MM-DD-YY", () => {
    // Seeded rows keep the plain date their frontmatter declared; anything
    // published through the CMS carries a full ISO timestamp.
    expect(formatPublishedDate("2026-03-17")).toBe("03-17-26");
    expect(formatPublishedDate("2026-03-17T14:32:07.123Z")).toBe("03-17-26");
  });

  /**
   * A date-only value parses as midnight UTC. Reading it back through a
   * local-time getter shows the previous day to every viewer west of
   * Greenwich, which would make a post's date depend on who is looking.
   */
  it("reads the stored value in UTC rather than the viewer's timezone", () => {
    expect(formatPublishedDate("2026-01-01T00:00:00.000Z")).toBe("01-01-26");
    expect(formatPublishedDate("2026-12-31T23:59:59.000Z")).toBe("12-31-26");
  });

  it("falls back rather than showing Invalid Date", () => {
    expect(formatPublishedDate(null)).toBe("");
    expect(formatPublishedDate("not a date")).toBe("not a date");
  });
});

describe("formatAge", () => {
  const NOW = Date.parse("2026-08-11T12:00:00.000Z");

  function ago(milliseconds: number): string {
    return new Date(NOW - milliseconds).toISOString();
  }

  it("shortens each unit as the gap widens", () => {
    expect(formatAge(ago(30_000), NOW)).toBe("just now");
    expect(formatAge(ago(9 * 60_000), NOW)).toBe("9m ago");
    expect(formatAge(ago(5 * 3_600_000), NOW)).toBe("5h ago");
    expect(formatAge(ago(24 * 86_400_000), NOW)).toBe("24d ago");
    expect(formatAge(ago(70 * 86_400_000), NOW)).toBe("2mo ago");
    expect(formatAge(ago(400 * 86_400_000), NOW)).toBe("1y ago");
  });

  /**
   * Each unit's last moment, because an off-by-one at a boundary shows as
   * `60m ago` or `24h ago` — readable, wrong, and easy to miss.
   */
  it("switches unit at the boundary, not past it", () => {
    expect(formatAge(ago(59_999), NOW)).toBe("just now");
    expect(formatAge(ago(60_000), NOW)).toBe("1m ago");
    expect(formatAge(ago(3_599_999), NOW)).toBe("59m ago");
    expect(formatAge(ago(3_600_000), NOW)).toBe("1h ago");
    expect(formatAge(ago(86_399_999), NOW)).toBe("23h ago");
    expect(formatAge(ago(86_400_000), NOW)).toBe("1d ago");
    expect(formatAge(ago(30 * 86_400_000), NOW)).toBe("1mo ago");
    expect(formatAge(ago(360 * 86_400_000), NOW)).toBe("1y ago");
  });

  /** Clock skew between a server and a browser, not a date in the future. */
  it("reads a future timestamp as just now", () => {
    expect(formatAge(new Date(NOW + 4_000).toISOString(), NOW)).toBe("just now");
  });

  it("says nothing rather than guessing at an unparseable value", () => {
    expect(formatAge("not a date", NOW)).toBeNull();
  });

  it("measures against the current clock when none is given", () => {
    expect(formatAge(new Date().toISOString())).toBe("just now");
  });
});
