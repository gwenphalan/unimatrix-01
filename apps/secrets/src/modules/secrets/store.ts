import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { SecretsDatabaseWriter } from "../../db/client.js";
import { secretsTable, secretVersionsTable } from "../../db/schema/index.js";

export interface SealedSecretVersion {
  name: string;
  versionId: string;
  envelope: string;
  maskedPrefix: string;
  kekVersion: number;
}

export interface SecretMetadataRow {
  name: string;
  maskedPrefix: string;
  kekVersion: number;
  createdAt: string;
  rotatedAt: string;
}

export interface LiveSecretVersion {
  name: string;
  versionId: string;
  envelope: string;
  kekVersion: number;
}

/** Every function here takes a {@link SecretsDatabaseWriter} rather than the database, so a caller composes it inside a transaction alongside the audit row that records it. */
export function createSecret(
  tx: SecretsDatabaseWriter,
  sealed: SealedSecretVersion,
): SecretMetadataRow {
  const row = tx
    .insert(secretsTable)
    .values({ name: sealed.name })
    .returning({
      name: secretsTable.name,
      createdAt: secretsTable.createdAt,
      rotatedAt: secretsTable.rotatedAt,
    })
    .get();

  tx.insert(secretVersionsTable)
    .values({
      id: sealed.versionId,
      secretName: sealed.name,
      envelope: sealed.envelope,
      kekVersion: sealed.kekVersion,
      maskedPrefix: sealed.maskedPrefix,
    })
    .run();

  return {
    name: row.name,
    maskedPrefix: sealed.maskedPrefix,
    kekVersion: sealed.kekVersion,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  };
}

/**
 * Supersedes the live row before inserting the new one — inserting first
 * would put two live rows on the name at once and `secret_versions_live_unique`
 * would roll the whole transaction back. The final `rotatedAt` update is a
 * third statement, not a side effect of the first two: it is a plain column
 * with a default, and nothing else here writes to it.
 */
export function rotateSecret(
  tx: SecretsDatabaseWriter,
  sealed: SealedSecretVersion,
): SecretMetadataRow {
  tx.update(secretVersionsTable)
    .set({ supersededAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(secretVersionsTable.secretName, sealed.name),
        isNull(secretVersionsTable.supersededAt),
      ),
    )
    .run();

  tx.insert(secretVersionsTable)
    .values({
      id: sealed.versionId,
      secretName: sealed.name,
      envelope: sealed.envelope,
      kekVersion: sealed.kekVersion,
      maskedPrefix: sealed.maskedPrefix,
    })
    .run();

  const row = tx
    .update(secretsTable)
    .set({ rotatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(secretsTable.name, sealed.name))
    .returning({
      name: secretsTable.name,
      createdAt: secretsTable.createdAt,
      rotatedAt: secretsTable.rotatedAt,
    })
    .get();

  return {
    name: row.name,
    maskedPrefix: sealed.maskedPrefix,
    kekVersion: sealed.kekVersion,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  };
}

/** `secret_versions` rows follow through the FK cascade; audit rows survive, since that table carries no FKs. */
export function deleteSecrets(tx: SecretsDatabaseWriter, names: readonly string[]): number {
  return tx.delete(secretsTable).where(inArray(secretsTable.name, names)).run().changes;
}

/** The subset of `names` that has a `secrets` row — the existence check a bulk delete needs before it commits to anything. */
export function listExistingSecretNames(
  db: SecretsDatabaseWriter,
  names: readonly string[],
): Set<string> {
  const rows = db
    .select({ name: secretsTable.name })
    .from(secretsTable)
    .where(inArray(secretsTable.name, names))
    .all();

  return new Set(rows.map((row) => row.name));
}

export function getLiveSecretVersion(
  db: SecretsDatabaseWriter,
  name: string,
): LiveSecretVersion | undefined {
  return db
    .select({
      name: secretsTable.name,
      versionId: secretVersionsTable.id,
      envelope: secretVersionsTable.envelope,
      kekVersion: secretVersionsTable.kekVersion,
    })
    .from(secretsTable)
    .innerJoin(
      secretVersionsTable,
      and(
        eq(secretVersionsTable.secretName, secretsTable.name),
        isNull(secretVersionsTable.supersededAt),
      ),
    )
    .where(eq(secretsTable.name, name))
    .get();
}

export function listSecretMetadata(db: SecretsDatabaseWriter): SecretMetadataRow[] {
  return db
    .select({
      name: secretsTable.name,
      maskedPrefix: secretVersionsTable.maskedPrefix,
      kekVersion: secretVersionsTable.kekVersion,
      createdAt: secretsTable.createdAt,
      rotatedAt: secretsTable.rotatedAt,
    })
    .from(secretsTable)
    .innerJoin(
      secretVersionsTable,
      and(
        eq(secretVersionsTable.secretName, secretsTable.name),
        isNull(secretVersionsTable.supersededAt),
      ),
    )
    .orderBy(asc(secretsTable.name))
    .all();
}
