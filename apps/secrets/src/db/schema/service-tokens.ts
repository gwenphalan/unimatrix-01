import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One `tokenHash` column suffices whatever hashing scheme the auth item
 * picks — a PHC-format Argon2id string carries its own salt and parameters
 * inline, so no separate salt column is needed.
 */
export const serviceTokensTable = sqliteTable("service_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  scopePrefix: text("scope_prefix").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
});

export type NewServiceToken = typeof serviceTokensTable.$inferInsert;
export type ServiceToken = typeof serviceTokensTable.$inferSelect;
