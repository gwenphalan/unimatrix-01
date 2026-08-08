import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSecretsDatabase } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { secretsTable } from "../src/db/schema/index.js";

// A real temp file, not ":memory:": SQLite always reports an in-memory
// database's journal_mode as "memory" regardless of what is requested, so
// only a file-backed database can prove WAL actually took effect.
void test("createSecretsDatabase enables foreign_keys and WAL, and migrations create the schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-db-"));
  const filePath = join(directory, "secrets.sqlite");

  try {
    const instance = createSecretsDatabase({ filePath });

    try {
      assert.equal(instance.client.pragma("foreign_keys", { simple: true }), 1);
      assert.equal(instance.client.pragma("journal_mode", { simple: true }), "wal");

      migrateSecretsDatabase(instance);

      instance.db.insert(secretsTable).values({ name: "github/api-token" }).run();
      const rows = instance.db.select().from(secretsTable).all();

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.name, "github/api-token");
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("migrateSecretsDatabase is idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-db-"));
  const filePath = join(directory, "secrets.sqlite");

  try {
    const instance = createSecretsDatabase({ filePath });

    try {
      migrateSecretsDatabase(instance);
      assert.doesNotThrow(() => {
        migrateSecretsDatabase(instance);
      });
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
