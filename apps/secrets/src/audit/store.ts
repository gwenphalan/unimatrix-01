import type { SecretsDatabaseWriter } from "../db/client.js";
import { secretAuditLogTable } from "../db/schema/index.js";

/**
 * Token lifecycle is here because minting and retiring a credential is
 * itself a mutation of this store. `secret.read` is recorded on every read
 * attempt, success and failure alike — the other three only on success.
 */
export type SecretAuditAction =
  | "service_token.issued"
  | "service_token.revoked"
  | "secret.created"
  | "secret.rotated"
  | "secret.deleted"
  | "secret.read"
  | "secret.resealed"
  | "kek.verified"
  | "kek.generated"
  | "kek.rotated";

/** An authenticated service token, or the host CLI, which has no session. */
export type SecretAuditActorKind = "service-token" | "host-cli";

export type SecretAuditOutcome = "success" | "failure";

/**
 * Never the value and never the ciphertext — a name, an action, an actor and a
 * time is the whole record. `actorUserId` is attributed by the calling side
 * from its own verified session and is never read from client input.
 */
export interface SecretAuditEntry {
  action: SecretAuditAction;
  actorKind: SecretAuditActorKind;
  outcome: SecretAuditOutcome;
  /** The token that acted. Null for the CLI. */
  actorTokenId?: string;
  actorUserId?: string;
  /** The token a `service_token.*` row is about, which is not the one that acted. */
  serviceTokenId?: string;
  secretName?: string;
  secretVersionId?: string;
  requestId?: string;
}

/**
 * The only export this module will ever have. Append-only is not a property the
 * table can assert for itself — SQLite has no such mode — so it is held by
 * nothing here being able to change or remove a row.
 *
 * Takes a {@link SecretsDatabaseWriter} rather than the database so a caller
 * can pass a transaction handle and land the row with the mutation it records.
 */
export function recordAuditEntry(db: SecretsDatabaseWriter, entry: SecretAuditEntry): void {
  db.insert(secretAuditLogTable)
    .values({
      action: entry.action,
      actorKind: entry.actorKind,
      outcome: entry.outcome,
      actorTokenId: entry.actorTokenId ?? null,
      actorUserId: entry.actorUserId ?? null,
      serviceTokenId: entry.serviceTokenId ?? null,
      secretName: entry.secretName ?? null,
      secretVersionId: entry.secretVersionId ?? null,
      requestId: entry.requestId ?? null,
    })
    .run();
}
