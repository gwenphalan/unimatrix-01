// Host-local, same bar as service-token.ts and secret.ts: `docker exec` and the container's own
// SECRETS_KEKS. No subcommand here takes a `--kek` flag — argv is world-readable on the host
// running the container, and `docker exec` already inherits the environment that carries the key,
// so a flag would only widen where the key can leak from.
import { randomBytes } from "node:crypto";

import { recordAuditEntry } from "../audit/index.js";
import { resolveSecretsDatabaseFilePath } from "../config.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../db/client.js";
import {
  loadSecretsKeyringFromEnv,
  resealSecretEnvelope,
  type SecretsKeyring,
} from "../keyring.js";
import {
  listAllSecretVersions,
  resealSecretVersion,
  type AllSecretVersionRow,
} from "../modules/secrets/store.js";

import { parseFlags, writeAtomically } from "./support.js";

const USAGE = ["Usage:", "  kek verify", "  kek rotate", "  kek generate [--version <n>]"].join(
  "\n",
);

export interface KekCliDeps {
  db: SecretsDatabaseInstance["db"];
  // Undefined only for `generate`, which never needs SECRETS_KEKS at all — see `main` below.
  keyring: SecretsKeyring | undefined;
  write: (line: string) => void;
}

function requireKeyring(deps: KekCliDeps): SecretsKeyring {
  if (deps.keyring === undefined) {
    throw new Error("SECRETS_KEKS must be set to run this command.");
  }

  return deps.keyring;
}

/**
 * The census this whole file works from comes from the envelope's own version field, never the
 * `kek_version` column — `SecretsKeyring#open` resolves the key the same way, so a census built
 * from the column could report zero rows on a retiring key while the envelopes are still sealed
 * under it, and an operator who trusted that report would then drop the only key that can open them.
 */
function parseEnvelopeVersion(envelope: string): number {
  const field = envelope.split(".")[1];
  const version = field === undefined ? NaN : Number(field);

  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(
      `Envelope has a malformed or missing KEK version field: ${JSON.stringify(envelope)}.`,
    );
  }

  return version;
}

function assertColumnMatchesEnvelope(row: AllSecretVersionRow, envelopeVersion: number): void {
  if (envelopeVersion !== row.kekVersion) {
    throw new Error(
      `Secret ${JSON.stringify(row.secretName)} version ${JSON.stringify(row.id)} has a kek_version ` +
        `column of ${String(row.kekVersion)} but its envelope is sealed under version ` +
        `${String(envelopeVersion)}. Refusing to trust either without investigation.`,
    );
  }
}

type RowVerificationStatus = "opened" | "not-in-ring" | "open-failed";

interface RowVerification {
  row: AllSecretVersionRow;
  envelopeVersion: number;
  status: RowVerificationStatus;
}

function verifyRow(keyring: SecretsKeyring, row: AllSecretVersionRow): RowVerification {
  const envelopeVersion = parseEnvelopeVersion(row.envelope);

  assertColumnMatchesEnvelope(row, envelopeVersion);

  if (!keyring.versions.includes(envelopeVersion)) {
    return { row, envelopeVersion, status: "not-in-ring" };
  }

  try {
    // Discarded without `.reveal()` — opening at all is the only thing this proves.
    keyring.open({ context: { name: row.secretName, versionId: row.id }, envelope: row.envelope });

    return { row, envelopeVersion, status: "opened" };
  } catch {
    return { row, envelopeVersion, status: "open-failed" };
  }
}

interface VerifyReport {
  ok: boolean;
  lines: string[];
  summary: string;
}

function buildVerifyReport(
  keyring: SecretsKeyring,
  rows: readonly AllSecretVersionRow[],
): VerifyReport {
  const results = rows.map((row) => verifyRow(keyring, row));

  const byVersion = new Map<number, RowVerification[]>();
  for (const result of results) {
    const bucket = byVersion.get(result.envelopeVersion);

    if (bucket === undefined) {
      byVersion.set(result.envelopeVersion, [result]);
    } else {
      bucket.push(result);
    }
  }

  const lines: string[] = [
    ["kek version", "rows", "live rows", "in ring", "opened", "failed"].join("\t"),
  ];

  for (const [version, group] of [...byVersion.entries()].sort((a, b) => a[0] - b[0])) {
    const opened = group.filter((result) => result.status === "opened").length;
    const liveRows = group.filter((result) => result.row.isLive).length;

    lines.push(
      [
        String(version),
        String(group.length),
        String(liveRows),
        keyring.versions.includes(version) ? "yes" : "no",
        String(opened),
        String(group.length - opened),
      ].join("\t"),
    );
  }

  const failedRows = results.filter((result) => result.status !== "opened");
  const outsideActive = results.filter(
    (result) => result.status === "opened" && result.envelopeVersion !== keyring.activeVersion,
  );
  const outsideVersions = [...new Set(outsideActive.map((result) => result.envelopeVersion))].sort(
    (a, b) => a - b,
  );

  let summary: string;

  if (failedRows.length > 0) {
    summary = `${String(failedRows.length)} row(s) could not be opened under a KEK in the ring.`;
  } else if (outsideVersions.length > 0) {
    summary =
      `${String(outsideActive.length)} row(s) are still sealed under version(s) ` +
      `${outsideVersions.join(", ")}; run \`kek rotate\`.`;
  } else {
    summary = `Every row is sealed under active version ${String(keyring.activeVersion)}.`;
  }

  lines.push(summary);

  return { ok: failedRows.length === 0 && outsideVersions.length === 0, lines, summary };
}

/**
 * The crypto result (every row opens under the key recorded for it) and the audit-write result
 * (the `kek.verified` row landed) are reported through separate throw paths — a busy audit insert
 * (measured: a competing `BEGIN IMMEDIATE` blocks the full 5000ms busy timeout and then throws)
 * must never read as "verification failed" to an operator deciding whether a restored key is right.
 */
function runVerify(deps: KekCliDeps): void {
  const keyring = requireKeyring(deps);
  const rows = listAllSecretVersions(deps.db);

  if (rows.length === 0) {
    // Not "a wrong path created a fresh empty store" — a fresh file has no tables at all, and the
    // select above would already have thrown `no such table: secret_versions`. This guards the
    // genuinely empty case: there is nothing here for this command to prove anything about.
    throw new Error("No sealed rows exist; this command cannot prove a key is correct.");
  }

  let verificationError: Error | undefined;
  let report: VerifyReport | undefined;

  try {
    report = buildVerifyReport(keyring, rows);
  } catch (error) {
    verificationError = error instanceof Error ? error : new Error(String(error));
  }

  if (report !== undefined) {
    for (const line of report.lines) {
      deps.write(line);
    }

    if (!report.ok) {
      verificationError = new Error(report.summary);
    }
  }

  let auditError: Error | undefined;

  try {
    recordAuditEntry(deps.db, {
      action: "kek.verified",
      actorKind: "host-cli",
      outcome: verificationError === undefined ? "success" : "failure",
    });
  } catch (error) {
    auditError = error instanceof Error ? error : new Error(String(error));
  }

  if (verificationError !== undefined) {
    throw verificationError;
  }

  if (auditError !== undefined) {
    throw new Error(
      "Every row opened under its recorded key, but the kek.verified audit row could not be " +
        `written: ${auditError.message}`,
    );
  }
}

function runRotate(deps: KekCliDeps): void {
  const keyring = requireKeyring(deps);

  if (keyring.versions.length === 1) {
    throw new Error(
      "SECRETS_KEKS carries only one version; there is nothing to rotate to. Add the new " +
        "version and redeploy before running `kek rotate` — running it now would re-seal every " +
        "row under the key it is already sealed under.",
    );
  }

  const rows = listAllSecretVersions(deps.db);
  const activeVersion = keyring.activeVersion;

  const censused = rows.map((row) => {
    const envelopeVersion = parseEnvelopeVersion(row.envelope);

    assertColumnMatchesEnvelope(row, envelopeVersion);

    return { row, envelopeVersion };
  });

  const versionCounts = new Map<number, number>();
  for (const entry of censused) {
    versionCounts.set(entry.envelopeVersion, (versionCounts.get(entry.envelopeVersion) ?? 0) + 1);
  }

  deps.write(`${String(rows.length)} row(s) total, by KEK version:`);
  for (const [version, count] of [...versionCounts.entries()].sort((a, b) => a[0] - b[0])) {
    deps.write(`  version ${String(version)}: ${String(count)} row(s)`);
  }

  const missing = censused.filter((entry) => !keyring.versions.includes(entry.envelopeVersion));

  if (missing.length > 0) {
    const missingVersions = [...new Set(missing.map((entry) => entry.envelopeVersion))].sort(
      (a, b) => a - b,
    );

    throw new Error(
      `${String(missing.length)} row(s) are sealed under version(s) ${missingVersions.join(", ")}, ` +
        "which SECRETS_KEKS does not carry. Refusing to start: rotating without every existing " +
        "key present would strand those rows unreadable. Add the missing version(s) back to " +
        "SECRETS_KEKS first.",
    );
  }

  const pending = censused.filter((entry) => entry.envelopeVersion !== activeVersion);

  if (pending.length === 0) {
    deps.write(`Every row is already sealed under version ${String(activeVersion)}.`);

    return;
  }

  let resealedCount = 0;

  for (const entry of pending) {
    const { row } = entry;
    const context = { name: row.secretName, versionId: row.id };

    try {
      writeAtomically(deps.db, (tx) => {
        const resealed = resealSecretEnvelope(keyring, context, row.envelope);

        // Round-trips the freshly sealed envelope before it is trusted — if this throws, the
        // transaction below never runs and nothing commits.
        keyring.open({ context, envelope: resealed.envelope });

        resealSecretVersion(tx, {
          id: row.id,
          envelope: resealed.envelope,
          kekVersion: resealed.kekVersion,
        });

        recordAuditEntry(tx, {
          action: "secret.resealed",
          actorKind: "host-cli",
          outcome: "success",
          secretName: row.secretName,
          secretVersionId: row.id,
        });
      });

      resealedCount += 1;
      deps.write(`re-sealed ${row.secretName} (${row.id}) under version ${String(activeVersion)}`);
    } catch (error) {
      // Same rule as `src/modules/secrets/index.ts`'s denial audit rows: written outside the
      // transaction that failed, so it survives the rollback.
      recordAuditEntry(deps.db, {
        action: "secret.resealed",
        actorKind: "host-cli",
        outcome: "failure",
        secretName: row.secretName,
        secretVersionId: row.id,
      });

      throw error;
    }
  }

  deps.write(
    `Re-sealed ${String(resealedCount)} of ${String(pending.length)} row(s) under version ` +
      `${String(activeVersion)}.`,
  );
}

function runGenerate(argv: readonly string[], deps: KekCliDeps): void {
  const flags = parseFlags(argv, ["--version"], USAGE);
  const versionFlag = flags.get("--version");

  let version: number;

  if (versionFlag === undefined) {
    version = deps.keyring === undefined ? 1 : deps.keyring.activeVersion + 1;
  } else {
    version = Number(versionFlag);

    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`--version must be a positive integer.\n\n${USAGE}`);
    }
  }

  const key = randomBytes(32).toString("base64");

  // Only the new entry — never the existing ring. Printing the ring back is `kek export` by
  // another name, and that command was deliberately not built.
  deps.write(`${String(version)}:${key}`);
  deps.write("");
  deps.write(
    "Prepend this entry to the existing SECRETS_KEKS value (this entry first, comma-separated) " +
      "so it becomes the active key on the next redeploy. This is the only copy printed.",
  );
}

/**
 * Throws on anything it cannot do; {@link main} is what turns that into an exit code. Takes its
 * database, keyring and output sink as arguments so the tests drive the shipped code path rather
 * than a copy of it.
 */
export function runKekCli(argv: readonly string[], deps: KekCliDeps): void {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case "verify":
      parseFlags(rest, [], USAGE);
      runVerify(deps);

      return;
    case "rotate":
      parseFlags(rest, [], USAGE);
      runRotate(deps);

      return;
    case "generate":
      runGenerate(rest, deps);

      return;
    default:
      throw new Error(`Unknown subcommand ${JSON.stringify(subcommand ?? "")}.\n\n${USAGE}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const instance = createSecretsDatabase({ filePath: resolveSecretsDatabaseFilePath() });

  try {
    runKekCli(argv, {
      db: instance.db,
      // `generate` is the one subcommand that never needs SECRETS_KEKS — see `KekCliDeps`.
      keyring: argv[0] === "generate" ? undefined : loadSecretsKeyringFromEnv(),
      write: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    instance.client.close();
  }
}

// Guarded so `test/module-graph.test.ts` can import this module — and so the coverage denominator
// keeps it — without opening a database.
if (import.meta.main) {
  main();
}
