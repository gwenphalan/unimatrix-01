import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as auditModule from "../src/audit/index.js";
import { runServiceTokenCli } from "../src/cli/service-token.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { secretAuditLogTable } from "../src/db/schema/index.js";
import { isServiceTokenShape, listServiceTokens } from "../src/service-tokens/index.js";

interface AuditFixture {
  instance: SecretsDatabaseInstance;
  run: (...argv: string[]) => string[];
  rows: () => (typeof secretAuditLogTable.$inferSelect)[];
}

function withAuditFixture(exercise: (fixture: AuditFixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-audit-"));

  try {
    const instance = createSecretsDatabase({ filePath: join(directory, "secrets.sqlite") });

    try {
      migrateSecretsDatabase(instance);

      const output: string[] = [];

      exercise({
        instance,
        rows: () => instance.db.select().from(secretAuditLogTable).all(),
        run: (...argv: string[]) => {
          const start = output.length;

          runServiceTokenCli(argv, {
            db: instance.db,
            write: (line: string) => {
              output.push(line);
            },
          });

          return output.slice(start);
        },
      });
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

// The rows this asserts on are written by the shipped code path, not by the
// test: issuing and revoking a credential are mutations of this store.
void test("issuing and revoking each append one attributed row", () => {
  withAuditFixture(({ instance, rows, run }) => {
    run("issue", "--name", "api", "--scope", "github", "--capability", "read");

    const tokenId = listServiceTokens(instance.db)[0]?.id;
    const afterIssue = rows();

    assert.equal(afterIssue.length, 1);
    assert.equal(afterIssue[0]?.action, "service_token.issued");
    assert.equal(afterIssue[0]?.actorKind, "host-cli");
    assert.equal(afterIssue[0]?.outcome, "success");
    assert.equal(afterIssue[0]?.serviceTokenId, tokenId);
    assert.equal(afterIssue[0]?.actorTokenId, null);
    assert.equal(afterIssue[0]?.actorUserId, null);
    assert.notEqual(afterIssue[0]?.occurredAt, null);

    run("revoke", "--name", "api");

    const afterRevoke = rows();

    assert.equal(afterRevoke.length, 2);
    assert.equal(afterRevoke[1]?.action, "service_token.revoked");
    assert.equal(afterRevoke[1]?.serviceTokenId, tokenId);
  });
});

void test("a failed revoke appends nothing", () => {
  withAuditFixture(({ rows, run }) => {
    assert.throws(() => run("revoke", "--name", "nobody"));
    assert.equal(rows().length, 0);
  });
});

void test("no audit column holds the token that was issued", () => {
  withAuditFixture(({ instance, run }) => {
    const printed = run("issue", "--name", "api", "--scope", "github", "--capability", "manage");
    const token = printed.flatMap((line) => line.split(/\s+/u).filter(isServiceTokenShape))[0];
    const raw = JSON.stringify(instance.client.prepare("SELECT * FROM secret_audit_log").all());

    assert.ok(token !== undefined);
    assert.ok(!raw.includes(token), "an audit row carries the plaintext token");
  });
});

// An FK to `secrets(name)` would cascade a delete over the record of that very
// deletion — the client runs `foreign_keys = ON`, so this has to stay empty.
void test("the audit table carries no foreign keys", () => {
  withAuditFixture(({ instance }) => {
    assert.deepEqual(instance.client.pragma("foreign_key_list('secret_audit_log')"), []);
  });
});

// Append-only is held by there being nothing here that can do anything else.
void test("the audit module exports only the writer", () => {
  assert.deepEqual(Object.keys(auditModule), ["recordAuditEntry"]);
});
