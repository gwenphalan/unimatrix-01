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
