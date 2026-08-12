import type { AdminSecretRow, SecretMetadata, SecretTier } from "@unimatrix/shared";
import { describe, expect, it } from "vitest";

import { describeSecretRow } from "@/features/secrets/row-state";

function metadata(overrides: Partial<SecretMetadata> = {}): SecretMetadata {
  return {
    name: "integrations/github/api-token",
    maskedPrefix: "ghp_",
    kekVersion: 2,
    createdAt: "2026-07-01T00:00:00.000Z",
    rotatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function row(
  tier: SecretTier,
  overrides: Partial<Omit<AdminSecretRow, "tier">> = {},
): AdminSecretRow {
  return {
    name: tier === "platform" ? "platform/clerk-secret-key" : "integrations/github/api-token",
    tier,
    metadata: metadata(),
    consumedBy: "The nightly sync job.",
    ...overrides,
  };
}

describe("describeSecretRow", () => {
  it("offers a platform credential rotation and nothing destructive", () => {
    const described = describeSecretRow(row("platform"), 2);

    expect(described.status).toBe("set");
    expect(described.statusLabel).toBe("Set");
    expect(described.actions).toEqual(["rotate"]);
    expect(described.maskedValue).toBe("ghp_…");
    expect(described.rotatedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("offers an integration credential rotation and a clear", () => {
    expect(describeSecretRow(row("integration"), 2).actions).toEqual(["rotate", "clear-value"]);
  });

  /**
   * The state the registry exists to make visible: the system expects this
   * name and the store holds nothing for it. Rotating a value that is not
   * there is not an action, whatever the tier.
   */
  it.each<SecretTier>(["platform", "integration"])(
    "offers only Set value for a %s name the store has nothing for",
    (tier) => {
      const described = describeSecretRow(row(tier, { metadata: null }), 2);

      expect(described.status).toBe("not-set");
      expect(described.statusLabel).toBe("Not set");
      expect(described.actions).toEqual(["set-value"]);
      expect(described.maskedValue).toBeNull();
      expect(described.rotatedAt).toBeNull();
      expect(described.needsReseal).toBe(false);
    },
  );

  it("names a stored credential nothing declares Unlisted, and acts on it as its tier", () => {
    const integration = describeSecretRow(row("integration", { consumedBy: null }), 2);
    const platform = describeSecretRow(row("platform", { consumedBy: null }), 2);

    expect(integration.status).toBe("unlisted");
    expect(integration.statusLabel).toBe("Unlisted");
    expect(integration.isDeclared).toBe(false);
    // Undeclared is not a reason to withhold the actions the tier permits.
    expect(integration.actions).toEqual(["rotate", "clear-value"]);
    expect(platform.actions).toEqual(["rotate"]);
  });

  it("marks a declared name as declared, which is what the clear confirmation branches on", () => {
    expect(describeSecretRow(row("integration"), 2).isDeclared).toBe(true);
  });

  /**
   * A row sealed under the active key must not carry the badge, or every row
   * carries it forever — the fault the badge replaced.
   */
  it("flags a re-seal only for a row behind the active KEK version", () => {
    expect(
      describeSecretRow(row("integration", { metadata: metadata({ kekVersion: 2 }) }), 2),
    ).toHaveProperty("needsReseal", false);
    expect(
      describeSecretRow(row("integration", { metadata: metadata({ kekVersion: 1 }) }), 2),
    ).toHaveProperty("needsReseal", true);
    // Ahead of the keyring is not behind it: a row can only look stale here by
    // being older than the active version, never newer.
    expect(
      describeSecretRow(row("integration", { metadata: metadata({ kekVersion: 3 }) }), 2),
    ).toHaveProperty("needsReseal", false);
  });
});
