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
  it("renders both stored date formats as a plain date", () => {
    // Seeded rows keep the plain date their frontmatter declared; anything
    // published through the CMS carries a full ISO timestamp.
    expect(formatPublishedDate("2026-03-17")).toBe("2026-03-17");
    expect(formatPublishedDate("2026-03-17T14:32:07.123Z")).toBe("2026-03-17");
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
        publishedAt: "2026-03-17",
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
        slug: "cube-trainer",
        projectStatus: "active",
        liveUrl: "https://cube.unimatrix-01.dev",
      }),
    );

    expect(entry.frontmatter.status).toBe("active");
    expect(entry.frontmatter.liveUrl).toBe("https://cube.unimatrix-01.dev");
    expect("repoUrl" in entry.frontmatter).toBe(false);
  });

  it("labels a missing status honestly instead of guessing one", () => {
    expect(toProjectEntry(buildSummary({ type: "project" })).frontmatter.status).toBe(
      "unspecified",
    );
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
