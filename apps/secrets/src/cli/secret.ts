// Host-local, same bar as service-token.ts and kek.ts: `docker exec` plus the container's own
// SECRETS_KEKS. `read` is the audited escape hatch that prints one live value — not a bypass of
// "no read-back route reachable by a manage token" (apps/secrets/AGENTS.md §1), because it needs
// host access in addition to a service token, and it writes the same secret.read audit row the
// GET /secrets/value route does.
import { recordAuditEntry } from "../audit/index.js";
import { resolveSecretsDatabaseFilePath } from "../config.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../db/client.js";
import { loadSecretsKeyringFromEnv, openSecretPlaintext, type SecretsKeyring } from "../keyring.js";
import { getLiveSecretVersion } from "../modules/secrets/store.js";

import { ignoreEpipeOnStdout, parseFlags, recordAuditEntrySafely, requireFlag } from "./support.js";

const USAGE = ["Usage:", "  secret read --name <secret-name>"].join("\n");

export interface SecretCliDeps {
  db: SecretsDatabaseInstance["db"];
  keyring: SecretsKeyring;
  write: (line: string) => void;
}

/**
 * Records the `secret.read` audit row and only then prints the value — never the reverse. If the
 * audit insert throws, `deps.write` is never reached: an unaudited disclosure is worse than a
 * failed command.
 */
function runRead(argv: readonly string[], deps: SecretCliDeps): void {
  const flags = parseFlags(argv, ["--name"], USAGE);
  const name = requireFlag(flags, "--name", USAGE);

  const live = getLiveSecretVersion(deps.db, name);

  if (live === undefined) {
    const error = new Error(`No live secret named ${JSON.stringify(name)}.`);

    recordAuditEntrySafely(
      () => {
        recordAuditEntry(deps.db, {
          action: "secret.read",
          actorKind: "host-cli",
          outcome: "failure",
          secretName: name,
        });
      },
      error,
      "secret.read failure",
    );

    throw error;
  }

  let value: string;

  try {
    value = openSecretPlaintext(deps.keyring, { name, versionId: live.versionId }, live.envelope);
  } catch (error) {
    recordAuditEntrySafely(
      () => {
        recordAuditEntry(deps.db, {
          action: "secret.read",
          actorKind: "host-cli",
          outcome: "failure",
          secretName: name,
          secretVersionId: live.versionId,
        });
      },
      error,
      "secret.read failure",
    );

    throw error;
  }

  recordAuditEntry(deps.db, {
    action: "secret.read",
    actorKind: "host-cli",
    outcome: "success",
    secretName: name,
    secretVersionId: live.versionId,
  });

  deps.write(value);
}

/**
 * Throws on anything it cannot do; {@link main} is what turns that into an exit code. Takes its
 * database, keyring and output sink as arguments so the tests drive the shipped code path rather
 * than a copy of it.
 */
export function runSecretCli(argv: readonly string[], deps: SecretCliDeps): void {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case "read":
      runRead(rest, deps);

      return;
    default:
      throw new Error(`Unknown subcommand ${JSON.stringify(subcommand ?? "")}.\n\n${USAGE}`);
  }
}

function main(): void {
  const instance = createSecretsDatabase({ filePath: resolveSecretsDatabaseFilePath() });

  ignoreEpipeOnStdout();

  try {
    runSecretCli(process.argv.slice(2), {
      db: instance.db,
      keyring: loadSecretsKeyringFromEnv(),
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
