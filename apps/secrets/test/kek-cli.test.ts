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
import {
  createSecret,
  getLiveSecretVersion,
  resealSecretVersion,
} from "../src/modules/secrets/store.js";

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
  /** `kek verify --expect-active <keyring.activeVersion>`. */
  verify: (keyring: SecretsKeyring) => string[];
  /** `kek rotate --to-version <keyring.activeVersion>`. */
  rotate: (keyring: SecretsKeyring) => string[];
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

      const verify = (keyring: SecretsKeyring): string[] =>
        runWith(keyring, "verify", "--expect-active", String(keyring.activeVersion));

      const rotate = (keyring: SecretsKeyring): string[] =>
        runWith(keyring, "rotate", "--to-version", String(keyring.activeVersion));

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
        verify,
        rotate,
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
  withKekCli(({ seal, verify, auditRows }) => {
    seal(2, "github/token-a", "plaintext-a");
    seal(2, "github/token-b", "plaintext-b");

    // The ring carries a retired version 1 nothing is sealed under any more — verify still passes.
    const keyring = buildKeyring([1, 2]);
    const lines = verify(keyring);

    assert.match(lines.join("\n"), /^2\t2\t2\tyes\t2\t0$/mu);
    assert.match(lines.join("\n"), /Every row is sealed under active version 2/u);
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "success");
  });
});

void test("verify --expect-active is required", () => {
  withKekCli(({ runWith }) => {
    assert.throws(
      () => runWith(buildKeyring([1]), "verify"),
      /--expect-active is required[\s\S]*Usage:/u,
    );
  });
});

void test("verify refuses when SECRETS_KEKS's active version does not match --expect-active, and writes no audit row", () => {
  withKekCli(({ seal, runWith, auditRows }) => {
    seal(2, "github/token", "plaintext");

    assert.throws(
      () => runWith(buildKeyring([1, 2]), "verify", "--expect-active", "3"),
      /active version is 2, not the 3 you expected[\s\S]*Refusing to certify/u,
    );
    assert.equal(
      auditRows("kek.verified").length,
      0,
      "an --expect-active mismatch is refused before the census, and writes no audit row",
    );
  });
});

void test("verify throws on an empty store and still writes a failure audit row", () => {
  withKekCli(({ verify, auditRows }) => {
    assert.throws(() => verify(buildKeyring([1])), /No sealed rows exist/u);
    assert.equal(auditRows("kek.verified").length, 1, "an empty-store refusal wrote no audit row");
    assert.equal(auditRows("kek.verified")[0]?.outcome, "failure");
  });
});

void test("verify throws when a row's version is absent from the ring, and names the row in its report", () => {
  withKekCli(({ seal, verify, output, auditRows }) => {
    const { versionId } = seal(1, "github/token", "plaintext");

    assert.throws(
      () => verify(buildKeyring([2])),
      /1 row\(s\) could not be opened under a KEK in the ring\./u,
    );
    assert.ok(
      output.some((line) => line.includes("github/token") && line.includes(versionId)),
      "the report never named the failing row",
    );
    assert.ok(
      output.some((line) => line.includes("not in SECRETS_KEKS")),
      "the report never gave a cause",
    );
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "failure");
  });
});

void test("verify treats a kek_version column/envelope mismatch as a per-row failure rather than aborting the census", () => {
  withKekCli(({ instance, seal, verify, output, auditRows }) => {
    seal(1, "github/other", "other-plaintext");
    const { versionId } = seal(1, "github/token", "plaintext");

    instance.db
      .update(secretVersionsTable)
      .set({ kekVersion: 2 })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    assert.throws(
      () => verify(buildKeyring([1, 2])),
      /1 row\(s\) could not be opened under a KEK in the ring\./u,
    );

    // The whole census still printed — a mismatch on one row must not suppress the other row's line.
    assert.ok(
      output.some((line) => line.startsWith("kek version\trows")),
      "the header never printed",
    );
    assert.ok(
      output.some((line) => line.includes("github/token") && line.includes(versionId)),
      "the mismatched row was never named",
    );
    assert.ok(
      output.some((line) =>
        /kek_version column is 2 but the envelope is sealed under version 1/u.test(line),
      ),
      "the mismatch's cause was never reported",
    );
    assert.equal(auditRows("kek.verified").length, 1);
    assert.equal(auditRows("kek.verified")[0]?.outcome, "failure");
  });
});

void test("verify exits non-zero when rows sit outside activeVersion even though they all open", () => {
  withKekCli(({ seal, verify }) => {
    seal(1, "github/token", "plaintext");

    assert.throws(() => verify(buildKeyring([1, 2])), /run `kek rotate`/u);
  });
});

void test("verify throws on a corrupted row, names it with its cause, and never prints the plaintext", () => {
  withKekCli(({ instance, output, seal, verify }) => {
    const plaintext = "hunter2-do-not-leak-this";
    const { versionId, envelope } = seal(1, "github/token", plaintext);
    const fields = envelope.split(".");

    fields[3] = Buffer.from("not the real ciphertext").toString("base64");

    instance.db
      .update(secretVersionsTable)
      .set({ envelope: fields.join(".") })
      .where(eq(secretVersionsTable.id, versionId))
      .run();

    assert.throws(() => verify(buildKeyring([1])), /could not be opened/u);
    assert.ok(
      output.some((line) => line.includes("github/token") && line.includes("DECRYPT_FAILED")),
      "the corrupted row's cause was never reported",
    );
    assert.ok(!output.join("\n").includes(plaintext), "verify printed the plaintext");
    assert.ok(!output.join("\n").includes(fields[3] ?? ""), "verify printed the ciphertext field");
  });
});

void test("a failing audit write does not turn a successful verification into a reported verification failure, and stdout's last line still reads NOT VERIFIED", () => {
  withKekCli(({ instance, seal, output, verify }) => {
    const keyring = buildKeyring([1]);
    seal(1, "github/token", "plaintext");
    instance.client.exec("DROP TABLE secret_audit_log");

    assert.throws(
      () => verify(keyring),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /could not be opened|refusing to trust/iu);
        assert.match(error.message, /audit row could not be written/u);

        return true;
      },
    );

    const lastLine = output.at(-1);
    assert.ok(lastLine?.startsWith("NOT VERIFIED"), `stdout's last line was: ${String(lastLine)}`);
  });
});

void test("verify refuses when no keyring is injected — reachable only by calling runKekCli directly, never through main()", () => {
  withKekCli(({ instance }) => {
    assert.throws(() => {
      runKekCli(["verify", "--expect-active", "1"], {
        db: instance.db,
        keyring: undefined,
        write: () => {},
      });
    }, /SECRETS_KEKS must be set to run this command/u);
  });
});

// ---- rotate ------------------------------------------------------------------

void test("rotate --to-version is required", () => {
  withKekCli(({ runWith }) => {
    assert.throws(
      () => runWith(buildKeyring([1]), "rotate"),
      /--to-version is required[\s\S]*Usage:/u,
    );
  });
});

void test("rotate refuses when SECRETS_KEKS's active version does not match --to-version, touches nothing, and writes a kek.rotated failure row", () => {
  withKekCli(({ seal, runWith, instance, auditRows }) => {
    seal(2, "github/token", "plaintext");

    assert.throws(
      () => runWith(buildKeyring([1, 2]), "rotate", "--to-version", "3"),
      /active version is 2, not the 3 you asked for[\s\S]*redeploy[\s\S]*Refusing to rotate/u,
    );

    const row = instance.db
      .select({ kekVersion: secretVersionsTable.kekVersion })
      .from(secretVersionsTable)
      .get();

    assert.equal(row?.kekVersion, 2);
    assert.equal(auditRows("kek.rotated").length, 1);
    assert.equal(auditRows("kek.rotated")[0]?.outcome, "failure");
  });
});

void test("rotate refuses when the ring holds a single version, touches nothing, and writes a kek.rotated failure row", () => {
  withKekCli(({ seal, rotate, instance, auditRows }) => {
    seal(1, "github/token", "plaintext");

    assert.throws(() => rotate(buildKeyring([1])), /nothing to rotate to/u);

    const row = instance.db
      .select({ kekVersion: secretVersionsTable.kekVersion })
      .from(secretVersionsTable)
      .get();

    assert.equal(row?.kekVersion, 1);
    assert.equal(auditRows("kek.rotated").length, 1);
    assert.equal(auditRows("kek.rotated")[0]?.outcome, "failure");
  });
});

void test("rotate moves every row — live and superseded — to the active version, and writes a kek.rotated success row", () => {
  withKekCli(({ instance, seal, rotate, auditRows }) => {
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
    rotate(keyring);

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
    assert.equal(auditRows("kek.rotated").length, 1);
    assert.equal(auditRows("kek.rotated")[0]?.outcome, "success");
  });
});

void test("after rotate, every row opens through the live-read path to its original plaintext", () => {
  withKekCli(({ instance, seal, rotate }) => {
    seal(1, "github/token", "plaintext-value");

    const keyring = buildKeyring([1, 2]);
    rotate(keyring);

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
  withKekCli(({ instance, seal, rotate }) => {
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

    rotate(keyring);

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

void test("a mid-run failure aborts, leaves earlier rows re-sealed and later rows untouched, all still openable, and writes a failure audit row naming it", () => {
  withKekCli(({ instance, seal, rotate }) => {
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

    assert.throws(
      () => rotate(keyring),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /github\/b/u, "the failure never named the row it stopped on");
        assert.match(error.message, new RegExp(bId, "u"), "the failure never named the version id");

        return true;
      },
    );

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

void test("a mid-run failure whose failure-audit write also fails still surfaces the reseal failure, naming the row, not the audit failure", () => {
  withKekCli(({ instance, seal, rotate }) => {
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
      () => rotate(buildKeyring([1, 2])),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        // The reseal failure (envelope authentication) stays the primary message, and now names the
        // row it happened on; the audit write's own failure is appended, never substituted in its place.
        assert.match(error.message, /github\/token/u);
        assert.match(error.message, new RegExp(versionId, "u"));
        assert.match(error.message, /authentication|decrypt/iu);
        assert.match(error.message, /secret\.resealed failure audit row could not be written/u);

        return true;
      },
    );
  });
});

void test("rotate refuses to start when a row's version is missing from the ring, touches nothing, and writes a kek.rotated failure row", () => {
  withKekCli(({ instance, seal, rotate, auditRows }) => {
    seal(1, "github/a", "plaintext-a");
    seal(3, "github/b", "plaintext-b");

    assert.throws(() => rotate(buildKeyring([1, 2])), /does not carry/u);

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
    assert.equal(auditRows("kek.rotated").length, 1);
    assert.equal(auditRows("kek.rotated")[0]?.outcome, "failure");
  });
});

void test("rotate on an already-complete store is a no-op with a message, and still writes a kek.rotated success row", () => {
  withKekCli(({ seal, rotate, instance, auditRows }) => {
    seal(2, "github/token", "plaintext");

    const keyring = buildKeyring([1, 2]);
    const lines = rotate(keyring);

    assert.ok(lines.some((line) => line.includes("already sealed under version 2")));

    const resealedAuditRows = instance.client
      .prepare("SELECT 1 FROM secret_audit_log WHERE action = 'secret.resealed'")
      .all();
    assert.equal(resealedAuditRows.length, 0);
    assert.equal(auditRows("kek.rotated").length, 1);
    assert.equal(auditRows("kek.rotated")[0]?.outcome, "success");
  });
});

void test("rotate on an empty, migrated store is a no-op rather than a refusal — unlike verify", () => {
  withKekCli(({ rotate }) => {
    const keyring = buildKeyring([1, 2]);

    assert.doesNotThrow(() => rotate(keyring));
  });
});

void test("rotate refuses when no keyring is injected — reachable only by calling runKekCli directly, never through main()", () => {
  withKekCli(({ instance }) => {
    assert.throws(() => {
      runKekCli(["rotate", "--to-version", "1"], {
        db: instance.db,
        keyring: undefined,
        write: () => {},
      });
    }, /SECRETS_KEKS must be set to run this command/u);
  });
});

// ---- resealSecretVersion's changes !== 1 guard (apps/secrets/src/modules/secrets/store.ts) -------

void test("resealSecretVersion refuses when the row it targets no longer exists, matching a concurrent delete between rotate's census and its own transaction", () => {
  withKekCli(({ instance, seal }) => {
    const { versionId } = seal(1, "github/token", "plaintext");

    // Simulates a delete landing between `kek rotate`'s up-front census and the per-row transaction
    // it runs for this row — the guard `resealSecretVersion` throws on exists to catch exactly this.
    instance.db.delete(secretVersionsTable).where(eq(secretVersionsTable.id, versionId)).run();

    assert.throws(
      () => {
        resealSecretVersion(instance.db, {
          id: versionId,
          envelope: "v1.2.aaaa.bbbb.cccc",
          kekVersion: 2,
        });
      },
      new RegExp(
        `Expected to re-seal exactly one row for version id "${versionId}", but 0 row\\(s\\) changed\\.`,
        "u",
      ),
    );
  });
});

// ---- generate ------------------------------------------------------------------

void test("generate prints an entry that loadSecretsKeyring accepts, and writes a kek.generated audit row", () => {
  withKekCli(({ runWith, auditRows }) => {
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
    assert.equal(auditRows("kek.generated").length, 1);
    assert.equal(auditRows("kek.generated")[0]?.outcome, "success");
  });
});

void test("generate refuses a --version already carried by the loaded ring", () => {
  withKekCli(({ runWith }) => {
    assert.throws(
      () => runWith(buildKeyring([1, 2]), "generate", "--version", "1"),
      /already in SECRETS_KEKS/u,
    );
  });
});

void test("generate refuses a --version that is not greater than the ring's active version", () => {
  withKekCli(({ runWith }) => {
    // Version 2 is not in the ring — [1, 3] — so this exercises the ordering check rather than the
    // duplicate check above it.
    assert.throws(
      () => runWith(buildKeyring([1, 3]), "generate", "--version", "2"),
      /is not greater than the active version 3/u,
    );
  });
});

void test("generate refuses a --version above 9999, the highest SECRETS_KEKS entries accept", () => {
  withKekCli(({ runWith }) => {
    assert.throws(
      () => runWith(undefined, "generate", "--version", "10000"),
      /--version must be 9999 or lower/u,
    );
  });
});

void test("generate's computed default is bounded the same way as an explicit --version", () => {
  withKekCli(({ runWith }) => {
    assert.throws(
      () => runWith(buildKeyring([9999]), "generate"),
      /--version must be 9999 or lower/u,
    );
  });
});

// `main()` isn't exported — its own wiring decision (which env determines whether `generate`
// gets a loaded keyring) is only reachable by actually running the CLI as a process, not by
// calling `runGenerate` or `runKekCli` with an injected `deps.keyring`.
void test("main() loads a keyring for generate whenever SECRETS_KEKS is set and readable, and only defaults to version 1 when it is genuinely absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-kek-generate-main-"));

  try {
    const kekEntryPath = fileURLToPath(new URL("../src/cli/kek.ts", import.meta.url));
    const secretsAppRoot = fileURLToPath(new URL("..", import.meta.url));
    const databaseFilePath = join(directory, "secrets.sqlite");

    const runGenerateProcess = (
      secretsKeks: string | undefined,
    ): { version: number; stderr: string } => {
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

      return { version: Number(entryLine.split(":")[0]), stderr: result.stderr };
    };

    assert.equal(
      runGenerateProcess(undefined).version,
      1,
      "with no SECRETS_KEKS at all (the fresh-bootstrap case), generate must default to version 1",
    );

    const ring = `2:${keyForVersion(2)},1:${keyForVersion(1)}`;

    assert.equal(
      runGenerateProcess(ring).version,
      3,
      "with SECRETS_KEKS set to a ring whose active version is 2, generate must default to 3",
    );

    const malformed = runGenerateProcess("not-a-ring-at-all");
    assert.equal(
      malformed.version,
      1,
      "an unparsable SECRETS_KEKS must not block generate from minting a way out",
    );
    assert.match(
      malformed.stderr,
      /SECRETS_KEKS could not be read/u,
      "an unparsable SECRETS_KEKS must say so on stderr rather than silently degrading",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("generate does not crash with an unhandled EPIPE when its stdout is closed early by a pipe reader", () => {
  const kekEntryPath = fileURLToPath(new URL("../src/cli/kek.ts", import.meta.url));
  const secretsAppRoot = fileURLToPath(new URL("..", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-kek-epipe-"));

  try {
    const databaseFilePath = join(directory, "secrets.sqlite");
    const env: NodeJS.ProcessEnv = { ...process.env, SECRETS_DATABASE_URL: databaseFilePath };
    delete env.SECRETS_KEKS;

    // `head -1` matches `README.md`'s own dev bootstrap command and closes its end of the pipe as
    // soon as it has its one line — reproducing that closure without a real shell pipe.
    const result = spawnSync(
      "sh",
      ["-c", `node --import tsx ${JSON.stringify(kekEntryPath)} generate | head -1`],
      { cwd: secretsAppRoot, env, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `pipeline exited non-zero; stderr was: ${result.stderr}`);
    assert.doesNotMatch(
      result.stderr,
      /Unhandled 'error' event|EPIPE/u,
      `generate crashed on EPIPE instead of exiting clean; stderr was: ${result.stderr}`,
    );
    assert.match(result.stdout, /^\d+:[A-Za-z0-9+/]+=*$/mu);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
