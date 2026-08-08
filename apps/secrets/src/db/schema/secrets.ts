import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One row per secret name. `secretMetadataSchema` in
 * `packages/shared/src/schemas/secrets.ts` is one flat object
 * (`maskedPrefix`, `kekVersion`, `createdAt`, `rotatedAt`); this table holds
 * only the name and its two timestamps, joining to {@link secretVersionsTable}
 * for the fields that belong to a specific sealed version.
 */
export const secretsTable = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  rotatedAt: text("rotated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type NewSecret = typeof secretsTable.$inferInsert;
export type Secret = typeof secretsTable.$inferSelect;

/**
 * One sealed value per version. `id` is `SecretContext.versionId`
 * (`packages/secrets/src/envelope.ts`) and must never contain `.` —
 * `assertValidContext` rejects a dot because it is the envelope's field
 * separator, so generate a UUID or ULID here, never a composite `name.n`.
 *
 * `kekVersion` duplicates a value already recoverable by decrypting
 * `envelope`, on purpose: it makes "which rows still need re-sealing under
 * the newest key" a query instead of a decrypt.
 */
export const secretVersionsTable = sqliteTable(
  "secret_versions",
  {
    id: text("id").primaryKey(),
    secretName: text("secret_name")
      .notNull()
      .references(() => secretsTable.name, { onDelete: "cascade" }),
    envelope: text("envelope").notNull(),
    kekVersion: integer("kek_version").notNull(),
    maskedPrefix: text("masked_prefix").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    supersededAt: text("superseded_at"),
  },
  (table) => [
    index("secret_versions_name_created_idx").on(table.secretName, table.createdAt),
    // Rotation writes a new row and sets the old row's supersededAt rather
    // than overwriting it, so history is retained — this partial index is
    // what keeps at most one *live* (non-superseded) version per secret name.
    uniqueIndex("secret_versions_live_unique")
      .on(table.secretName)
      .where(sql`${table.supersededAt} IS NULL`),
  ],
);

export type NewSecretVersion = typeof secretVersionsTable.$inferInsert;
export type SecretVersion = typeof secretVersionsTable.$inferSelect;
