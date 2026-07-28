import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  contentAssetsTable,
  contentPostsTable,
  createDatabase,
  migrateDatabase,
  type DatabaseInstance,
} from "../src/index.ts";

function createMigratedDatabase(): DatabaseInstance {
  const instance = createDatabase({ filePath: ":memory:" });

  migrateDatabase(instance);

  return instance;
}

const basePost = {
  id: "post-1",
  type: "blog",
  slug: "first-post",
  title: "First post",
  summary: "A summary.",
  body: "# Body",
  createdBy: "user_admin",
  updatedBy: "user_admin",
} as const;

describe("content_posts", () => {
  it("defaults a new post to an unpublished, unfeatured draft", () => {
    const instance = createMigratedDatabase();

    try {
      instance.db.insert(contentPostsTable).values(basePost).run();

      const [row] = instance.db.select().from(contentPostsTable).all();

      expect(row?.publicationState).toBe("draft");
      expect(row?.publishedAt).toBeNull();
      expect(row?.featured).toBe(false);
      expect(row?.deletedAt).toBeNull();
    } finally {
      instance.client.close();
    }
  });

  it("rejects a duplicate slug within one collection", () => {
    const instance = createMigratedDatabase();

    try {
      instance.db.insert(contentPostsTable).values(basePost).run();

      expect(() => {
        instance.db
          .insert(contentPostsTable)
          .values({ ...basePost, id: "post-2" })
          .run();
      }).toThrow(/UNIQUE constraint failed/u);
    } finally {
      instance.client.close();
    }
  });

  it("allows the same slug in a different collection", () => {
    const instance = createMigratedDatabase();

    try {
      instance.db.insert(contentPostsTable).values(basePost).run();
      instance.db
        .insert(contentPostsTable)
        .values({ ...basePost, id: "post-2", type: "project" })
        .run();

      const rows = instance.db
        .select()
        .from(contentPostsTable)
        .where(eq(contentPostsTable.slug, "first-post"))
        .all();

      expect(rows).toHaveLength(2);
    } finally {
      instance.client.close();
    }
  });

  it("round-trips project-only columns and the featured boolean", () => {
    const instance = createMigratedDatabase();

    try {
      instance.db
        .insert(contentPostsTable)
        .values({
          ...basePost,
          id: "project-1",
          type: "project",
          slug: "cube-trainer",
          featured: true,
          projectStatus: "live",
          repoUrl: "https://github.com/example/cube-trainer",
          liveUrl: "https://cube.unimatrix-01.dev",
          publicationState: "published",
          publishedAt: "2026-01-01",
        })
        .run();

      const [row] = instance.db
        .select()
        .from(contentPostsTable)
        .where(
          and(eq(contentPostsTable.type, "project"), eq(contentPostsTable.slug, "cube-trainer")),
        )
        .all();

      expect(row?.featured).toBe(true);
      expect(row?.projectStatus).toBe("live");
      expect(row?.liveUrl).toBe("https://cube.unimatrix-01.dev");
      expect(row?.publishedAt).toBe("2026-01-01");
    } finally {
      instance.client.close();
    }
  });

  it("keeps a soft-deleted row queryable", () => {
    const instance = createMigratedDatabase();

    try {
      instance.db.insert(contentPostsTable).values(basePost).run();
      instance.db
        .update(contentPostsTable)
        .set({ deletedAt: "2026-02-02T00:00:00.000Z" })
        .where(eq(contentPostsTable.id, "post-1"))
        .run();

      const [row] = instance.db.select().from(contentPostsTable).all();

      expect(row?.deletedAt).toBe("2026-02-02T00:00:00.000Z");
      expect(row?.body).toBe("# Body");
    } finally {
      instance.client.close();
    }
  });
});

describe("content_assets", () => {
  it("round-trips binary data keyed by content hash", () => {
    const instance = createMigratedDatabase();
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    try {
      instance.db
        .insert(contentAssetsTable)
        .values({
          hash: "a".repeat(64),
          contentType: "image/png",
          size: data.length,
          data,
          originalFilename: "diagram.png",
          createdBy: "user_admin",
        })
        .run();

      const [row] = instance.db.select().from(contentAssetsTable).all();

      expect(row?.size).toBe(8);
      expect(Buffer.isBuffer(row?.data)).toBe(true);
      expect(row?.data.equals(data)).toBe(true);
    } finally {
      instance.client.close();
    }
  });

  it("rejects a second row for the same content hash", () => {
    const instance = createMigratedDatabase();
    const asset = {
      hash: "b".repeat(64),
      contentType: "image/png",
      size: 1,
      data: Buffer.from([0x00]),
      originalFilename: "one.png",
      createdBy: "user_admin",
    };

    try {
      instance.db.insert(contentAssetsTable).values(asset).run();

      expect(() => {
        instance.db
          .insert(contentAssetsTable)
          .values({ ...asset, originalFilename: "two.png" })
          .run();
      }).toThrow(/UNIQUE constraint failed/u);
    } finally {
      instance.client.close();
    }
  });
});
