/**
 * What a token may do, as one value rather than a set.
 *
 * The two are mutually exclusive and that is the security property, not a
 * limitation: the admin surface creates, rotates and deletes secrets but must
 * never read a value back, so a credential holding both would be the exact hole
 * the asymmetry exists to close. A consumer needing both gets two tokens.
 */
export const SERVICE_TOKEN_CAPABILITIES = ["read", "manage"] as const;

export type ServiceTokenCapability = (typeof SERVICE_TOKEN_CAPABILITIES)[number];

export function isServiceTokenCapability(value: string): value is ServiceTokenCapability {
  return SERVICE_TOKEN_CAPABILITIES.includes(value as ServiceTokenCapability);
}
