import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { SERVICE_TOKEN_CAPABILITIES } from "../../service-tokens/capability.js";

/**
 * `tokenHash` is a SHA-256 hex digest and doubles as the lookup key —
 * `findServiceTokenByPlaintext` hashes what a caller presented and reads this
 * unique index, which a salted digest could not support. See
 * `../../service-tokens/format.ts` for why a KDF is the wrong tool here.
 *
 * `capability` is single-valued and its two values are mutually exclusive:
 * see `../../service-tokens/capability.ts`.
 *
 * There is no expiry column. Revocation is the entire lifecycle.
 */
export const serviceTokensTable = sqliteTable("service_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  scopePrefix: text("scope_prefix").notNull(),
  capability: text("capability", { enum: SERVICE_TOKEN_CAPABILITIES }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
});

export type NewServiceToken = typeof serviceTokensTable.$inferInsert;
export type ServiceToken = typeof serviceTokensTable.$inferSelect;
