/**
 * What a token may do, as one value rather than a set.
 *
 * Single-valued by design, not a limitation: a credential holding both `read`
 * and a mutation capability would be the exact hole the read/write asymmetry
 * exists to close, so a consumer needing more than one capability gets more
 * than one token. `write` sits strictly between `read` and `manage` — it may
 * create and rotate but never delete, which is what lets the admin console
 * bootstrap a platform credential without a route it could use to clear one:
 * creating a name that holds nothing destroys nothing, while deleting is the
 * operation that goes to the host CLI, where an operator has to mean it.
 */
export const SERVICE_TOKEN_CAPABILITIES = ["read", "write", "manage"] as const;

export type ServiceTokenCapability = (typeof SERVICE_TOKEN_CAPABILITIES)[number];

export function isServiceTokenCapability(value: string): value is ServiceTokenCapability {
  return SERVICE_TOKEN_CAPABILITIES.includes(value as ServiceTokenCapability);
}
