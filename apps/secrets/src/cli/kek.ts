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
  SecretsError,
  type SecretsKeyring,
} from "../keyring.js";
import {
  listAllSecretVersions,
  resealSecretVersion,
  type AllSecretVersionRow,
} from "../modules/secrets/store.js";

import {
  ignoreEpipeOnStdout,
  parseFlags,
  parsePositiveIntFlag,
  recordAuditEntrySafely,
  requireFlag,
  writeAtomically,
} from "./support.js";

const USAGE = [
  "Usage:",
  "  kek verify --expect-active <n>",
  "  kek rotate --to-version <n>",
  "  kek generate [--version <n>]",
].join("\n");

// `SECRETS_KEKS`'s own entry pattern (`packages/secrets/src/keyring.ts`) accepts 1-9999 and
// refuses a duplicate version; `generate` mints entries that ring loader will actually accept —
// see `runGenerate`.
const KEK_MAX_VERSION = 9999;

export interface KekCliDeps {
  db: SecretsDatabaseInstance["db"];
  // Undefined only when `generate` runs with no usable SECRETS_KEKS — see `loadKeyringForMain` below.
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
 * Names the row rather than the envelope in its error — the envelope carries the IV, ciphertext and
 * tag, and none of those belong in a message (same rule `packages/secrets/AGENTS.md` §5 states for
 * that package).
 */
function parseEnvelopeVersion(row: AllSecretVersionRow): number {
  const field = row.envelope.split(".")[1];
  const version = field === undefined ? NaN : Number(field);

  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(
      `Secret ${JSON.stringify(row.secretName)} version ${JSON.stringify(row.id)} has a ` +
        "malformed or missing KEK version field in its envelope.",
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

/** Never a plaintext or a ciphertext field — `SecretsError#message` never carries either (see `packages/secrets/AGENTS.md` §5), and this only ever reads that message or wraps a row identity. */
function describeOpenFailure(error: unknown): string {
  if (error instanceof SecretsError) {
    return `${error.code}: ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

type RowVerificationStatus = "opened" | "not-in-ring" | "column-mismatch" | "open-failed";

interface RowVerification {
  row: AllSecretVersionRow;
  envelopeVersion: number;
  status: RowVerificationStatus;
  /** Set on every status but `"opened"` — never a plaintext or a ciphertext, see `describeOpenFailure`. */
  reason?: string;
}

function verifyRow(keyring: SecretsKeyring, row: AllSecretVersionRow): RowVerification {
  const envelopeVersion = parseEnvelopeVersion(row);

  if (envelopeVersion !== row.kekVersion) {
    return {
      row,
      envelopeVersion,
      status: "column-mismatch",
      reason:
        `kek_version column is ${String(row.kekVersion)} but the envelope is sealed under ` +
        `version ${String(envelopeVersion)}`,
    };
  }

  if (!keyring.versions.includes(envelopeVersion)) {
    return {
      row,
      envelopeVersion,
      status: "not-in-ring",
      reason: `version ${String(envelopeVersion)} is not in SECRETS_KEKS`,
    };
  }

  try {
    // Discarded without `.reveal()` — opening at all is the only thing this proves.
    keyring.open({ context: { name: row.secretName, versionId: row.id }, envelope: row.envelope });

    return { row, envelopeVersion, status: "opened" };
  } catch (error) {
    return { row, envelopeVersion, status: "open-failed", reason: describeOpenFailure(error) };
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

  // Named per row — a version-level count says nothing about which secret is actually wrong, and
  // the wrong answer here ("the ring is bad") can cost a correct restored key its only defender.
  for (const result of failedRows) {
    lines.push(`  ${result.row.secretName} (${result.row.id}): ${result.reason ?? result.status}`);
  }

  const outsideActive = results.filter(
    (result) => result.status === "opened" && result.envelopeVersion !== keyring.activeVersion,
  );
  const outsideVersions = [...new Set(outsideActive.map((result) => result.envelopeVersion))].sort(
    (a, b) => a - b,
  );

  // A mismatch says nothing about whether the row opens — it may open fine — so it gets its own
  // clause rather than folding into "could not be opened", which points the operator at the key
  // for a problem that is not the key's.
  const mismatchRows = failedRows.filter((result) => result.status === "column-mismatch");
  const unopenableRows = failedRows.filter((result) => result.status !== "column-mismatch");

  const summaryClauses: string[] = [];

  if (unopenableRows.length > 0) {
    summaryClauses.push(
      `${String(unopenableRows.length)} row(s) could not be opened under a KEK in the ring.`,
    );
  }

  if (mismatchRows.length > 0) {
    summaryClauses.push(
      `${String(mismatchRows.length)} row(s) have a kek_version column that disagrees with their ` +
        "envelope's own version field.",
    );
  }

  if (summaryClauses.length === 0 && outsideVersions.length > 0) {
    summaryClauses.push(
      `${String(outsideActive.length)} row(s) are still sealed under version(s) ` +
        `${outsideVersions.join(", ")}; run \`kek rotate\`.`,
    );
  }

  if (summaryClauses.length === 0) {
    summaryClauses.push(
      `Every row is sealed under active version ${String(keyring.activeVersion)}.`,
    );
  }

  const summary = summaryClauses.join(" ");

  lines.push(summary);

  return { ok: failedRows.length === 0 && outsideVersions.length === 0, lines, summary };
}

/**
 * Prints `report.lines` (if any), records the `kek.verified` row, and turns the two outcomes
 * (verification, audit write) into stdout and the throw. Whichever of the two failed, the last
 * line written to stdout starts `NOT VERIFIED` — the crypto result and the audit-write result are
 * reported through separate throw paths (a busy audit insert, measured to block the full 5000ms
 * busy timeout before throwing, must never read as "verification failed" to an operator deciding
 * whether a restored key is right), but neither may leave stdout's last line reading as success on
 * a non-zero exit.
 */
function finalizeVerify(
  deps: KekCliDeps,
  report: VerifyReport | undefined,
  verificationError: Error | undefined,
): void {
  if (report !== undefined) {
    for (const line of report.lines) {
      deps.write(line);
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
    if (auditError !== undefined) {
      deps.write(
        `NOT VERIFIED — ${verificationError.message} (additionally, the kek.verified audit row ` +
          `could not be written: ${auditError.message})`,
      );
    } else {
      deps.write(`NOT VERIFIED — ${verificationError.message}`);
    }

    throw verificationError;
  }

  if (auditError !== undefined) {
    const message =
      "Every row opened under its recorded key, but the kek.verified audit row could not be " +
      `written: ${auditError.message}`;

    deps.write(`NOT VERIFIED — ${message}`);

    throw new Error(message);
  }
}

function runVerify(deps: KekCliDeps, expectActive: number): void {
  const keyring = requireKeyring(deps);

  if (keyring.activeVersion !== expectActive) {
    // Routed through `finalizeVerify` rather than a bare throw: a run against a stale ring is
    // exactly the operator mistake `--expect-active` exists to catch, and every other terminating
    // path out of `verify` records a `kek.verified` row — this one must too.
    finalizeVerify(
      deps,
      undefined,
      new Error(
        `SECRETS_KEKS's active version is ${String(keyring.activeVersion)}, not the ` +
          `${String(expectActive)} you expected.\nRefusing to certify.`,
      ),
    );

    return;
  }

  const rows = listAllSecretVersions(deps.db);

  if (rows.length === 0) {
    // Not "a wrong path created a fresh empty store" — a fresh file has no tables at all, and the
    // select above would already have thrown `no such table: secret_versions`. This guards the
    // genuinely empty case: there is nothing here for this command to prove anything about.
    finalizeVerify(
      deps,
      undefined,
      new Error("No sealed rows exist; this command cannot prove a key is correct."),
    );

    return;
  }

  let verificationError: Error | undefined;
  let report: VerifyReport | undefined;

  try {
    report = buildVerifyReport(keyring, rows);
  } catch (error) {
    verificationError = error instanceof Error ? error : new Error(String(error));
  }

  if (report !== undefined && !report.ok) {
    verificationError = new Error(report.summary);
  }

  finalizeVerify(deps, report, verificationError);
}

/** Records `kek.rotated`/failure and throws — the shared shape of rotate's three whole-run refusals. */
function refuseRotateRun(deps: KekCliDeps, message: string): never {
  const error = new Error(message);

  recordAuditEntrySafely(
    () => {
      recordAuditEntry(deps.db, {
        action: "kek.rotated",
        actorKind: "host-cli",
        outcome: "failure",
      });
    },
    error,
    "kek.rotated failure",
  );

  throw error;
}

/** Records `kek.rotated`/success once the run (a no-op or a completed reseal) is actually done. */
function recordRotateSuccess(deps: KekCliDeps, resealedCount: number): void {
  try {
    recordAuditEntry(deps.db, { action: "kek.rotated", actorKind: "host-cli", outcome: "success" });
  } catch (auditError) {
    const message = auditError instanceof Error ? auditError.message : String(auditError);

    throw new Error(
      `Re-sealed ${String(resealedCount)} row(s), but the kek.rotated audit row could not be ` +
        `written: ${message}`,
      { cause: auditError },
    );
  }
}

function runRotate(deps: KekCliDeps, toVersion: number): void {
  const keyring = requireKeyring(deps);

  if (keyring.activeVersion !== toVersion) {
    refuseRotateRun(
      deps,
      `SECRETS_KEKS's active version is ${String(keyring.activeVersion)}, not the ` +
        `${String(toVersion)} you asked for. The redeploy that adds version ` +
        `${String(toVersion)} has not taken effect in this container. Refusing to rotate.`,
    );
  }

  if (keyring.versions.length === 1) {
    refuseRotateRun(
      deps,
      "SECRETS_KEKS carries only one version; there is nothing to rotate to. Add the new " +
        "version and redeploy before running `kek rotate` — running it now would re-seal every " +
        "row under the key it is already sealed under.",
    );
  }

  const rows = listAllSecretVersions(deps.db);
  const activeVersion = keyring.activeVersion;

  let censused: { row: AllSecretVersionRow; envelopeVersion: number }[];

  try {
    censused = rows.map((row) => {
      const envelopeVersion = parseEnvelopeVersion(row);

      assertColumnMatchesEnvelope(row, envelopeVersion);

      return { row, envelopeVersion };
    });
  } catch (error) {
    // Same terminating-path rule as the two whole-run refusals above: a malformed envelope version
    // or a kek_version/envelope disagreement is exactly the state an operator reconstructs from the
    // audit log afterwards, so this throw must record `kek.rotated`/failure too, not bypass it.
    refuseRotateRun(deps, error instanceof Error ? error.message : String(error));
  }

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

    refuseRotateRun(
      deps,
      `${String(missing.length)} row(s) are sealed under version(s) ${missingVersions.join(", ")}, ` +
        "which SECRETS_KEKS does not carry. Refusing to start: rotating without every existing " +
        "key present would strand those rows unreadable. Add the missing version(s) back to " +
        "SECRETS_KEKS first.",
    );
  }

  const pending = censused.filter((entry) => entry.envelopeVersion !== activeVersion);

  if (pending.length === 0) {
    // Deliberately not symmetric with `verify`'s "No sealed rows exist" refusal on an empty store:
    // rotate's job is to act on whatever exists, and zero rows needing a reseal — whether because
    // the store is empty or because every row is already on the active version — is a legitimate
    // "nothing to do", not a case that needs a human to look. `verify`'s job is to certify a key is
    // correct, and an empty store proves nothing about that no matter how the command exits.
    deps.write(`Every row is already sealed under version ${String(activeVersion)}.`);
    recordRotateSuccess(deps, 0);

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
      // transaction that failed, so it survives the rollback. Guarded on its own: the reseal
      // failure is what the operator needs to diagnose, and a busy audit insert (verify hits the
      // same failure mode) must never replace it as the error that reaches them — so `wrapped`,
      // not the audit write's own error, is always what gets rethrown below.
      const wrapped = error instanceof Error ? error : new Error(String(error));

      wrapped.message = `Failed to re-seal ${row.secretName} (${row.id}): ${wrapped.message}`;

      recordAuditEntrySafely(
        () => {
          recordAuditEntry(deps.db, {
            action: "secret.resealed",
            actorKind: "host-cli",
            outcome: "failure",
            secretName: row.secretName,
            secretVersionId: row.id,
          });
        },
        wrapped,
        "secret.resealed failure",
      );

      throw wrapped;
    }
  }

  deps.write(
    `Re-sealed ${String(resealedCount)} of ${String(pending.length)} row(s) under version ` +
      `${String(activeVersion)}.`,
  );
  recordRotateSuccess(deps, resealedCount);
}

function runGenerate(argv: readonly string[], deps: KekCliDeps): void {
  const flags = parseFlags(argv, ["--version"], USAGE);
  const versionFlag = flags.get("--version");

  let version: number;

  if (versionFlag === undefined) {
    version = deps.keyring === undefined ? 1 : deps.keyring.activeVersion + 1;
  } else {
    version = parsePositiveIntFlag(versionFlag, "--version", USAGE);
  }

  if (version > KEK_MAX_VERSION) {
    throw new Error(
      `--version must be ${String(KEK_MAX_VERSION)} or lower — SECRETS_KEKS entries above that ` +
        `are rejected on load.\n\n${USAGE}`,
    );
  }

  if (deps.keyring !== undefined) {
    if (deps.keyring.versions.includes(version)) {
      throw new Error(
        `Version ${String(version)} is already in SECRETS_KEKS; generating it would mint a ` +
          "duplicate that the ring loader refuses on the next redeploy.",
      );
    }

    if (version <= deps.keyring.activeVersion) {
      throw new Error(
        `Version ${String(version)} is not greater than the active version ` +
          `${String(deps.keyring.activeVersion)} — SECRETS_KEKS requires the active (first-listed) ` +
          "entry to be the highest version present.",
      );
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

  // Best-effort: the fresh-bootstrap case this command exists for (see `loadKeyringForMain`) can
  // run before the database has ever been migrated, so `secret_audit_log` may not exist yet — that
  // must never turn "mint a key" into "mint a key, unless the schema isn't there yet". A recovery
  // run against a booted service's volume, where the table does exist, still gets its row.
  try {
    recordAuditEntry(deps.db, {
      action: "kek.generated",
      actorKind: "host-cli",
      outcome: "success",
    });
  } catch {
    // Swallowed deliberately — see comment above.
  }
}

/**
 * Throws on anything it cannot do; {@link main} is what turns that into an exit code. Takes its
 * database, keyring and output sink as arguments so the tests drive the shipped code path rather
 * than a copy of it.
 */
export function runKekCli(argv: readonly string[], deps: KekCliDeps): void {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case "verify": {
      const flags = parseFlags(rest, ["--expect-active"], USAGE);
      const expectActive = parsePositiveIntFlag(
        requireFlag(flags, "--expect-active", USAGE),
        "--expect-active",
        USAGE,
      );

      runVerify(deps, expectActive);

      return;
    }
    case "rotate": {
      const flags = parseFlags(rest, ["--to-version"], USAGE);
      const toVersion = parsePositiveIntFlag(
        requireFlag(flags, "--to-version", USAGE),
        "--to-version",
        USAGE,
      );

      runRotate(deps, toVersion);

      return;
    }
    case "generate":
      runGenerate(rest, deps);

      return;
    default:
      throw new Error(`Unknown subcommand ${JSON.stringify(subcommand ?? "")}.\n\n${USAGE}`);
  }
}

/**
 * `generate` is the only subcommand that can run without a usable `SECRETS_KEKS` at all — the
 * fresh local-dev bootstrap case `README.md` documents, where there is no ring yet to default
 * `--version` from, and the recovery case `docs/deployment.md` documents, where the ring is set but
 * unparsable and `generate` is the one command that can still mint a way out. Whenever the variable
 * *is* set and readable, `generate` loads it too, so its default (`activeVersion + 1`) is the next
 * real version rather than always falling back to 1, and so `runGenerate` can refuse a duplicate or
 * an out-of-order version — the rotation runbook in `docs/deployment.md` runs `generate` against an
 * already-booted service, where `SECRETS_KEKS` is always set and almost always readable.
 */
function isSecretsKeksSet(): boolean {
  return (process.env.SECRETS_KEKS ?? "").trim().length > 0;
}

function loadKeyringForMain(argv: readonly string[]): SecretsKeyring | undefined {
  if (argv[0] !== "generate") {
    return loadSecretsKeyringFromEnv();
  }

  if (!isSecretsKeksSet()) {
    return undefined;
  }

  try {
    return loadSecretsKeyringFromEnv();
  } catch (error) {
    // SECRETS_KEKS is set but unreadable — exactly the state `docs/deployment.md`'s recovery
    // section exists for. `generate` can still mint a replacement key with no ring loaded; say so
    // on stderr rather than refusing the one command that gets the operator out, but never silently
    // skip the duplicate/ordering checks a loaded ring does support.
    process.stderr.write(
      `SECRETS_KEKS could not be read (${error instanceof Error ? error.message : String(error)}); ` +
        "generating without checking it for duplicates or version ordering.\n",
    );

    return undefined;
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const instance = createSecretsDatabase({ filePath: resolveSecretsDatabaseFilePath() });

  ignoreEpipeOnStdout();

  try {
    runKekCli(argv, {
      db: instance.db,
      keyring: loadKeyringForMain(argv),
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
