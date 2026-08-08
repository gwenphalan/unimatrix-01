import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Append-only. Deliberately carries no foreign keys: the client runs
 * `foreign_keys = ON` (see `../client.ts`), so an FK from this table to
 * `secrets(name)` with `onDelete: "cascade"` would erase the audit trail of
 * exactly the deletion it exists to record. `secretName`, `secretVersionId`
 * and `actorTokenId` are therefore plain text columns, never references.
 */
export const secretAuditLogTable = sqliteTable(
  "secret_audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurredAt: text("occurred_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    action: text("action").notNull(),
    secretName: text("secret_name"),
    secretVersionId: text("secret_version_id"),
    actorTokenId: text("actor_token_id"),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
  },
  (table) => [index("secret_audit_log_occurred_at_idx").on(table.occurredAt)],
);

export type NewSecretAuditLogEntry = typeof secretAuditLogTable.$inferInsert;
export type SecretAuditLogEntry = typeof secretAuditLogTable.$inferSelect;
