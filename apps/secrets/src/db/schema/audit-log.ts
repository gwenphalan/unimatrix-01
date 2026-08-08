import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Append-only. Deliberately carries no foreign keys: the client runs
 * `foreign_keys = ON` (see `../client.ts`), so an FK from this table to
 * `secrets(name)` with `onDelete: "cascade"` would erase the audit trail of
 * exactly the deletion it exists to record. `secretName`, `secretVersionId`,
 * `actorTokenId` and `serviceTokenId` are therefore plain text columns, never
 * references.
 *
 * Three columns describe who acted and one describes what was acted on, and
 * conflating them is the mistake to avoid:
 *
 * - `actorKind` names the class of actor. Two exist — an authenticated service
 *   token and the host CLI — so `actorTokenId IS NULL` would otherwise be an
 *   implicit encoding of "the CLI did it", which fails silently the moment a
 *   third actor appears.
 * - `actorTokenId` is the token that acted. Null for CLI rows.
 * - `actorUserId` is the user id attributed by the calling side's verified
 *   session. Null for the CLI, which has no session; never accepted from
 *   client input.
 * - `serviceTokenId` is the token a `service_token.*` row is *about*, which is
 *   a different thing from the token that performed the action.
 *
 * `action`, `actorKind` and `outcome` are plain text rather than enum-typed
 * columns; `recordAuditEntry` (`../../audit/store.ts`) is the only writer and
 * types them at that boundary.
 */
export const secretAuditLogTable = sqliteTable(
  "secret_audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurredAt: text("occurred_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    action: text("action").notNull(),
    actorKind: text("actor_kind").notNull(),
    secretName: text("secret_name"),
    secretVersionId: text("secret_version_id"),
    actorTokenId: text("actor_token_id"),
    actorUserId: text("actor_user_id"),
    serviceTokenId: text("service_token_id"),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
  },
  (table) => [index("secret_audit_log_occurred_at_idx").on(table.occurredAt)],
);

export type NewSecretAuditLogEntry = typeof secretAuditLogTable.$inferInsert;
export type SecretAuditLogEntry = typeof secretAuditLogTable.$inferSelect;
