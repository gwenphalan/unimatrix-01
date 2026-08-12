import type { SecretTier } from "./schemas/secrets.js";

/**
 * `consumedBy` is prose, read by an operator in the admin console before a
 * destructive action: what breaks if this credential is missing or wrong. It
 * is the reason this registry is code and not a comma-separated env var.
 */
export interface SecretRegistryEntry {
  name: string;
  tier: SecretTier;
  consumedBy: string;
}

/**
 * What the system expects to exist. The admin console lists this union'd with
 * whatever the store actually holds, so a credential the running code needs
 * and the store lacks is visible rather than simply absent.
 *
 * Every name must satisfy `secretNameSchema` — lowercase, no underscores, no
 * dots — or it can never be stored. `test/secrets-registry.test.ts` asserts
 * that over the whole array, so a name that cannot be stored fails there
 * rather than at runtime.
 *
 * Nothing reads a `platform` name out of the store today: the two Clerk keys
 * reach `apps/api` as environment variables. They are declared here because
 * the console's question is what the system needs, not what some service
 * currently fetches.
 */
export const SECRET_REGISTRY: readonly SecretRegistryEntry[] = [
  {
    name: "platform/clerk-secret-key",
    tier: "platform",
    consumedBy:
      "apps/api's Clerk backend calls. Without it the API boots with auth and every account-scoped route disabled; with a wrong value every signed-in request fails.",
  },
  {
    name: "platform/clerk-jwt-key",
    tier: "platform",
    consumedBy:
      "Networkless verification of Clerk session tokens in apps/api. A wrong value rejects every signed-in request, including the admin console's own.",
  },
];

/**
 * The names `apps/api` fetches from the secrets store at boot. Empty: no
 * integration is wired yet.
 *
 * Written `map` then `filter` rather than the more obvious `filter` then
 * `map`, because with the integration tier empty the second callback of that
 * order never runs and the package's 100% function-coverage floor fails on a
 * correct implementation.
 */
export function integrationSecretNames(): readonly string[] {
  return SECRET_REGISTRY.map((entry) => entry.name).filter(
    (name) => secretTierForName(name) === "integration",
  );
}

/**
 * `null` means unlisted — a name the store holds that nothing here declares.
 * That is a real state the console renders, not an error: a credential can be
 * created through the console or the host CLI without ever being declared.
 */
export function secretTierForName(name: string): SecretTier | null {
  return SECRET_REGISTRY.find((entry) => entry.name === name)?.tier ?? null;
}
