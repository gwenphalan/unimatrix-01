import type { AdminSecretRow, SecretTier } from "@unimatrix/shared";

/**
 * `unlisted` is a stored name nothing in the codebase declares. It is not a
 * fault — a credential can be created here or from the host CLI without ever
 * being written into the registry — so it reads as its own word rather than
 * borrowing `set`, which would claim the system expects it.
 */
export type SecretRowStatus = "set" | "not-set" | "unlisted";

export type SecretRowAction = "set-value" | "rotate" | "clear-value";

/** The action's name, used identically on the button, in the dialog, and in the toast. */
export const SECRET_ACTION_LABELS: Record<SecretRowAction, string> = {
  "set-value": "Set value",
  rotate: "Rotate",
  "clear-value": "Clear value",
};

export interface SecretRowDescription {
  name: string;
  tier: SecretTier;
  status: SecretRowStatus;
  /** The status column's whole content: a word, never a colour on its own. */
  statusLabel: string;
  /** The masked prefix with its elision, or `null` where there is no value to mask. */
  maskedValue: string | null;
  /** `null` where the store holds nothing, so the Rotated column has nothing to date. */
  rotatedAt: string | null;
  /** What breaks without this credential, or `null` for an unlisted name. */
  consumedBy: string | null;
  /**
   * Whether the registry declares this name. Clearing a declared name leaves
   * the row listed as `Not set`; clearing an undeclared one removes it from
   * the console entirely, and the confirmation has to say which.
   */
  isDeclared: boolean;
  /** Sealed under a KEK older than the active one, so a re-seal is outstanding. */
  needsReseal: boolean;
  actions: readonly SecretRowAction[];
}

/**
 * Every tier-and-state rule the console renders, in one pure function.
 *
 * The rules themselves: a name the store has no value for offers only
 * {@link SECRET_ACTION_LABELS}'s `Set value`, whatever its tier — there is
 * nothing to rotate. A platform name is never offered a destructive action
 * anywhere in this console, because clearing Clerk's secret key by misclick is
 * the failure that rule exists to prevent; `apps/api` refuses a `platform/*`
 * delete with a 403 regardless, so the omission here is the first of two
 * guards rather than the only one.
 *
 * `consumedBy` is the discriminator for "declared", because it is the only one
 * on the wire: `apps/api` fills it from the registry entry and leaves it
 * `null` for a stored name the registry does not name.
 */
export function describeSecretRow(
  row: AdminSecretRow,
  activeKekVersion: number,
): SecretRowDescription {
  const isDeclared = row.consumedBy !== null;
  const shared = {
    name: row.name,
    tier: row.tier,
    consumedBy: row.consumedBy,
    isDeclared,
  };

  if (row.metadata === null) {
    return {
      ...shared,
      status: "not-set",
      // Matches the action that resolves it. "Missing" reads as a fault to be
      // investigated; this is a slot waiting for a value.
      statusLabel: "Not set",
      maskedValue: null,
      rotatedAt: null,
      needsReseal: false,
      actions: ["set-value"],
    };
  }

  return {
    ...shared,
    status: isDeclared ? "set" : "unlisted",
    statusLabel: isDeclared ? "Set" : "Unlisted",
    maskedValue: `${row.metadata.maskedPrefix}…`,
    rotatedAt: row.metadata.rotatedAt,
    needsReseal: row.metadata.kekVersion < activeKekVersion,
    actions: row.tier === "platform" ? ["rotate"] : ["rotate", "clear-value"],
  };
}
