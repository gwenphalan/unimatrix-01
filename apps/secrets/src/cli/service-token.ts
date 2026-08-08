// Issuance is a host-local CLI rather than a route, and stays one. A minting
// route needs a credential to protect it, which is the bootstrap problem, and
// it would be the highest-value target this service could expose. `docker exec`
// sets the same bar the read CLI will: host access.
//
// It reads `resolveSecretsDatabaseFilePath` rather than
// `loadSecretsRuntimeConfig`, which hard-requires `SECRETS_KEKS`. Minting a
// credential and decrypting a value are separate capabilities, and this side
// never needs the KEK.
//
// It also lives under `src/` rather than `scripts/`: `tsconfig.build.json`
// excludes `scripts/`, and the production image ships built output with `tsx`
// absent, so a CLI there could not run in the container at all.
import { recordAuditEntry } from "../audit/index.js";
import { resolveSecretsDatabaseFilePath } from "../config.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../db/client.js";
import {
  isServiceTokenCapability,
  issueServiceToken,
  listServiceTokens,
  revokeServiceToken,
} from "../service-tokens/index.js";

const USAGE = [
  "Usage:",
  "  service-token issue --name <name> --scope <secret-name-prefix> --capability <read|manage>",
  "  service-token revoke --name <name>",
  "  service-token list",
].join("\n");

export interface ServiceTokenCliDeps {
  db: SecretsDatabaseInstance["db"];
  write: (line: string) => void;
}

function readFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}

function requireFlag(argv: readonly string[], flag: string): string {
  const value = readFlag(argv, flag);

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} is required.\n\n${USAGE}`);
  }

  return value;
}

function runIssue(argv: readonly string[], deps: ServiceTokenCliDeps): void {
  const capability = requireFlag(argv, "--capability");

  // No default. Defaulting either way silently mints the wrong kind of
  // credential, and the two are mutually exclusive by design.
  if (!isServiceTokenCapability(capability)) {
    throw new Error(`--capability must be read or manage.\n\n${USAGE}`);
  }

  const issued = issueServiceToken(deps.db, {
    name: requireFlag(argv, "--name"),
    scopePrefix: requireFlag(argv, "--scope"),
    capability,
  });

  recordAuditEntry(deps.db, {
    action: "service_token.issued",
    actorKind: "host-cli",
    outcome: "success",
    serviceTokenId: issued.record.id,
  });

  deps.write(`Issued service token ${JSON.stringify(issued.record.name)}.`);
  deps.write(`  scope:      ${issued.record.scopePrefix}`);
  deps.write(`  capability: ${issued.record.capability}`);
  deps.write(`  token:      ${issued.token}`);
  deps.write("");
  deps.write("Shown once. Only its digest is stored, so this value cannot be recovered.");
}

function runRevoke(argv: readonly string[], deps: ServiceTokenCliDeps): void {
  const name = requireFlag(argv, "--name");
  const revoked = revokeServiceToken(deps.db, name);

  if (revoked === null) {
    throw new Error(`No active service token named ${JSON.stringify(name)}.`);
  }

  recordAuditEntry(deps.db, {
    action: "service_token.revoked",
    actorKind: "host-cli",
    outcome: "success",
    serviceTokenId: revoked.id,
  });

  deps.write(`Revoked service token ${JSON.stringify(revoked.name)}.`);
}

function runList(deps: ServiceTokenCliDeps): void {
  const tokens = listServiceTokens(deps.db);

  if (tokens.length === 0) {
    deps.write("No service tokens.");

    return;
  }

  deps.write(["name", "capability", "scope", "created", "last used", "revoked"].join("\t"));

  for (const token of tokens) {
    deps.write(
      [
        token.name,
        token.capability,
        token.scopePrefix,
        token.createdAt,
        token.lastUsedAt ?? "never",
        token.revokedAt ?? "-",
      ].join("\t"),
    );
  }
}

/**
 * Throws on anything it cannot do; {@link main} is what turns that into an exit
 * code. Takes its database and output sink as arguments so the tests drive the
 * shipped code path rather than a copy of it.
 */
export function runServiceTokenCli(argv: readonly string[], deps: ServiceTokenCliDeps): void {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case "issue":
      runIssue(rest, deps);

      return;
    case "revoke":
      runRevoke(rest, deps);

      return;
    case "list":
      runList(deps);

      return;
    default:
      throw new Error(`Unknown subcommand ${JSON.stringify(subcommand ?? "")}.\n\n${USAGE}`);
  }
}

function main(): void {
  const instance = createSecretsDatabase({ filePath: resolveSecretsDatabaseFilePath() });

  try {
    runServiceTokenCli(process.argv.slice(2), {
      db: instance.db,
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

// Guarded so `test/module-graph.test.ts` can import this module — and so the
// coverage denominator keeps it — without opening a database.
if (import.meta.main) {
  main();
}
