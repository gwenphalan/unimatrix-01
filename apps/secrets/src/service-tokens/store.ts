import { randomUUID } from "node:crypto";

import { secretNameSchema } from "@unimatrix/shared";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { SecretsDatabaseInstance } from "../db/client.js";
import { serviceTokensTable } from "../db/schema/index.js";

import { isServiceTokenCapability, type ServiceTokenCapability } from "./capability.js";
import { generateServiceToken, hashServiceToken, isServiceTokenShape } from "./format.js";

type SecretsDatabase = SecretsDatabaseInstance["db"];

/**
 * A token is named for the consumer that holds it (`api`, `deploy-worker`), so
 * this is a flat identifier rather than `secretNameSchema` — a token called
 * `github/api-token` would read as a scope.
 */
const SERVICE_TOKEN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/**
 * Every column except `token_hash`. Nothing outside this module reads the
 * digest, and a shape that cannot carry it cannot leak it into a log line or a
 * CLI listing.
 */
const serviceTokenSummaryColumns = {
  id: serviceTokensTable.id,
  name: serviceTokensTable.name,
  scopePrefix: serviceTokensTable.scopePrefix,
  capability: serviceTokensTable.capability,
  createdAt: serviceTokensTable.createdAt,
  lastUsedAt: serviceTokensTable.lastUsedAt,
  revokedAt: serviceTokensTable.revokedAt,
};

export interface ServiceTokenSummary {
  id: string;
  name: string;
  scopePrefix: string;
  capability: ServiceTokenCapability;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface IssueServiceTokenOptions {
  name: string;
  scopePrefix: string;
  capability: ServiceTokenCapability;
}

export interface IssuedServiceToken {
  /** Shown once, by the caller that asked for it. Only the digest is stored. */
  token: string;
  record: ServiceTokenSummary;
}

function createServiceTokenError(message: string): Error {
  return new Error(`Cannot issue service token: ${message}`);
}

export function issueServiceToken(
  db: SecretsDatabase,
  options: IssueServiceTokenOptions,
): IssuedServiceToken {
  const name = options.name.trim();

  if (!SERVICE_TOKEN_NAME_PATTERN.test(name)) {
    throw createServiceTokenError(
      `name must match ${String(SERVICE_TOKEN_NAME_PATTERN.source)}. Received ${JSON.stringify(options.name)}.`,
    );
  }

  if (!isServiceTokenCapability(options.capability)) {
    throw createServiceTokenError(
      `capability must be read or manage. Received ${JSON.stringify(options.capability)}.`,
    );
  }

  const scopePrefix = secretNameSchema.safeParse(options.scopePrefix.trim());

  if (!scopePrefix.success) {
    throw createServiceTokenError(
      `scope must be a valid secret name prefix. Received ${JSON.stringify(options.scopePrefix)}.`,
    );
  }

  const existing = db
    .select({ id: serviceTokensTable.id })
    .from(serviceTokensTable)
    .where(eq(serviceTokensTable.name, name))
    .get();

  if (existing !== undefined) {
    throw createServiceTokenError(`a token named ${JSON.stringify(name)} already exists.`);
  }

  const token = generateServiceToken();
  const record = db
    .insert(serviceTokensTable)
    .values({
      id: randomUUID(),
      name,
      tokenHash: hashServiceToken(token),
      scopePrefix: scopePrefix.data,
      capability: options.capability,
    })
    .returning(serviceTokenSummaryColumns)
    .get();

  return { token, record };
}

/** Returns the revoked row, or `null` when no *active* token carries that name. */
export function revokeServiceToken(db: SecretsDatabase, name: string): ServiceTokenSummary | null {
  const record = db
    .update(serviceTokensTable)
    .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(serviceTokensTable.name, name), isNull(serviceTokensTable.revokedAt)))
    .returning(serviceTokenSummaryColumns)
    .get();

  return record ?? null;
}

/** Revoked tokens included: a revocation nobody can see is a revocation nobody can audit. */
export function listServiceTokens(db: SecretsDatabase): ServiceTokenSummary[] {
  return db
    .select(serviceTokenSummaryColumns)
    .from(serviceTokensTable)
    .orderBy(serviceTokensTable.name)
    .all();
}

/**
 * The four outcomes the guard logs as its `reason`. Split here rather than
 * returning `ServiceTokenSummary | null` so that "revoked" stays distinguishable
 * from "never existed" server-side, while the response to the caller does not
 * distinguish them at all.
 */
export type ServiceTokenLookup =
  | { outcome: "malformed" }
  | { outcome: "unknown" }
  | { outcome: "revoked"; token: ServiceTokenSummary }
  | { outcome: "active"; token: ServiceTokenSummary };

export function findServiceTokenByPlaintext(
  db: SecretsDatabase,
  presented: string,
): ServiceTokenLookup {
  if (!isServiceTokenShape(presented)) {
    return { outcome: "malformed" };
  }

  const token = db
    .select(serviceTokenSummaryColumns)
    .from(serviceTokensTable)
    .where(eq(serviceTokensTable.tokenHash, hashServiceToken(presented)))
    .get();

  if (token === undefined) {
    return { outcome: "unknown" };
  }

  return token.revokedAt === null ? { outcome: "active", token } : { outcome: "revoked", token };
}

export function touchServiceTokenLastUsed(db: SecretsDatabase, id: string): void {
  db.update(serviceTokensTable)
    .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(serviceTokensTable.id, id))
    .run();
}
