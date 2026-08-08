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

// The 0001 columns are added by `ALTER TABLE … ADD COLUMN`, and the two
// `NOT NULL` ones carry no default — which SQLite only accepts while the table
// is empty. A migration that silently stopped applying would leave the schema
// one release behind with nothing else to say so.
void test("migrations add the actor and capability columns", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-db-"));
  const filePath = join(directory, "secrets.sqlite");

  try {
    const instance = createSecretsDatabase({ filePath });

    try {
      migrateSecretsDatabase(instance);

      const columnNames = (table: string): string[] =>
        instance.client
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => (column as { name: string }).name);

      for (const column of ["actor_kind", "actor_user_id", "service_token_id"]) {
        assert.ok(columnNames("secret_audit_log").includes(column), `missing ${column}`);
      }

      assert.ok(columnNames("service_tokens").includes("capability"));
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
