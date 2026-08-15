import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSecretsDatabase, type SecretsDatabaseInstance } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { serviceTokensTable } from "../src/db/schema/index.js";
import {
  findServiceTokenByPlaintext,
  issueServiceToken,
  listServiceTokens,
  revokeServiceToken,
  touchServiceTokenLastUsed,
  type ServiceTokenCapability,
} from "../src/service-tokens/index.js";

// A real temp file rather than ":memory:", matching `db.test.ts`: these
// assertions are about what a migrated database on disk actually holds.
function withDatabase(run: (instance: SecretsDatabaseInstance) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-tokens-"));

  try {
    const instance = createSecretsDatabase({ filePath: join(directory, "secrets.sqlite") });

    try {
      migrateSecretsDatabase(instance);
      run(instance);
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

void test("issuance returns the plaintext once and stores no copy of it", () => {
  withDatabase(({ client, db }) => {
    const issued = issueServiceToken(db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });

    assert.match(issued.token, /^usk_/u);
    assert.equal(issued.record.name, "api");
    assert.equal(issued.record.scopePrefix, "github");
    assert.equal(issued.record.capability, "read");
    assert.equal(issued.record.lastUsedAt, null);
    assert.equal(issued.record.revokedAt, null);

    // Every column of the raw row, not just the ones the summary exposes: the
    // plaintext must be absent from the database entirely.
    const rows = client.prepare("SELECT * FROM service_tokens").all();

    assert.equal(rows.length, 1);
    assert.ok(
      !JSON.stringify(rows).includes(issued.token),
      "the stored row contains the plaintext token",
    );
  });
});

void test("a token is found by its plaintext and loses that lookup once revoked", () => {
  withDatabase(({ db }) => {
    const issued = issueServiceToken(db, {
      name: "api",
      scopePrefix: "github",
      capability: "manage",
    });

    const active = findServiceTokenByPlaintext(db, issued.token);

    assert.ok(active.outcome === "active");
    assert.equal(active.token.id, issued.record.id);

    assert.equal(revokeServiceToken(db, "api")?.name, "api");

    const revoked = findServiceTokenByPlaintext(db, issued.token);

    assert.ok(revoked.outcome === "revoked");
    assert.notEqual(revoked.token.revokedAt, null);
    assert.equal(revokeServiceToken(db, "api"), null);
  });
});

void test("lookup separates a malformed presentation from an unknown one", () => {
  withDatabase(({ db }) => {
    assert.equal(findServiceTokenByPlaintext(db, "not-a-token").outcome, "malformed");
    assert.equal(
      findServiceTokenByPlaintext(db, `usk_${"A".repeat(43)}`).outcome,
      "unknown",
      "a well-formed token that was never issued is unknown, not malformed",
    );
  });
});

void test("issuance rejects a duplicate name, a bad name, a bad scope, and a bad capability", () => {
  withDatabase(({ db }) => {
    issueServiceToken(db, { name: "api", scopePrefix: "github", capability: "read" });

    assert.throws(
      () => issueServiceToken(db, { name: "api", scopePrefix: "other", capability: "read" }),
      /already exists/u,
    );
    assert.throws(
      () =>
        issueServiceToken(db, { name: "Api Worker", scopePrefix: "github", capability: "read" }),
      /name must match/u,
    );
    assert.throws(
      () => issueServiceToken(db, { name: "worker", scopePrefix: "Github/", capability: "read" }),
      /scope must be a valid secret name prefix/u,
    );
    // The CLI validates this at its own boundary; the store refuses it too, so
    // no caller can mint a token carrying a capability nothing checks.
    const unknownCapability: string = "admin";

    assert.throws(
      () =>
        issueServiceToken(db, {
          name: "worker",
          scopePrefix: "github",
          capability: unknownCapability as ServiceTokenCapability,
        }),
      /capability must be read, write or manage/u,
    );
  });
});

void test("listing exposes the capability and never the digest", () => {
  withDatabase(({ db }) => {
    const issued = issueServiceToken(db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });

    issueServiceToken(db, { name: "deploy-worker", scopePrefix: "dokploy", capability: "manage" });

    const tokens = listServiceTokens(db);

    assert.deepEqual(
      tokens.map((token) => `${token.name}:${token.capability}:${token.scopePrefix}`),
      ["api:read:github", "deploy-worker:manage:dokploy"],
    );
    assert.ok(
      !JSON.stringify(tokens).includes(issued.token),
      "the listing contains the plaintext token",
    );
    assert.equal(
      Object.keys(tokens[0] ?? {}).includes("tokenHash"),
      false,
      "the listing exposes the digest",
    );
  });
});

void test("a revoked name can be reissued, and the revoked row survives", () => {
  withDatabase(({ db }) => {
    const first = issueServiceToken(db, {
      name: "deploy-worker",
      scopePrefix: "dokploy",
      capability: "manage",
    });

    assert.equal(revokeServiceToken(db, "deploy-worker")?.id, first.record.id);

    const second = issueServiceToken(db, {
      name: "deploy-worker",
      scopePrefix: "dokploy",
      capability: "manage",
    });

    assert.notEqual(second.record.id, first.record.id);

    const names = listServiceTokens(db).map(
      (token) => `${token.id}:${String(token.revokedAt !== null)}`,
    );

    assert.deepEqual(
      new Set(names),
      new Set([`${first.record.id}:true`, `${second.record.id}:false`]),
    );
  });
});

void test("issuance refuses a second live token while revoked rows under the same name accumulate", () => {
  withDatabase(({ db }) => {
    issueServiceToken(db, { name: "deploy-worker", scopePrefix: "dokploy", capability: "manage" });
    revokeServiceToken(db, "deploy-worker");

    issueServiceToken(db, { name: "deploy-worker", scopePrefix: "dokploy", capability: "manage" });
    revokeServiceToken(db, "deploy-worker");

    issueServiceToken(db, { name: "deploy-worker", scopePrefix: "dokploy", capability: "manage" });

    assert.throws(
      () =>
        issueServiceToken(db, {
          name: "deploy-worker",
          scopePrefix: "dokploy",
          capability: "manage",
        }),
      /an active token named "deploy-worker" already exists/u,
    );

    const revokedCount = listServiceTokens(db).filter((token) => token.revokedAt !== null).length;

    assert.equal(revokedCount, 2);
  });
});

// The store's check-then-insert refuses a second live name before SQLite is
// ever consulted, so the two tests above pass identically whether
// `service_tokens_live_unique` exists, is misspelt, or was never created —
// they cannot detect a missing or broken index. This test bypasses the store
// entirely and inserts straight through the driver, so only the database's
// own constraint can save it.
void test("the database itself refuses two live rows sharing a name but accepts a revoked one", () => {
  withDatabase(({ client }) => {
    const insert = (row: { id: string; tokenHash: string; revokedAt: string | null }) => {
      client
        .prepare(
          `INSERT INTO service_tokens (id, name, token_hash, scope_prefix, capability, revoked_at)
           VALUES (?, 'deploy-worker', ?, 'dokploy', 'manage', ?)`,
        )
        .run(row.id, row.tokenHash, row.revokedAt);
    };

    insert({ id: "live-1", tokenHash: "hash-1", revokedAt: null });

    assert.throws(() => {
      insert({ id: "live-2", tokenHash: "hash-2", revokedAt: null });
    }, /UNIQUE constraint failed/u);

    assert.doesNotThrow(() => {
      insert({ id: "revoked-1", tokenHash: "hash-3", revokedAt: "2026-01-01" });
    });
  });
});

void test("touching a token records when it was last used", () => {
  withDatabase(({ db }) => {
    const issued = issueServiceToken(db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });

    touchServiceTokenLastUsed(db, issued.record.id);

    const stored = db.select().from(serviceTokensTable).all();

    assert.equal(stored.length, 1);
    assert.notEqual(stored[0]?.lastUsedAt, null);
  });
});
