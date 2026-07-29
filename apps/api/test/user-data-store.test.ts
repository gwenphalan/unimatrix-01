import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createDatabase, type DatabaseInstance } from "@unimatrix/db";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ApiError } from "../src/lib/http/errors.js";

import {
  deleteDocument,
  deleteFile,
  getDocument,
  getFile,
  listDocuments,
  listFiles,
  putDocument,
  putFile,
} from "../src/modules/user-data/store.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

/**
 * Deliberately far above anything these tests write, so the existing
 * behaviour cases stay about upsert/scoping rather than about the quota.
 * The quota's own boundary cases set a small cap explicitly.
 */
const UNLIMITED_QUOTA_BYTES = 1_000_000;

function createMigratedInMemoryDatabase(): DatabaseInstance {
  const instance = createDatabase({ filePath: ":memory:" });

  migrate(instance.db, { migrationsFolder: MIGRATIONS_FOLDER });

  return instance;
}

void test("putDocument creates a document and getDocument reads it back", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const created = await putDocument(
      db,
      "user_1",
      "cube-trainer",
      "settings",
      { theme: "dark" },
      UNLIMITED_QUOTA_BYTES,
    );

    assert.deepEqual(created, {
      namespace: "cube-trainer",
      key: "settings",
      value: { theme: "dark" },
      updatedAt: created.updatedAt,
    });
    assert.match(created.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);

    const fetched = await getDocument(db, "user_1", "cube-trainer", "settings");

    assert.deepEqual(fetched, created);
  } finally {
    client.close();
  }
});

void test("getDocument returns undefined when no document matches", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const fetched = await getDocument(db, "user_1", "cube-trainer", "missing");

    assert.equal(fetched, undefined);
  } finally {
    client.close();
  }
});

void test("putDocument upserts the same composite key, overwriting the value", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(
      db,
      "user_1",
      "cube-trainer",
      "settings",
      { theme: "dark" },
      UNLIMITED_QUOTA_BYTES,
    );
    const updated = await putDocument(
      db,
      "user_1",
      "cube-trainer",
      "settings",
      { theme: "light" },
      UNLIMITED_QUOTA_BYTES,
    );

    assert.deepEqual(updated.value, { theme: "light" });

    const fetched = await getDocument(db, "user_1", "cube-trainer", "settings");

    assert.deepEqual(fetched?.value, { theme: "light" });

    const all = await listDocuments(db, "user_1", "cube-trainer");

    assert.equal(all.length, 1);
  } finally {
    client.close();
  }
});

void test("putDocument round-trips arbitrary JSON value shapes", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const complexValue = { nested: { array: [1, "two", null, true] }, count: 3 };
    await putDocument(db, "user_1", "cube-trainer", "complex", complexValue, UNLIMITED_QUOTA_BYTES);
    const fetched = await getDocument(db, "user_1", "cube-trainer", "complex");

    assert.deepEqual(fetched?.value, complexValue);
  } finally {
    client.close();
  }
});

void test("listDocuments only returns documents for the given user and namespace", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "a", 1, UNLIMITED_QUOTA_BYTES);
    await putDocument(db, "user_1", "cube-trainer", "b", 2, UNLIMITED_QUOTA_BYTES);
    await putDocument(db, "user_1", "other-namespace", "c", 3, UNLIMITED_QUOTA_BYTES);
    await putDocument(db, "user_2", "cube-trainer", "d", 4, UNLIMITED_QUOTA_BYTES);

    const documents = await listDocuments(db, "user_1", "cube-trainer");

    assert.deepEqual(documents.map((document) => document.key).sort(), ["a", "b"]);
  } finally {
    client.close();
  }
});

void test("deleteDocument removes a document and reports whether it existed", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(
      db,
      "user_1",
      "cube-trainer",
      "settings",
      { theme: "dark" },
      UNLIMITED_QUOTA_BYTES,
    );

    const firstDelete = await deleteDocument(db, "user_1", "cube-trainer", "settings");
    assert.equal(firstDelete, true);

    const secondDelete = await deleteDocument(db, "user_1", "cube-trainer", "settings");
    assert.equal(secondDelete, false);

    const fetched = await getDocument(db, "user_1", "cube-trainer", "settings");
    assert.equal(fetched, undefined);
  } finally {
    client.close();
  }
});

void test("putFile stores a blob and getFile reads back matching bytes and metadata", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const data = Buffer.from("hello world", "utf8");
    const metadata = await putFile(
      db,
      "user_1",
      "cube-trainer",
      "avatar.png",
      "image/png",
      data.length,
      data,

      UNLIMITED_QUOTA_BYTES,
    );

    assert.deepEqual(metadata, {
      namespace: "cube-trainer",
      key: "avatar.png",
      contentType: "image/png",
      size: data.length,
      updatedAt: metadata.updatedAt,
    });

    const fetched = await getFile(db, "user_1", "cube-trainer", "avatar.png");

    assert.ok(fetched);
    assert.equal(Buffer.compare(fetched.data, data), 0);
    assert.equal(fetched.contentType, "image/png");
    assert.equal(fetched.size, data.length);
  } finally {
    client.close();
  }
});

void test("getFile returns undefined when no file matches", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const fetched = await getFile(db, "user_1", "cube-trainer", "missing.png");

    assert.equal(fetched, undefined);
  } finally {
    client.close();
  }
});

void test("putFile upserts the same composite key, overwriting bytes and content type", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const first = Buffer.from("first", "utf8");
    const second = Buffer.from("second-longer", "utf8");

    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "avatar.png",
      "image/png",
      first.length,
      first,
      UNLIMITED_QUOTA_BYTES,
    );
    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "avatar.png",
      "image/jpeg",
      second.length,
      second,
      UNLIMITED_QUOTA_BYTES,
    );

    const fetched = await getFile(db, "user_1", "cube-trainer", "avatar.png");

    assert.ok(fetched);
    assert.equal(Buffer.compare(fetched.data, second), 0);
    assert.equal(fetched.contentType, "image/jpeg");
    assert.equal(fetched.size, second.length);

    const all = await listFiles(db, "user_1", "cube-trainer");
    assert.equal(all.length, 1);
  } finally {
    client.close();
  }
});

void test("listFiles returns metadata only, never the blob, scoped to user and namespace", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const dataA = Buffer.from("aaa", "utf8");
    const dataB = Buffer.from("bbbb", "utf8");

    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "a.txt",
      "text/plain",
      dataA.length,
      dataA,
      UNLIMITED_QUOTA_BYTES,
    );
    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "b.txt",
      "text/plain",
      dataB.length,
      dataB,
      UNLIMITED_QUOTA_BYTES,
    );
    await putFile(
      db,
      "user_1",
      "other-namespace",
      "c.txt",
      "text/plain",
      dataA.length,
      dataA,
      UNLIMITED_QUOTA_BYTES,
    );
    await putFile(
      db,
      "user_2",
      "cube-trainer",
      "d.txt",
      "text/plain",
      dataA.length,
      dataA,
      UNLIMITED_QUOTA_BYTES,
    );

    const files = await listFiles(db, "user_1", "cube-trainer");

    assert.equal(files.length, 2);
    for (const file of files) {
      assert.equal("data" in file, false);
    }
    assert.deepEqual(files.map((file) => file.key).sort(), ["a.txt", "b.txt"]);
  } finally {
    client.close();
  }
});

void test("deleteFile removes a file and reports whether it existed", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const data = Buffer.from("hello", "utf8");
    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "avatar.png",
      "image/png",
      data.length,
      data,
      UNLIMITED_QUOTA_BYTES,
    );

    const firstDelete = await deleteFile(db, "user_1", "cube-trainer", "avatar.png");
    assert.equal(firstDelete, true);

    const secondDelete = await deleteFile(db, "user_1", "cube-trainer", "avatar.png");
    assert.equal(secondDelete, false);

    const fetched = await getFile(db, "user_1", "cube-trainer", "avatar.png");
    assert.equal(fetched, undefined);
  } finally {
    client.close();
  }
});

void test("putDocument rejects a write that would exceed the cumulative quota with a 413", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    // `"a".repeat(40)` serializes to 42 bytes of JSON (the two quotes).
    await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(40), 100);

    await assert.rejects(
      () => putDocument(db, "user_1", "cube-trainer", "b", "a".repeat(80), 100),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 413);
        assert.equal(error.code, "QUOTA_EXCEEDED");

        return true;
      },
    );

    // The rejected write must not have landed.
    assert.equal(await getDocument(db, "user_1", "cube-trainer", "b"), undefined);
  } finally {
    client.close();
  }
});

void test("putDocument accepts a write that lands exactly on the cumulative quota", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(40), 100);
    const created = await putDocument(db, "user_1", "cube-trainer", "b", "a".repeat(54), 100);

    assert.equal(created.key, "b");
  } finally {
    client.close();
  }
});

void test("putDocument counts stored bytes, not characters, when summing the quota", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    // 30 three-byte characters -> 90 UTF-8 bytes plus two quotes = 92 bytes,
    // but only 32 JavaScript characters. Summing `length()` on the TEXT
    // column would charge 32 and wrongly let the second write through.
    await putDocument(db, "user_1", "cube-trainer", "a", "☃".repeat(30), 100);

    await assert.rejects(
      () => putDocument(db, "user_1", "cube-trainer", "b", "aaaaaaaaaa", 100),
      (error: unknown) => error instanceof ApiError && error.statusCode === 413,
    );
  } finally {
    client.close();
  }
});

void test("putDocument does not charge the row it replaces, so an over-quota key can shrink", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(96), 100);

    // Overwriting the same key with a smaller value must succeed: counting
    // the existing row would wedge a user sitting at the cap.
    const updated = await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(10), 100);

    assert.equal(updated.value, "a".repeat(10));
  } finally {
    client.close();
  }
});

void test("putDocument counts files toward the same cumulative quota", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const data = Buffer.alloc(80, 0x61);
    await putFile(db, "user_1", "cube-trainer", "a.bin", "application/octet-stream", 80, data, 100);

    await assert.rejects(
      () => putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(40), 100),
      (error: unknown) => error instanceof ApiError && error.statusCode === 413,
    );
  } finally {
    client.close();
  }
});

void test("putFile rejects an upload that would exceed the cumulative quota", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(60), 100);

    const data = Buffer.alloc(80, 0x61);

    await assert.rejects(
      () =>
        putFile(db, "user_1", "cube-trainer", "a.bin", "application/octet-stream", 80, data, 100),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 413);
        assert.equal(error.code, "QUOTA_EXCEEDED");

        return true;
      },
    );

    assert.equal(await getFile(db, "user_1", "cube-trainer", "a.bin"), undefined);
  } finally {
    client.close();
  }
});

void test("the cumulative quota is scoped per user", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "a", "a".repeat(90), 100);

    // user_2 starts from zero rather than inheriting user_1's usage.
    const created = await putDocument(db, "user_2", "cube-trainer", "a", "a".repeat(90), 100);

    assert.equal(created.key, "a");
  } finally {
    client.close();
  }
});

void test("a file at the same namespace/key still counts when a document is written", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const data = Buffer.alloc(80, 0x61);
    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "shared",
      "application/octet-stream",
      80,
      data,
      1000,
    );

    // The document write replaces no *file*, so the file's 80 bytes must still
    // count: 80 + 42 = 122 > 100. Excluding the replaced row from both tables
    // would hide the file and let this through.
    await assert.rejects(
      () => putDocument(db, "user_1", "cube-trainer", "shared", "a".repeat(40), 100),
      (error: unknown) => error instanceof ApiError && error.statusCode === 413,
    );
  } finally {
    client.close();
  }
});

void test("a document at the same namespace/key still counts when a file is uploaded", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    await putDocument(db, "user_1", "cube-trainer", "shared", "a".repeat(60), 1000);

    const data = Buffer.alloc(80, 0x61);

    await assert.rejects(
      () =>
        putFile(db, "user_1", "cube-trainer", "shared", "application/octet-stream", 80, data, 100),
      (error: unknown) => error instanceof ApiError && error.statusCode === 413,
    );
  } finally {
    client.close();
  }
});

void test("replacing a document at a key shared with a file still excludes only the document", async () => {
  const { client, db } = createMigratedInMemoryDatabase();

  try {
    const data = Buffer.alloc(40, 0x61);
    await putFile(
      db,
      "user_1",
      "cube-trainer",
      "shared",
      "application/octet-stream",
      40,
      data,
      1000,
    );
    await putDocument(db, "user_1", "cube-trainer", "shared", "a".repeat(50), 1000);

    // Shrinking the document must still work: the old document row is excluded
    // (it is replaced), the file is not. 40 + 12 = 52 <= 100.
    const updated = await putDocument(db, "user_1", "cube-trainer", "shared", "a".repeat(10), 100);

    assert.equal(updated.value, "a".repeat(10));
  } finally {
    client.close();
  }
});
