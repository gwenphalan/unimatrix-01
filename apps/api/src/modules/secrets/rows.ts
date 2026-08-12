import {
  SECRET_REGISTRY,
  type AdminSecretRow,
  type SecretMetadata,
  type SecretTier,
} from "@unimatrix/shared";

/**
 * The scope prefix of the `platform`-tier service token. `scopeCoversName` in
 * `apps/secrets` is `name === prefix || name.startsWith(prefix + "/")`, and
 * this mirrors it exactly: a name this returns `"platform"` for is a name the
 * integrations token cannot reach, and vice versa. Sending a mutation to the
 * wrong client would come back as the store's 404, which reads as "no such
 * secret" and says nothing about scope.
 */
const PLATFORM_SCOPE_PREFIX = "platform";

/**
 * Which tier's token can act on `name`. Total rather than nullable: an
 * undeclared name still has to be routed somewhere, and the store's scopes —
 * not the registry — are what decide which token reaches it.
 */
export function tierForName(name: string): SecretTier {
  return name === PLATFORM_SCOPE_PREFIX || name.startsWith(`${PLATFORM_SCOPE_PREFIX}/`)
    ? "platform"
    : "integration";
}

export interface StoredSecretsByTier {
  platform: readonly SecretMetadata[];
  integration: readonly SecretMetadata[];
}

/**
 * The union the console renders: every name the registry declares, plus
 * everything the store holds. Three row shapes fall out of it — declared and
 * stored, declared and missing (`metadata: null`, the state that is invisible
 * without a registry), and stored but undeclared (`consumedBy: null`, a name
 * nothing here can explain).
 *
 * A stored row's tier is the scope of the token that returned it, not a guess
 * from its name — no token spans both scopes, so which list a row arrived in
 * *is* its tier.
 *
 * Ordered registry-first, then stored-only names in the order the store
 * returned them. Nothing downstream depends on that; the console sorts and
 * groups its own rows.
 */
export function mergeAdminSecretRows(stored: StoredSecretsByTier): AdminSecretRow[] {
  const rows = new Map<string, AdminSecretRow>();

  for (const entry of SECRET_REGISTRY) {
    rows.set(entry.name, {
      name: entry.name,
      tier: entry.tier,
      metadata: null,
      consumedBy: entry.consumedBy,
    });
  }

  const byTier = [
    { tier: "platform", metadata: stored.platform },
    { tier: "integration", metadata: stored.integration },
  ] as const satisfies ReadonlyArray<{ tier: SecretTier; metadata: readonly SecretMetadata[] }>;

  for (const list of byTier) {
    for (const metadata of list.metadata) {
      rows.set(metadata.name, {
        name: metadata.name,
        tier: list.tier,
        metadata,
        consumedBy: rows.get(metadata.name)?.consumedBy ?? null,
      });
    }
  }

  return [...rows.values()];
}
