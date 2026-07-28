import type { ContentPost, ContentPostSummary } from "@unimatrix/shared";

/**
 * The public site's list and detail components were written against the
 * parsed-markdown shape (`{ slug, frontmatter }`). Content now arrives from
 * the API as flat rows, so this module is the single adapter between the two.
 *
 * Keeping the components' shape rather than rewriting them keeps the change to
 * the data source, not the rendering — and the shape is still the honest one
 * for a public entry: identity (`slug`) plus display metadata.
 */
export interface PublicBlogEntry {
  slug: string;
  frontmatter: {
    title: string;
    summary: string;
    publishedAt: string;
    description?: string;
  };
}

export interface PublicBlogDetail extends PublicBlogEntry {
  body: string;
}

export interface PublicProjectEntry {
  slug: string;
  frontmatter: {
    title: string;
    summary: string;
    status?: string;
    repoUrl?: string;
    liveUrl?: string;
  };
}

export interface PublicProjectDetail extends PublicProjectEntry {
  body: string;
}

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

function optional<TKey extends string>(
  key: TKey,
  value: string | null,
): Partial<Record<TKey, string>> {
  return value === null ? {} : ({ [key]: value } as Partial<Record<TKey, string>>);
}

export function toBlogEntry(post: ContentPostSummary): PublicBlogEntry {
  return {
    slug: post.slug,
    frontmatter: {
      title: post.title,
      summary: post.summary,
      publishedAt: formatPublishedDate(post.publishedAt),
      ...optional("description", post.description),
    },
  };
}

export function toBlogDetail(post: ContentPost): PublicBlogDetail {
  return {
    ...toBlogEntry(post),
    body: post.body,
  };
}

export function toProjectEntry(post: ContentPostSummary): PublicProjectEntry {
  return {
    slug: post.slug,
    frontmatter: {
      title: post.title,
      summary: post.summary,
      // No `publishedAt`. Projects are persistent rather than sequential, so
      // nothing on the public side renders a project's date — the admin table
      // still shows it, where it describes the row rather than the project.
      //
      // `status` is absent rather than a placeholder label: the admin form no
      // longer sets one — a project's status is the live-URL check — so the
      // only rows carrying it are those seeded from the repository, and
      // inventing an "unspecified" badge for the rest would be furniture.
      ...optional("status", post.projectStatus),
      ...optional("repoUrl", post.repoUrl),
      ...optional("liveUrl", post.liveUrl),
    },
  };
}

export function toProjectDetail(post: ContentPost): PublicProjectDetail {
  return {
    ...toProjectEntry(post),
    body: post.body,
  };
}

/** Projects pinned to the homepage, in the order the list already carries. */
export function selectFeaturedProjects(posts: readonly ContentPostSummary[]): ContentPostSummary[] {
  return posts.filter((post) => post.featured);
}
