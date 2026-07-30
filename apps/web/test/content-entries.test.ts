import type { ContentPost, ContentPostSummary } from "@unimatrix/shared";
import { describe, expect, it } from "vitest";

import {
  formatPublishedDate,
  selectFeaturedProjects,
  toBlogDetail,
  toBlogEntry,
  toProjectDetail,
  toProjectEntry,
} from "@/features/content/entries";

function buildSummary(overrides: Partial<ContentPostSummary> = {}): ContentPostSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "blog",
    slug: "a-post",
    title: "A post",
    summary: "A summary.",
    description: null,
    publicationState: "published",
    publishedAt: "2026-03-17",
    featured: false,
    projectStatus: null,
    repoUrl: null,
    liveUrl: null,
    updatedAt: "2026-03-17T00:00:00.000Z",
    ...overrides,
  };
}

function buildPost(overrides: Partial<ContentPost> = {}): ContentPost {
  return { ...buildSummary(), body: "# Body", ...overrides };
}

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

describe("blog adapters", () => {
  it("maps an API row onto the shape the list components expect", () => {
    expect(toBlogEntry(buildSummary({ description: "Longer copy." }))).toEqual({
      slug: "a-post",
      frontmatter: {
        title: "A post",
        summary: "A summary.",
        publishedAt: "03-17-26",
        description: "Longer copy.",
      },
    });
  });

  it("omits a null description rather than passing null through", () => {
    const entry = toBlogEntry(buildSummary());

    expect("description" in entry.frontmatter).toBe(false);
  });

  it("carries the body on the detail shape", () => {
    expect(toBlogDetail(buildPost()).body).toBe("# Body");
  });
});

describe("project adapters", () => {
  it("maps project-only fields and drops the nulls", () => {
    const entry = toProjectEntry(
      buildSummary({
        type: "project",
        slug: "cflop",
        projectStatus: "active",
        liveUrl: "https://cflop.unimatrix-01.dev",
      }),
    );

    expect(entry.frontmatter.status).toBe("active");
    expect(entry.frontmatter.liveUrl).toBe("https://cflop.unimatrix-01.dev");
    expect("repoUrl" in entry.frontmatter).toBe(false);
    // A project is persistent rather than sequential, so nothing public
    // renders its date and the adapter does not carry one.
    expect("publishedAt" in entry.frontmatter).toBe(false);
  });

  // A stored status only exists on rows seeded from the repository. The admin
  // form does not write one, so a missing value is the normal case and gets no
  // placeholder label — `ProjectStatusBadge` renders nothing for it.
  it("omits the status entirely when the row carries none", () => {
    expect("status" in toProjectEntry(buildSummary({ type: "project" })).frontmatter).toBe(false);
  });

  it("carries the body on the detail shape", () => {
    expect(toProjectDetail(buildPost({ type: "project" })).body).toBe("# Body");
  });
});

describe("selectFeaturedProjects", () => {
  it("keeps only pinned projects, in the order given", () => {
    const posts = [
      buildSummary({ slug: "one", featured: false }),
      buildSummary({ slug: "two", featured: true }),
      buildSummary({ slug: "three", featured: true }),
    ];

    expect(selectFeaturedProjects(posts).map((post) => post.slug)).toEqual(["two", "three"]);
  });
});
