import { describe, expect, it } from "vitest";

import { formatPublishedDate } from "../src/index.js";

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
