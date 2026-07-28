import { sql } from "drizzle-orm";
import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Content collections the CMS manages. Home/about stay repo-backed. */
export const CONTENT_POST_TYPES = ["blog", "project"] as const;

/** A CMS-managed content collection. */
export type ContentPostType = (typeof CONTENT_POST_TYPES)[number];

/**
 * Publication lifecycle of a post. Deliberately distinct from a project's
 * own `projectStatus` ("live", "archived", ...), which describes the project
 * itself and drives the public-site live badge — the two are different axes
 * and were named apart on purpose.
 */
export const CONTENT_PUBLICATION_STATES = ["draft", "published", "archived"] as const;

/** A post's publication lifecycle state. */
export type ContentPublicationState = (typeof CONTENT_PUBLICATION_STATES)[number];

/**
 * Blog entries and project entries in one table, discriminated by `type`.
 * Every admin operation (list, bulk publish, bulk delete) and every route is
 * identical across the two collections; only a handful of nullable project
 * columns differ, so splitting them would duplicate each query, contract, and
 * route for one column group.
 *
 * Deletion is soft (`deletedAt`): once content moves out of the repository
 * this table is the only copy, so a destructive click must stay recoverable.
 */
export const contentPostsTable = sqliteTable(
  "content_posts",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<ContentPostType>().notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    /** Longer detail copy shown on blog detail pages; falls back to `summary`. */
    description: text("description"),
    body: text("body").notNull(),
    publicationState: text("publication_state")
      .$type<ContentPublicationState>()
      .notNull()
      .default("draft"),
    /** Set the first time a post reaches `published`, and kept thereafter. */
    publishedAt: text("published_at"),
    /** Projects only: pins the entry to the homepage featured list. */
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    /** Projects only: free-form project state ("live", "archived", ...). */
    projectStatus: text("project_status"),
    repoUrl: text("repo_url"),
    liveUrl: text("live_url"),
    /** Verified Clerk user id of the author; never client-supplied. */
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    // Slugs are unique per collection, not globally: /blog/foo and
    // /projects/foo are different routes and may legitimately coexist.
    uniqueIndex("content_posts_type_slug_unique").on(table.type, table.slug),
    index("content_posts_listing_idx").on(table.type, table.publicationState, table.publishedAt),
  ],
);

export type NewContentPost = typeof contentPostsTable.$inferInsert;
export type ContentPost = typeof contentPostsTable.$inferSelect;

/**
 * Content-addressed asset storage for images embedded in posts. Keyed by the
 * SHA-256 of the bytes, so re-uploading the same image is a no-op and the
 * delivery URL can carry an immutable cache header forever.
 *
 * Mirrors `userFilesTable`: bytes live in SQLite rather than on a volume, so
 * a single database file remains the whole backup artifact.
 */
export const contentAssetsTable = sqliteTable(
  "content_assets",
  {
    /** Lowercase hex SHA-256 of `data`; also the public URL segment. */
    hash: text("hash").primaryKey(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    /** Upload filename, kept for the admin asset list and download naming. */
    originalFilename: text("original_filename").notNull(),
    /** Verified Clerk user id of the uploader; never client-supplied. */
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("content_assets_created_at_idx").on(table.createdAt)],
);

export type NewContentAsset = typeof contentAssetsTable.$inferInsert;
export type ContentAsset = typeof contentAssetsTable.$inferSelect;
