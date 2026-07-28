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
    publishedAt: string;
    status: string;
    repoUrl?: string;
    liveUrl?: string;
  };
}

export interface PublicProjectDetail extends PublicProjectEntry {
  body: string;
}

/**
 * Shown when a project row carries no status. Projects seeded from the
 * repository all have one and the admin form requires one, so this is the
 * honest label for a gap rather than a guess like "active".
 */
const UNSPECIFIED_PROJECT_STATUS = "unspecified";

/**
 * Renders a stored publication date as `YYYY-MM-DD`.
 *
 * Values are not uniform: entries seeded from the repository keep the plain
 * date their frontmatter declared, while anything published through the CMS
 * carries a full ISO timestamp. Both display as a date. An unparseable or
 * absent value falls back to the raw string rather than showing "Invalid
 * Date".
 */
export function formatPublishedDate(value: string | null): string {
  if (value === null) {
    return "";
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString().slice(0, 10);
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
      publishedAt: formatPublishedDate(post.publishedAt),
      status: post.projectStatus ?? UNSPECIFIED_PROJECT_STATUS,
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
