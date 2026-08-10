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

import { runKekCli } from "../src/cli/kek.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { secretVersionsTable, secretsTable } from "../src/db/schema/index.js";
import { openSecretPlaintext, sealSecretPlaintext } from "../src/keyring.js";
import { createSecret, getLiveSecretVersion } from "../src/modules/secrets/store.js";

function keyForVersion(version: number): string {
  return Buffer.alloc(32, version).toString("base64");
}

/** Highest version first — `loadSecretsKeyring` refuses a ring where the active key is not the newest. */
function buildKeyring(versions: readonly number[]): SecretsKeyring {
  const encoded = [...versions]
    .sort((a, b) => b - a)
    .map((version) => `${version}:${keyForVersion(version)}`)
    .join(",");

  return loadSecretsKeyring(encoded);
}

interface KekFixture {
  instance: SecretsDatabaseInstance;
  output: string[];
  run: (...argv: string[]) => string[];
  runWith: (keyring: SecretsKeyring | undefined, ...argv: string[]) => string[];
  /** Seals `plaintext` under exactly `version` and inserts the row directly, bypassing every route. */
  seal: (
    version: number,
    name: string,
    plaintext: string,
  ) => { versionId: string; envelope: string };
  auditRows: (action: string) => Array<{ outcome: string; secretName: string | null }>;
}

function withKekCli(exercise: (fixture: KekFixture) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-kek-cli-"));

  try {
    const instance = createSecretsDatabase({ filePath: join(directory, "secrets.sqlite") });

    try {
      migrateSecretsDatabase(instance);

      const output: string[] = [];
      const write = (line: string) => {
        output.push(line);
      };

      const runWith = (keyring: SecretsKeyring | undefined, ...argv: string[]): string[] => {
        const start = output.length;

        runKekCli(argv, { db: instance.db, keyring, write });

        return output.slice(start);
      };

      const seal = (version: number, name: string, plaintext: string) => {
        const singleKeyRing = buildKeyring([version]);
        const versionId = randomUUID();
        const sealed = sealSecretPlaintext(singleKeyRing, { name, versionId }, plaintext);

        createSecret(instance.db, {
          name,
          versionId,
          envelope: sealed.envelope,
          maskedPrefix: sealed.maskedPrefix,
          kekVersion: sealed.kekVersion,
        });

        return { versionId, envelope: sealed.envelope };
      };

      const auditRows = (action: string) =>
        instance.client
          .prepare(
            "SELECT outcome, secret_name AS secretName FROM secret_audit_log WHERE action = ?",
          )
          .all(action) as Array<{ outcome: string; secretName: string | null }>;

      exercise({
        instance,
        output,
        run: (...argv: string[]) => runWith(buildKeyring([1]), ...argv),
        runWith,
        seal,
        auditRows,
      });
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

// ---- verify ----------------------------------------------------------------

void test("verify passes and prints the version table when every row already sits under the active key", () => {
  withKekCli(({ seal, runWith, auditRows }) => {
    seal(2, "github/token-a", "plaintext-a");
    seal(2, "github/token-b", "plaintext-b");

    // The ring carries a retired version 1 nothing is sealed under any more — verify still passes.
    const keyring = buildKeyring([1, 2]);
    const lines = runWith(keyring, "verify");

    assert.match(lines.join("\n"), /^2\t2\t2\tyes\t2\t0$/mu);
    assert.match(lines.join("\n"), /Every row is sealed under active version 2/u);
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "success");
  });
});

void test("verify throws on an empty store", () => {
  withKekCli(({ runWith, auditRows }) => {
    assert.throws(() => runWith(buildKeyring([1]), "verify"), /No sealed rows exist/u);
    assert.equal(auditRows("kek.verified").length, 0, "an empty-store guard wrote an audit row");
  });
});

void test("verify throws when a row's version is absent from the ring", () => {
  withKekCli(({ seal, runWith, auditRows }) => {
    seal(1, "github/token", "plaintext");

    assert.throws(() => runWith(buildKeyring([2]), "verify"), /kek verified.*|.*/u);
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "failure");
  });
});

void test("verify throws when the kek_version column disagrees with the envelope's version field", () => {
  withKekCli(({ instance, seal, runWith, auditRows }) => {
    const { versionId } = seal(1, "github/token", "plaintext");

    instance.db
      .update(secretVersionsTable)
      .set({ kekVersion: 2 })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    assert.throws(() => runWith(buildKeyring([1, 2]), "verify"), /refusing to trust/iu);
    // The disagreement is a form of verification failure, same as any other — one failure row lands.
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "failure");
  });
});

void test("verify exits non-zero when rows sit outside activeVersion even though they all open", () => {
  withKekCli(({ seal, runWith }) => {
    seal(1, "github/token", "plaintext");

    assert.throws(() => runWith(buildKeyring([1, 2]), "verify"), /run `kek rotate`/u);
  });
});

void test("verify throws on a corrupted row and never prints the plaintext", () => {
  withKekCli(({ instance, output, seal, runWith }) => {
    const plaintext = "hunter2-do-not-leak-this";
    const { versionId, envelope } = seal(1, "github/token", plaintext);
    const fields = envelope.split(".");

    fields[3] = Buffer.from("not the real ciphertext").toString("base64");

    instance.db
      .update(secretVersionsTable)
      .set({ envelope: fields.join(".") })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    assert.throws(() => runWith(buildKeyring([1]), "verify"), /could not be opened/u);
    assert.ok(!output.join("\n").includes(plaintext), "verify printed the plaintext");
  });
});

void test("a failing audit write does not turn a successful verification into a reported verification failure", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/token", "plaintext");
    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(
      () => runWith(buildKeyring([1]), "verify"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /could not be opened|refusing to trust/iu);
        assert.match(error.message, /audit row could not be written/u);

        return true;
      },
    );
  });
});

// ---- rotate ------------------------------------------------------------------

void test("rotate refuses when the ring holds a single version, and touches nothing", () => {
  withKekCli(({ seal, runWith, instance }) => {
    seal(1, "github/token", "plaintext");

    assert.throws(() => runWith(buildKeyring([1]), "rotate"), /nothing to rotate to/u);

    const row = instance.db
      .select({ kekVersion: secretVersionsTable.kekVersion })
      .from(secretVersionsTable)
      .get();

    assert.equal(row?.kekVersion, 1);
  });
});

void test("rotate moves every row — live and superseded — to the active version", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/live", "plaintext-live");
    const { versionId: supersededId } = seal(1, "github/superseded", "plaintext-superseded");

    instance.db
      .update(secretVersionsTable)
      .set({ supersededAt: new Date().toISOString() })
      .where(eq(secretVersionsTable.id, supersededId))
      .run();

    const before = instance.db
      .select({
        id: secretVersionsTable.id,
        maskedPrefix: secretVersionsTable.maskedPrefix,
      })
      .from(secretVersionsTable)
      .all();
    const rotatedAtBefore = instance.db
      .select({ rotatedAt: secretsTable.rotatedAt })
      .from(secretsTable)
      .all();

    const keyring = buildKeyring([1, 2]);
    runWith(keyring, "rotate");

    const after = instance.db
      .select({
        id: secretVersionsTable.id,
        kekVersion: secretVersionsTable.kekVersion,
        maskedPrefix: secretVersionsTable.maskedPrefix,
      })
      .from(secretVersionsTable)
      .all();

    assert.deepEqual(
      after.map((row) => row.id).sort(),
      before.map((row) => row.id).sort(),
      "rotation changed a row's id",
    );
    assert.ok(after.every((row) => row.kekVersion === 2));
    assert.deepEqual(
      after.map((row) => row.maskedPrefix).sort(),
      before.map((row) => row.maskedPrefix).sort(),
    );

    const rotatedAtAfter = instance.db
      .select({ rotatedAt: secretsTable.rotatedAt })
      .from(secretsTable)
      .all();

    assert.deepEqual(rotatedAtAfter, rotatedAtBefore, "rotate touched secrets.rotated_at");
  });
});

void test("after rotate, every row opens through the live-read path to its original plaintext", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/token", "plaintext-value");

    const keyring = buildKeyring([1, 2]);
    runWith(keyring, "rotate");

    const live = getLiveSecretVersion(instance.db, "github/token");
    assert.ok(live);
    assert.equal(
      openSecretPlaintext(
        keyring,
        { name: "github/token", versionId: live.versionId },
        live.envelope,
      ),
      "plaintext-value",
    );
  });
});

void test("rotate is resumable: rows already on the active version are left alone", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/already-done", "plaintext-a");
    seal(1, "github/pending", "plaintext-b");

    const keyring = buildKeyring([1, 2]);

    // Pre-seal one row under version 2 directly, simulating a prior partial run.
    const alreadyDoneRow = instance.db
      .select({ id: secretVersionsTable.id, envelope: secretVersionsTable.envelope })
      .from(secretVersionsTable)
      .where(eq(secretVersionsTable.secretName, "github/already-done"))
      .get();
    assert.ok(alreadyDoneRow);

    const resealed = sealSecretPlaintext(
      keyring,
      { name: "github/already-done", versionId: alreadyDoneRow.id },
      "plaintext-a",
    );

    instance.db
      .update(secretVersionsTable)
      .set({ envelope: resealed.envelope, kekVersion: resealed.kekVersion })
      .where(eq(secretVersionsTable.id, alreadyDoneRow.id))
      .run();

    runWith(keyring, "rotate");

    const rows = instance.db
      .select({
        secretName: secretVersionsTable.secretName,
        kekVersion: secretVersionsTable.kekVersion,
      })
      .from(secretVersionsTable)
      .all();

    assert.ok(rows.every((row) => row.kekVersion === 2));

    const resealedAuditRows = instance.client
      .prepare(
        "SELECT secret_name AS secretName FROM secret_audit_log WHERE action = 'secret.resealed'",
      )
      .all() as Array<{ secretName: string }>;

    assert.deepEqual(
      resealedAuditRows.map((row) => row.secretName),
      ["github/pending"],
      "rotate re-sealed a row that was already on the active version",
    );
  });
});

void test("a mid-run failure aborts, leaves earlier rows re-sealed and later rows untouched, all still openable, and writes a failure audit row", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/a", "plaintext-a");
    const { versionId: bId, envelope: bEnvelope } = seal(1, "github/b", "plaintext-b");
    seal(1, "github/c", "plaintext-c");

    // Corrupt "github/b" (processed second, between "a" and "c" in secret-name order) so its own
    // per-row transaction throws when rotate tries to open it — the transaction rolls back before
    // resealSecretVersion runs, and rotate must still abort rather than continuing to "c".
    const corruptedFields = bEnvelope.split(".");
    corruptedFields[3] = Buffer.from("not the real ciphertext").toString("base64");
    instance.db
      .update(secretVersionsTable)
      .set({ envelope: corruptedFields.join(".") })
      .where(eq(secretVersionsTable.id, bId))
      .run();

    const keyring = buildKeyring([1, 2]);

    assert.throws(() => runWith(keyring, "rotate"));

    const rows = instance.db
      .select({
        secretName: secretVersionsTable.secretName,
        kekVersion: secretVersionsTable.kekVersion,
      })
      .from(secretVersionsTable)
      .all();
    const byName = new Map(rows.map((row) => [row.secretName, row.kekVersion]));

    assert.equal(byName.get("github/a"), 2, "the row reached before the failure was not re-sealed");
    assert.equal(byName.get("github/b"), 1, "the failing row was re-sealed despite the rollback");
    assert.equal(byName.get("github/c"), 1, "rotate continued past the failing row");

    const liveA = getLiveSecretVersion(instance.db, "github/a");
    const liveC = getLiveSecretVersion(instance.db, "github/c");
    assert.ok(liveA && liveC);

    assert.equal(
      openSecretPlaintext(
        keyring,
        { name: "github/a", versionId: liveA.versionId },
        liveA.envelope,
      ),
      "plaintext-a",
    );
    assert.equal(
      openSecretPlaintext(
        keyring,
        { name: "github/c", versionId: liveC.versionId },
        liveC.envelope,
      ),
      "plaintext-c",
    );

    const failureRows = instance.client
      .prepare(
        "SELECT secret_name AS secretName, outcome FROM secret_audit_log WHERE action = 'secret.resealed' AND outcome = 'failure'",
      )
      .all() as Array<{ secretName: string; outcome: string }>;

    assert.equal(failureRows.length, 1);
    assert.equal(failureRows[0]?.secretName, "github/b");
  });
});

void test("a mid-run failure whose failure-audit write also fails still surfaces the reseal failure, not the audit failure", () => {
  withKekCli(({ instance, seal, runWith }) => {
    const { versionId, envelope } = seal(1, "github/token", "plaintext");

    const corruptedFields = envelope.split(".");
    corruptedFields[3] = Buffer.from("not the real ciphertext").toString("base64");
    instance.db
      .update(secretVersionsTable)
      .set({ envelope: corruptedFields.join(".") })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(
      () => runWith(buildKeyring([1, 2]), "rotate"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // The reseal failure (envelope authentication) stays the primary message; the audit
        // write's own failure is appended, never substituted in its place.
        assert.match(error.message, /authentication|decrypt/iu);
        assert.match(error.message, /secret\.resealed failure audit row could not be written/u);

        return true;
      },
    );
  });
});

void test("rotate refuses to start when a row's version is missing from the ring, and touches nothing", () => {
  withKekCli(({ instance, seal, runWith }) => {
    seal(1, "github/a", "plaintext-a");
    seal(3, "github/b", "plaintext-b");

    assert.throws(() => runWith(buildKeyring([1, 2]), "rotate"), /does not carry/u);

    const rows = instance.db
      .select({
        secretName: secretVersionsTable.secretName,
        kekVersion: secretVersionsTable.kekVersion,
      })
      .from(secretVersionsTable)
      .all();

    assert.deepEqual(rows.map((row) => [row.secretName, row.kekVersion]).sort(), [
      ["github/a", 1],
      ["github/b", 3],
    ]);
  });
});

void test("rotate on an already-complete store is a no-op with a message", () => {
  withKekCli(({ seal, runWith, instance }) => {
    seal(2, "github/token", "plaintext");

    const keyring = buildKeyring([1, 2]);
    const lines = runWith(keyring, "rotate");

    assert.ok(lines.some((line) => line.includes("already sealed under version 2")));

    const resealedAuditRows = instance.client
      .prepare("SELECT 1 FROM secret_audit_log WHERE action = 'secret.resealed'")
      .all();
    assert.equal(resealedAuditRows.length, 0);
  });
});

// ---- generate ------------------------------------------------------------------

void test("generate prints an entry that loadSecretsKeyring accepts", () => {
  withKekCli(({ runWith }) => {
    const keyring = buildKeyring([1]);
    const lines = runWith(keyring, "generate");
    const entryLine = lines.find((line) => /^\d+:[A-Za-z0-9+/]+=*$/u.test(line));

    assert.ok(entryLine, "generate printed no `<version>:<key>` line");

    const generatedVersion = Number(entryLine.split(":")[0]);
    assert.ok(
      generatedVersion > 1,
      "generate did not default past the loaded ring's active version",
    );

    // Highest version first, matching the format `kek generate`'s own reminder describes.
    assert.doesNotThrow(() => loadSecretsKeyring(`${entryLine},1:${keyForVersion(1)}`));
  });
});

// `main()` isn't exported — its own wiring decision (which env determines whether `generate`
// gets a loaded keyring) is only reachable by actually running the CLI as a process, not by
// calling `runGenerate` or `runKekCli` with an injected `deps.keyring`.
void test("main() loads a keyring for generate whenever SECRETS_KEKS is set, and only defaults to version 1 when it is genuinely absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-kek-generate-main-"));

  try {
    const kekEntryPath = fileURLToPath(new URL("../src/cli/kek.ts", import.meta.url));
    const secretsAppRoot = fileURLToPath(new URL("..", import.meta.url));
    const databaseFilePath = join(directory, "secrets.sqlite");

    const runGenerateProcess = (secretsKeks: string | undefined): number => {
      const env: NodeJS.ProcessEnv = { ...process.env, SECRETS_DATABASE_URL: databaseFilePath };

      if (secretsKeks === undefined) {
        delete env.SECRETS_KEKS;
      } else {
        env.SECRETS_KEKS = secretsKeks;
      }

      const result = spawnSync(process.execPath, ["--import", "tsx", kekEntryPath, "generate"], {
        cwd: secretsAppRoot,
        env,
        encoding: "utf8",
      });

      assert.equal(result.status, 0, `generate exited non-zero; stderr was: ${result.stderr}`);

      const entryLine = result.stdout
        .split("\n")
        .find((line) => /^\d+:[A-Za-z0-9+/]+=*$/u.test(line));

      assert.ok(
        entryLine,
        `generate printed no <version>:<key> line; stdout was: ${result.stdout}`,
      );

      return Number(entryLine.split(":")[0]);
    };

    assert.equal(
      runGenerateProcess(undefined),
      1,
      "with no SECRETS_KEKS at all (the fresh-bootstrap case), generate must default to version 1",
    );

    const ring = `2:${keyForVersion(2)},1:${keyForVersion(1)}`;

    assert.equal(
      runGenerateProcess(ring),
      3,
      "with SECRETS_KEKS set to a ring whose active version is 2, generate must default to 3",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
