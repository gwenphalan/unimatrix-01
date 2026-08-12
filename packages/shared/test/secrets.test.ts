import { describe, expect, it } from "vitest";

import {
  adminCreateSecretBodySchema,
  adminListSecretsResponseSchema,
  adminDeleteSecretBodySchema,
  adminRotateSecretBodySchema,
  createSecretBodySchema,
  deleteSecretsBodySchema,
  getSecretQuerySchema,
  listSecretsQuerySchema,
  listSecretsResponseSchema,
  rotateSecretBodySchema,
  secretActorUserIdSchema,
  secretMaskedPrefixSchema,
  secretMetadataSchema,
  secretNameSchema,
  secretValueResponseSchema,
  secretValueSchema,
  SECRET_VALUE_MAX_LENGTH,
} from "../src/index.js";

const VALID_METADATA = {
  name: "github/api-token",
  maskedPrefix: "ghp_********",
  kekVersion: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  rotatedAt: "2026-08-01T00:00:00.000Z",
};

describe("secretNameSchema", () => {
  it("accepts a minimal valid name and a scoped/prefixed one", () => {
    expect(secretNameSchema.safeParse("token").success).toBe(true);
    expect(secretNameSchema.safeParse("github/api-token").success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(secretNameSchema.safeParse("").success).toBe(false);
  });

  it("rejects a name over the max length", () => {
    expect(secretNameSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("rejects a disallowed character", () => {
    expect(secretNameSchema.safeParse("Github_Token").success).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(secretNameSchema.safeParse("/github/token").success).toBe(false);
  });

  it("rejects a doubled slash", () => {
    expect(secretNameSchema.safeParse("github//token").success).toBe(false);
  });

  it("rejects a '.' — reserved by the envelope's AAD field separator", () => {
    expect(secretNameSchema.safeParse("github.token").success).toBe(false);
  });
});

describe("secretValueSchema", () => {
  it("accepts a minimal valid value", () => {
    expect(secretValueSchema.safeParse("x").success).toBe(true);
  });

  it("rejects an empty value", () => {
    expect(secretValueSchema.safeParse("").success).toBe(false);
  });

  it("rejects a value over SECRET_VALUE_MAX_LENGTH", () => {
    expect(secretValueSchema.safeParse("x".repeat(SECRET_VALUE_MAX_LENGTH + 1)).success).toBe(
      false,
    );
    expect(secretValueSchema.safeParse("x".repeat(SECRET_VALUE_MAX_LENGTH)).success).toBe(true);
  });
});

describe("secretMaskedPrefixSchema", () => {
  it("accepts a minimal valid masked prefix", () => {
    expect(secretMaskedPrefixSchema.safeParse("ghp_********").success).toBe(true);
  });

  it("rejects an empty masked prefix", () => {
    expect(secretMaskedPrefixSchema.safeParse("").success).toBe(false);
  });

  it("rejects a masked prefix over the max length", () => {
    expect(secretMaskedPrefixSchema.safeParse("*".repeat(33)).success).toBe(false);
  });
});

describe("secretMetadataSchema", () => {
  it("accepts a minimal valid object", () => {
    expect(secretMetadataSchema.safeParse(VALID_METADATA).success).toBe(true);
  });

  it("rejects an unknown key, proving strictObject", () => {
    expect(
      secretMetadataSchema.safeParse({ ...VALID_METADATA, description: "not allowed" }).success,
    ).toBe(false);
  });

  it("rejects a non-positive kekVersion", () => {
    expect(secretMetadataSchema.safeParse({ ...VALID_METADATA, kekVersion: 0 }).success).toBe(
      false,
    );
  });
});

describe("secretActorUserIdSchema", () => {
  it("accepts a Clerk-shaped user id", () => {
    expect(secretActorUserIdSchema.safeParse("user_2cccccccccccccccccccccccccc").success).toBe(
      true,
    );
  });

  it("rejects an empty id", () => {
    expect(secretActorUserIdSchema.safeParse("").success).toBe(false);
  });

  it("rejects an id over the max length", () => {
    expect(secretActorUserIdSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("rejects a disallowed character", () => {
    expect(secretActorUserIdSchema.safeParse("user 2c").success).toBe(false);
  });
});

describe("adminCreateSecretBodySchema / adminRotateSecretBodySchema", () => {
  it("accept a minimal valid body", () => {
    const body = { name: "github/api-token", value: "hunter2" };
    expect(adminCreateSecretBodySchema.safeParse(body).success).toBe(true);
    expect(adminRotateSecretBodySchema.safeParse(body).success).toBe(true);
  });

  it("reject an actorUserId key — the browser-facing bodies carry no session assertion", () => {
    const body = { name: "github/api-token", value: "hunter2", actorUserId: "user_2c" };
    expect(adminCreateSecretBodySchema.safeParse(body).success).toBe(false);
    expect(adminRotateSecretBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("adminDeleteSecretBodySchema", () => {
  it("accepts a single name", () => {
    expect(adminDeleteSecretBodySchema.safeParse({ name: "github/api-token" }).success).toBe(true);
  });

  it("rejects a names array — the browser-facing delete is narrowed to one name at a time", () => {
    expect(adminDeleteSecretBodySchema.safeParse({ names: ["github/api-token"] }).success).toBe(
      false,
    );
  });
});

describe("createSecretBodySchema / rotateSecretBodySchema", () => {
  it("accept a minimal valid body", () => {
    const body = { name: "github/api-token", value: "hunter2" };
    expect(createSecretBodySchema.safeParse(body).success).toBe(true);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(true);
  });

  it("accept an optional actorUserId", () => {
    const body = { name: "github/api-token", value: "hunter2", actorUserId: "user_2c" };
    expect(createSecretBodySchema.safeParse(body).success).toBe(true);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(true);
  });

  it("reject an unknown key, proving strictObject", () => {
    const body = { name: "github/api-token", value: "hunter2", extra: true };
    expect(createSecretBodySchema.safeParse(body).success).toBe(false);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(false);
  });

  it("reject an unknown key even alongside a valid actorUserId — pins that `.extend()` on a strictObject stays strict rather than reverting to a plain object on a future zod upgrade", () => {
    const body = {
      name: "github/api-token",
      value: "hunter2",
      actorUserId: "user_2c",
      extra: true,
    };
    expect(createSecretBodySchema.safeParse(body).success).toBe(false);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("listSecretsResponseSchema", () => {
  it("accepts a minimal valid response", () => {
    expect(
      listSecretsResponseSchema.safeParse({ secrets: [VALID_METADATA], activeKekVersion: 1 })
        .success,
    ).toBe(true);
  });

  it("rejects a response missing activeKekVersion", () => {
    expect(listSecretsResponseSchema.safeParse({ secrets: [VALID_METADATA] }).success).toBe(false);
  });

  it("rejects an unknown key, proving strictObject", () => {
    expect(
      listSecretsResponseSchema.safeParse({
        secrets: [VALID_METADATA],
        activeKekVersion: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("adminListSecretsResponseSchema", () => {
  const STORED_ROW = {
    name: "integrations/github/token",
    tier: "integration",
    metadata: VALID_METADATA,
    consumedBy: "Nothing yet.",
  };
  const MISSING_ROW = {
    name: "platform/clerk-secret-key",
    tier: "platform",
    metadata: null,
    consumedBy: "apps/api's Clerk backend calls.",
  };
  const UNLISTED_ROW = { ...STORED_ROW, consumedBy: null };

  it("accepts a stored row, a missing row, and an unlisted one", () => {
    expect(
      adminListSecretsResponseSchema.safeParse({
        secrets: [STORED_ROW, MISSING_ROW, UNLISTED_ROW],
        activeKekVersion: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects a row carrying an unknown tier", () => {
    expect(
      adminListSecretsResponseSchema.safeParse({
        secrets: [{ ...STORED_ROW, tier: "bootstrap" }],
        activeKekVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects a row omitting metadata rather than nulling it", () => {
    expect(
      adminListSecretsResponseSchema.safeParse({
        secrets: [{ name: STORED_ROW.name, tier: STORED_ROW.tier, consumedBy: null }],
        activeKekVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects an empty consumedBy, which would render as a blank warning", () => {
    expect(
      adminListSecretsResponseSchema.safeParse({
        secrets: [{ ...STORED_ROW, consumedBy: "" }],
        activeKekVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown key, proving strictObject", () => {
    expect(
      adminListSecretsResponseSchema.safeParse({
        secrets: [{ ...STORED_ROW, extra: true }],
        activeKekVersion: 1,
      }).success,
    ).toBe(false);
  });
});

describe("getSecretQuerySchema", () => {
  it("accepts a minimal valid query", () => {
    expect(getSecretQuerySchema.safeParse({ name: "github/api-token" }).success).toBe(true);
  });

  it("rejects an extra key, proving strictObject", () => {
    expect(getSecretQuerySchema.safeParse({ name: "github/api-token", extra: true }).success).toBe(
      false,
    );
  });

  it("rejects an invalid name", () => {
    expect(getSecretQuerySchema.safeParse({ name: "Github_Token" }).success).toBe(false);
  });
});

describe("listSecretsQuerySchema", () => {
  it("accepts an empty object", () => {
    expect(listSecretsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects any key, proving strictObject", () => {
    expect(listSecretsQuerySchema.safeParse({ name: "github/api-token" }).success).toBe(false);
  });
});

describe("secretValueResponseSchema", () => {
  const VALID_VALUE_RESPONSE = { name: "github/api-token", value: "hunter2" };

  it("accepts a minimal valid response", () => {
    expect(secretValueResponseSchema.safeParse(VALID_VALUE_RESPONSE).success).toBe(true);
  });

  it("rejects an extra key, proving strictObject", () => {
    expect(
      secretValueResponseSchema.safeParse({ ...VALID_VALUE_RESPONSE, extra: true }).success,
    ).toBe(false);
  });

  it("rejects an over-length value", () => {
    expect(
      secretValueResponseSchema.safeParse({
        ...VALID_VALUE_RESPONSE,
        value: "x".repeat(SECRET_VALUE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe("deleteSecretsBodySchema", () => {
  it("accepts a minimal valid selection", () => {
    expect(deleteSecretsBodySchema.safeParse({ names: ["a"] }).success).toBe(true);
  });

  it("accepts an optional actorUserId", () => {
    expect(
      deleteSecretsBodySchema.safeParse({ names: ["a"], actorUserId: "user_2c" }).success,
    ).toBe(true);
  });

  it("rejects an empty names array", () => {
    expect(deleteSecretsBodySchema.safeParse({ names: [] }).success).toBe(false);
  });

  it("rejects a selection over the bulk cap", () => {
    const names = Array.from({ length: 101 }, (_unused, index) => `name-${index}`);
    expect(deleteSecretsBodySchema.safeParse({ names }).success).toBe(false);
    expect(deleteSecretsBodySchema.safeParse({ names: names.slice(0, 100) }).success).toBe(true);
  });

  it("rejects an unknown key even alongside a valid actorUserId, pinning that `.extend()` preserves strictObject strictness", () => {
    expect(
      deleteSecretsBodySchema.safeParse({ names: ["a"], actorUserId: "user_2c", extra: true })
        .success,
    ).toBe(false);
  });
});
