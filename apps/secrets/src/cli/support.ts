import type { SecretsDatabaseInstance, SecretsDatabaseWriter } from "../db/client.js";

/**
 * Runs a mutation and the audit row that records it as one transaction — shared by every CLI
 * under `src/cli/`. Synchronous on purpose: `better-sqlite3` is a synchronous driver, so no other
 * JavaScript can interleave between the two writes — an `async` callback would hand control back
 * to the event loop mid-transaction. `behavior: "immediate"` takes the write lock up front, rather
 * than on the transaction's first statement, matching `apps/api/src/modules/user-data/store.ts`.
 *
 * This is not a consolidation of `writeAtomically` in `../modules/secrets/index.ts` — that copy
 * takes the Fastify `app`, not `db`, and stays separate.
 */
export function writeAtomically<T>(
  db: SecretsDatabaseInstance["db"],
  write: (tx: SecretsDatabaseWriter) => T,
): T {
  return db.transaction(write, { behavior: "immediate" });
}

/**
 * Consumes exactly the flags a subcommand supports, and refuses anything else. A CLI that mints a
 * credential or handles key material must not run on arguments it did not understand: a misspelt
 * flag would otherwise fall through to whatever default the intended flag would have set, and say
 * nothing about it.
 */
export function parseFlags(
  argv: readonly string[],
  supported: readonly string[],
  usage: string,
): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? "";

    if (!supported.includes(flag)) {
      throw new Error(`Unknown argument ${JSON.stringify(flag)}.\n\n${usage}`);
    }

    if (values.has(flag)) {
      throw new Error(`${flag} was given more than once.\n\n${usage}`);
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} is required.\n\n${usage}`);
    }

    values.set(flag, value);
  }

  return values;
}

export function requireFlag(
  values: ReadonlyMap<string, string>,
  flag: string,
  usage: string,
): string {
  const value = values.get(flag);

  if (value === undefined) {
    throw new Error(`${flag} is required.\n\n${usage}`);
  }

  return value;
}

/** Parses a flag's value as a positive integer, same usage-string shape as every other flag failure. */
export function parsePositiveIntFlag(value: string, flag: string, usage: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.\n\n${usage}`);
  }

  return parsed;
}

/**
 * Records an audit row and folds any failure to write it into `error`'s own message instead of
 * letting it replace the error already in flight — the rule every audit-then-throw site under
 * `src/cli/` follows: a busy audit insert (a competing `BEGIN IMMEDIATE` can block the full busy
 * timeout and then throw) must never read as the operation itself having failed, or stand in for
 * the error that prompted it.
 */
export function recordAuditEntrySafely(
  record: () => void,
  error: unknown,
  auditDescription: string,
): void {
  try {
    record();
  } catch (auditError) {
    if (error instanceof Error) {
      const message = auditError instanceof Error ? auditError.message : String(auditError);

      error.message += ` (additionally, the ${auditDescription} audit row could not be written: ${message})`;
    }
  }
}

/**
 * `process.stdout` is a stream — when a pipe's reader closes early (`generate | head -1` in
 * `README.md`'s dev bootstrap), the next write emits an `error` event with `code: "EPIPE"`, and
 * Node crashes with an unhandled-error stack trace if nothing is listening (measured). The write
 * already reached the reader before it closed, so there is nothing left to report; every other
 * write error still throws.
 */
export function ignoreEpipeOnStdout(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      throw error;
    }
  });
}
