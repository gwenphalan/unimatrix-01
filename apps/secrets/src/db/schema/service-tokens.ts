import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { SERVICE_TOKEN_CAPABILITIES } from "../../service-tokens/capability.js";

/**
 * `tokenHash` is a SHA-256 hex digest and doubles as the lookup key —
 * `findServiceTokenByPlaintext` hashes what a caller presented and reads this
 * unique index, which a salted digest could not support. See
 * `../../service-tokens/format.ts` for why a KDF is the wrong tool here.
 *
 * `capability` is single-valued: see `../../service-tokens/capability.ts`.
 *
 * There is no expiry column. Revocation is the entire lifecycle.
 *
 * `name` is unique only among *live* rows (`service_tokens_live_unique`
 * below), the same idiom as `secret_versions_live_unique` in `secrets.ts` —
 * a revoked name frees up for reissue while every revoked row stays for the
 * audit trail.
 */
export const serviceTokensTable = sqliteTable(
  "service_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopePrefix: text("scope_prefix").notNull(),
    capability: text("capability", { enum: SERVICE_TOKEN_CAPABILITIES }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("service_tokens_live_unique")
      .on(table.name)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type NewServiceToken = typeof serviceTokensTable.$inferInsert;
export type ServiceToken = typeof serviceTokensTable.$inferSelect;
