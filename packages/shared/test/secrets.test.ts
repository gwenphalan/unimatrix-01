import { describe, expect, it } from "vitest";

import {
  createSecretBodySchema,
  deleteSecretsBodySchema,
  listSecretsResponseSchema,
  rotateSecretBodySchema,
  secretMaskedPrefixSchema,
  secretMetadataSchema,
  secretNameSchema,
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

describe("createSecretBodySchema / rotateSecretBodySchema", () => {
  it("accept a minimal valid body", () => {
    const body = { name: "github/api-token", value: "hunter2" };
    expect(createSecretBodySchema.safeParse(body).success).toBe(true);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(true);
  });

  it("reject an unknown key, proving strictObject", () => {
    const body = { name: "github/api-token", value: "hunter2", extra: true };
    expect(createSecretBodySchema.safeParse(body).success).toBe(false);
    expect(rotateSecretBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("listSecretsResponseSchema", () => {
  it("accepts a minimal valid response", () => {
    expect(listSecretsResponseSchema.safeParse({ secrets: [VALID_METADATA] }).success).toBe(true);
  });

  it("rejects an unknown key, proving strictObject", () => {
    expect(
      listSecretsResponseSchema.safeParse({ secrets: [VALID_METADATA], extra: true }).success,
    ).toBe(false);
  });
});

describe("deleteSecretsBodySchema", () => {
  it("accepts a minimal valid selection", () => {
    expect(deleteSecretsBodySchema.safeParse({ names: ["a"] }).success).toBe(true);
  });

  it("rejects an empty names array", () => {
    expect(deleteSecretsBodySchema.safeParse({ names: [] }).success).toBe(false);
  });

  it("rejects a selection over the bulk cap", () => {
    const names = Array.from({ length: 101 }, (_unused, index) => `name-${index}`);
    expect(deleteSecretsBodySchema.safeParse({ names }).success).toBe(false);
    expect(deleteSecretsBodySchema.safeParse({ names: names.slice(0, 100) }).success).toBe(true);
  });
});
