import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadSecretsKeyring, type SecretsKeyring } from "@unimatrix/secrets";
import { eq } from "drizzle-orm";

import { runSecretCli } from "../src/cli/secret.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { secretVersionsTable } from "../src/db/schema/index.js";
import { sealSecretPlaintext } from "../src/keyring.js";
import { createSecret } from "../src/modules/secrets/store.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const PLAINTEXT = "hunter2-hunter2-do-not-leak-this";

interface SecretCliFixture {
  instance: SecretsDatabaseInstance;
  keyring: SecretsKeyring;
  output: string[];
  run: (...argv: string[]) => string[];
  seal: (name: string, plaintext: string) => { versionId: string; envelope: string };
  auditRows: () => Array<{
    outcome: string;
    secretName: string | null;
    secretVersionId: string | null;
    actorKind: string;
    actorTokenId: string | null;
  }>;
}

function withSecretCli(exercise: (fixture: SecretCliFixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-read-cli-"));

  try {
    const instance = createSecretsDatabase({ filePath: join(directory, "secrets.sqlite") });

    try {
      migrateSecretsDatabase(instance);

      const keyring = loadSecretsKeyring(TEST_KEK);
      const output: string[] = [];
      const write = (line: string) => {
        output.push(line);
      };

      const run = (...argv: string[]): string[] => {
        const start = output.length;

        runSecretCli(argv, { db: instance.db, keyring, write });

        return output.slice(start);
      };

      const seal = (name: string, plaintext: string) => {
        const versionId = randomUUID();
        const sealed = sealSecretPlaintext(keyring, { name, versionId }, plaintext);

        createSecret(instance.db, {
          name,
          versionId,
          envelope: sealed.envelope,
          maskedPrefix: sealed.maskedPrefix,
          kekVersion: sealed.kekVersion,
        });

        return { versionId, envelope: sealed.envelope };
      };

      const auditRows = () =>
        instance.client
          .prepare(
            "SELECT outcome, secret_name AS secretName, secret_version_id AS secretVersionId, " +
              "actor_kind AS actorKind, actor_token_id AS actorTokenId " +
              "FROM secret_audit_log WHERE action = 'secret.read'",
          )
          .all() as Array<{
          outcome: string;
          secretName: string | null;
          secretVersionId: string | null;
          actorKind: string;
          actorTokenId: string | null;
        }>;

      exercise({ instance, keyring, output, run, seal, auditRows });
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

void test("read prints the live value exactly once and writes one success audit row", () => {
  withSecretCli(({ seal, run, auditRows }) => {
    const { versionId } = seal("github/token", PLAINTEXT);

    const lines = run("read", "--name", "github/token");

    assert.deepEqual(lines, [PLAINTEXT]);

    const rows = auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.outcome, "success");
    assert.equal(rows[0]?.actorKind, "host-cli");
    assert.equal(rows[0]?.actorTokenId, null);
    assert.equal(rows[0]?.secretVersionId, versionId);
  });
});

void test("an absent name prints nothing, throws, and still writes a failure row", () => {
  withSecretCli(({ run, output, auditRows }) => {
    assert.throws(() => run("read", "--name", "github/missing"), /No live secret named/u);

    assert.deepEqual(output, []);

    const rows = auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.outcome, "failure");
    assert.equal(rows[0]?.secretName, "github/missing");
    assert.equal(rows[0]?.secretVersionId, null);
  });
});

void test("a corrupted ciphertext field prints nothing and writes a failure row", () => {
  withSecretCli(({ instance, seal, run, output, auditRows }) => {
    const { versionId, envelope } = seal("github/token", PLAINTEXT);
    const fields = envelope.split(".");

    fields[3] = Buffer.from("not the real ciphertext").toString("base64");

    instance.db
      .update(secretVersionsTable)
      .set({ envelope: fields.join(".") })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    assert.throws(() => run("read", "--name", "github/token"));

    assert.deepEqual(output, []);

    const rows = auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.outcome, "failure");
    assert.equal(rows[0]?.secretVersionId, versionId);
  });
});

void test("with secret_audit_log dropped, the value is not printed", () => {
  withSecretCli(({ instance, seal, run, output }) => {
    seal("github/token", PLAINTEXT);
    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(() => run("read", "--name", "github/token"));

    assert.deepEqual(
      output,
      [],
      "the value was printed before the audit write that failed beside it",
    );
  });
});

void test("an absent name whose own audit write also fails still surfaces the absent-secret error, not the audit failure", () => {
  withSecretCli(({ instance, run, output }) => {
    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(
      () => run("read", "--name", "github/missing"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // The absent-secret reason stays primary — "no such table" is only ever appended after it,
        // never standing alone in its place the way the pre-fix bug reported it.
        assert.ok(
          error.message.startsWith('No live secret named "github/missing".'),
          `the absent-secret reason was not primary: ${error.message}`,
        );
        assert.match(error.message, /audit row could not be written/u);

        return true;
      },
    );
    assert.deepEqual(output, []);
  });
});

void test("a corrupted ciphertext whose own audit write also fails still surfaces the decrypt failure, not the audit failure", () => {
  withSecretCli(({ instance, seal, run, output }) => {
    const { versionId, envelope } = seal("github/token", PLAINTEXT);
    const fields = envelope.split(".");

    fields[3] = Buffer.from("not the real ciphertext").toString("base64");

    instance.db
      .update(secretVersionsTable)
      .set({ envelope: fields.join(".") })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(
      () => run("read", "--name", "github/token"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /authentication|decrypt/iu);
        assert.match(error.message, /audit row could not be written/u);

        return true;
      },
    );
    assert.deepEqual(output, []);
  });
});

void test("an unrecognised or repeated flag, a missing --name, and an unknown subcommand all refuse", () => {
  withSecretCli(({ run }) => {
    assert.throws(
      () => run("read", "--name", "github/token", "--force"),
      /Unknown argument "--force"[\s\S]*Usage:/u,
    );
    assert.throws(
      () => run("read", "--name", "github/a", "--name", "github/b"),
      /--name was given more than once/u,
    );
    assert.throws(() => run("read"), /--name is required/u);
    assert.throws(() => run("list"), /Unknown subcommand "list"[\s\S]*Usage:/u);
    assert.throws(() => run(), /Unknown subcommand ""/u);
  });
});

void test("read does not crash with an unhandled EPIPE when its stdout is closed early by a pipe reader", () => {
  const secretEntryPath = fileURLToPath(new URL("../src/cli/secret.ts", import.meta.url));
  const secretsAppRoot = fileURLToPath(new URL("..", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-read-epipe-"));

  try {
    const databaseFilePath = join(directory, "secrets.sqlite");
    const instance = createSecretsDatabase({ filePath: databaseFilePath });

    migrateSecretsDatabase(instance);

    const keyring = loadSecretsKeyring(TEST_KEK);
    const versionId = randomUUID();
    const sealed = sealSecretPlaintext(keyring, { name: "github/token", versionId }, PLAINTEXT);

    createSecret(instance.db, {
      name: "github/token",
      versionId,
      envelope: sealed.envelope,
      maskedPrefix: sealed.maskedPrefix,
      kekVersion: sealed.kekVersion,
    });
    instance.client.close();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SECRETS_DATABASE_URL: databaseFilePath,
      SECRETS_KEKS: TEST_KEK,
    };

    // `head -c 0` reads nothing and closes its end of the pipe immediately, guaranteeing the
    // producer's one write lands after the reader is gone.
    const result = spawnSync(
      "sh",
      [
        "-c",
        `node --import tsx ${JSON.stringify(secretEntryPath)} read --name github/token | head -c 0`,
      ],
      { cwd: secretsAppRoot, env, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `pipeline exited non-zero; stderr was: ${result.stderr}`);
    assert.doesNotMatch(
      result.stderr,
      /Unhandled 'error' event|EPIPE/u,
      `read crashed on EPIPE instead of exiting clean; stderr was: ${result.stderr}`,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
