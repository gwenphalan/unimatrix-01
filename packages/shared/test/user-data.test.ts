import { describe, expect, it } from "vitest";

import {
  dataKeySchema,
  dataNamespaceSchema,
  documentValueSchema,
  DOCUMENT_VALUE_MAX_BYTES,
  deleteDocumentBodySchema,
  deleteDocumentContract,
  deleteFileBodySchema,
  deleteFileContract,
  deleteResultSchema,
  getDocumentContract,
  getDocumentQuerySchema,
  listDocumentsContract,
  listDocumentsQuerySchema,
  listDocumentsResponseSchema,
  listFilesContract,
  listFilesQuerySchema,
  listFilesResponseSchema,
  putDocumentBodySchema,
  putDocumentContract,
  storedDocumentValueSchema,
  userDocumentSchema,
  userFileMetadataSchema,
} from "../src/index.js";

describe("dataNamespaceSchema", () => {
  it("accepts a lowercase slug", () => {
    expect(dataNamespaceSchema.parse("cflop")).toBe("cflop");
  });

  // Kept as its own case after the cflop rebrand: the app name used to supply
  // the hyphen for free, so renaming it left the `-` branch of the pattern
  // unexercised by any assertion.
  it("accepts a hyphenated slug", () => {
    expect(dataNamespaceSchema.parse("cflop-drill")).toBe("cflop-drill");
  });

  it("accepts a single character slug", () => {
    expect(dataNamespaceSchema.parse("a")).toBe("a");
  });

  it("rejects uppercase characters", () => {
    expect(dataNamespaceSchema.safeParse("CFLOP").success).toBe(false);
  });

  it("rejects a leading hyphen", () => {
    expect(dataNamespaceSchema.safeParse("-cflop").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(dataNamespaceSchema.safeParse("").success).toBe(false);
  });

  it("rejects a slug longer than 64 characters", () => {
    expect(dataNamespaceSchema.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("accepts a slug at the 64 character boundary", () => {
    expect(dataNamespaceSchema.safeParse("a".repeat(64)).success).toBe(true);
  });
});

describe("dataKeySchema", () => {
  it("accepts alphanumerics, dots, underscores, and hyphens", () => {
    expect(dataKeySchema.parse("settings.v1_final-2")).toBe("settings.v1_final-2");
  });

  it("rejects an empty string", () => {
    expect(dataKeySchema.safeParse("").success).toBe(false);
  });

  it("rejects a key longer than 128 characters", () => {
    expect(dataKeySchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("accepts a key at the 128 character boundary", () => {
    expect(dataKeySchema.safeParse("a".repeat(128)).success).toBe(true);
  });

  it("rejects a slash", () => {
    expect(dataKeySchema.safeParse("nested/key").success).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(dataKeySchema.safeParse("has space").success).toBe(false);
  });
});

describe("userDocumentSchema", () => {
  const validDocument = {
    namespace: "cflop",
    key: "settings",
    value: { theme: "dark" },
    updatedAt: "2026-07-22T00:00:00.000Z",
  };

  it("accepts a valid document with an arbitrary JSON value", () => {
    expect(userDocumentSchema.parse(validDocument)).toEqual(validDocument);
  });

  it("accepts primitive and array values", () => {
    expect(userDocumentSchema.parse({ ...validDocument, value: 42 }).value).toBe(42);
    expect(userDocumentSchema.parse({ ...validDocument, value: [1, 2, 3] }).value).toEqual([
      1, 2, 3,
    ]);
    expect(userDocumentSchema.parse({ ...validDocument, value: null }).value).toBeNull();
  });

  it("rejects an invalid namespace", () => {
    expect(
      userDocumentSchema.safeParse({ ...validDocument, namespace: "Bad Namespace" }).success,
    ).toBe(false);
  });

  it("rejects an invalid key", () => {
    expect(userDocumentSchema.safeParse({ ...validDocument, key: "" }).success).toBe(false);
  });

  it("rejects unexpected keys", () => {
    expect(userDocumentSchema.safeParse({ ...validDocument, extra: true }).success).toBe(false);
  });
});

describe("getDocumentQuerySchema", () => {
  it("requires namespace and key", () => {
    expect(getDocumentQuerySchema.parse({ namespace: "cflop", key: "settings" })).toEqual({
      namespace: "cflop",
      key: "settings",
    });
  });

  it("rejects a missing key", () => {
    expect(getDocumentQuerySchema.safeParse({ namespace: "cflop" }).success).toBe(false);
  });
});

describe("putDocumentBodySchema", () => {
  it("accepts namespace, key, and an arbitrary value", () => {
    expect(
      putDocumentBodySchema.parse({
        namespace: "cflop",
        key: "settings",
        value: { theme: "dark" },
      }),
    ).toEqual({
      namespace: "cflop",
      key: "settings",
      value: { theme: "dark" },
    });
  });

  it("rejects an invalid namespace even when value is present", () => {
    expect(
      putDocumentBodySchema.safeParse({
        namespace: "Bad Namespace",
        key: "settings",
        value: { theme: "dark" },
      }).success,
    ).toBe(false);
  });

  it("rejects a missing or undefined value (would persist non-JSON into a NOT NULL column)", () => {
    expect(putDocumentBodySchema.safeParse({ namespace: "cflop", key: "settings" }).success).toBe(
      false,
    );
    expect(
      putDocumentBodySchema.safeParse({
        namespace: "cflop",
        key: "settings",
        value: undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts defined falsy JSON values (null, false, 0, empty string)", () => {
    for (const value of [null, false, 0, ""]) {
      expect(
        putDocumentBodySchema.safeParse({ namespace: "cflop", key: "settings", value }).success,
      ).toBe(true);
    }
  });

  it("rejects a missing key field", () => {
    expect(
      putDocumentBodySchema.safeParse({
        namespace: "cflop",
        value: { theme: "dark" },
      }).success,
    ).toBe(false);
  });
});

describe("deleteDocumentBodySchema", () => {
  it("requires namespace and key", () => {
    expect(deleteDocumentBodySchema.parse({ namespace: "cflop", key: "settings" })).toEqual({
      namespace: "cflop",
      key: "settings",
    });
  });
});

describe("listDocumentsQuerySchema and listDocumentsResponseSchema", () => {
  it("requires a namespace on the query", () => {
    expect(listDocumentsQuerySchema.parse({ namespace: "cflop" })).toEqual({
      namespace: "cflop",
    });
    expect(listDocumentsQuerySchema.safeParse({}).success).toBe(false);
  });

  it("accepts a list of documents on the response", () => {
    const payload = {
      documents: [
        {
          namespace: "cflop",
          key: "settings",
          value: { theme: "dark" },
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ],
    };
    expect(listDocumentsResponseSchema.parse(payload)).toEqual(payload);
  });

  it("accepts an empty documents list", () => {
    expect(listDocumentsResponseSchema.parse({ documents: [] })).toEqual({ documents: [] });
  });
});

describe("deleteResultSchema", () => {
  it("accepts a boolean deleted flag", () => {
    expect(deleteResultSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(deleteResultSchema.parse({ deleted: false })).toEqual({ deleted: false });
  });

  it("rejects a non-boolean deleted flag", () => {
    expect(deleteResultSchema.safeParse({ deleted: "yes" }).success).toBe(false);
  });
});

describe("userFileMetadataSchema", () => {
  const validMetadata = {
    namespace: "cflop",
    key: "avatar.png",
    contentType: "image/png",
    size: 1024,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };

  it("accepts valid file metadata", () => {
    expect(userFileMetadataSchema.parse(validMetadata)).toEqual(validMetadata);
  });

  it("rejects a negative size", () => {
    expect(userFileMetadataSchema.safeParse({ ...validMetadata, size: -1 }).success).toBe(false);
  });

  it("rejects a non-integer size", () => {
    expect(userFileMetadataSchema.safeParse({ ...validMetadata, size: 1.5 }).success).toBe(false);
  });

  it("accepts a zero-byte size", () => {
    expect(userFileMetadataSchema.safeParse({ ...validMetadata, size: 0 }).success).toBe(true);
  });
});

describe("listFilesQuerySchema and listFilesResponseSchema", () => {
  it("requires a namespace on the query", () => {
    expect(listFilesQuerySchema.parse({ namespace: "cflop" })).toEqual({
      namespace: "cflop",
    });
    expect(listFilesQuerySchema.safeParse({}).success).toBe(false);
  });

  it("accepts a list of file metadata on the response", () => {
    const payload = {
      files: [
        {
          namespace: "cflop",
          key: "avatar.png",
          contentType: "image/png",
          size: 1024,
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      ],
    };
    expect(listFilesResponseSchema.parse(payload)).toEqual(payload);
  });
});

describe("deleteFileBodySchema", () => {
  it("requires namespace and key", () => {
    expect(deleteFileBodySchema.parse({ namespace: "cflop", key: "avatar.png" })).toEqual({
      namespace: "cflop",
      key: "avatar.png",
    });
  });
});

describe("user-data contracts", () => {
  it("getDocumentContract keeps the expected method, path, and schemas", () => {
    expect(getDocumentContract).toMatchObject({ method: "GET", path: "/me/data" });
    expect(getDocumentContract.querySchema).toBe(getDocumentQuerySchema);
    expect(getDocumentContract.responseSchema).toBe(userDocumentSchema);
    expect(getDocumentContract.bodySchema).toBeUndefined();
  });

  it("putDocumentContract keeps the expected method, path, and schemas", () => {
    expect(putDocumentContract).toMatchObject({ method: "PUT", path: "/me/data" });
    expect(putDocumentContract.bodySchema).toBe(putDocumentBodySchema);
    expect(putDocumentContract.responseSchema).toBe(userDocumentSchema);
    expect(putDocumentContract.querySchema).toBeUndefined();
  });

  it("deleteDocumentContract keeps the expected method, path, and schemas", () => {
    expect(deleteDocumentContract).toMatchObject({ method: "DELETE", path: "/me/data" });
    expect(deleteDocumentContract.bodySchema).toBe(deleteDocumentBodySchema);
    expect(deleteDocumentContract.responseSchema).toBe(deleteResultSchema);
  });

  it("listDocumentsContract keeps the expected method, path, and schemas", () => {
    expect(listDocumentsContract).toMatchObject({ method: "GET", path: "/me/data/list" });
    expect(listDocumentsContract.querySchema).toBe(listDocumentsQuerySchema);
    expect(listDocumentsContract.responseSchema).toBe(listDocumentsResponseSchema);
  });

  it("listFilesContract keeps the expected method, path, and schemas", () => {
    expect(listFilesContract).toMatchObject({ method: "GET", path: "/me/files" });
    expect(listFilesContract.querySchema).toBe(listFilesQuerySchema);
    expect(listFilesContract.responseSchema).toBe(listFilesResponseSchema);
  });

  it("deleteFileContract keeps the expected method, path, and schemas", () => {
    expect(deleteFileContract).toMatchObject({ method: "DELETE", path: "/me/files" });
    expect(deleteFileContract.bodySchema).toBe(deleteFileBodySchema);
    expect(deleteFileContract.responseSchema).toBe(deleteResultSchema);
  });
});

describe("documentValueSchema size bound", () => {
  /**
   * Builds a value whose `JSON.stringify` is exactly `byteLength` bytes.
   * `{"v":"…"}` is 8 bytes of framing around the string's contents.
   */
  function valueOfSerializedBytes(byteLength: number): { v: string } {
    return { v: "a".repeat(byteLength - 8) };
  }

  it("accepts a value exactly at the byte cap", () => {
    const value = valueOfSerializedBytes(DOCUMENT_VALUE_MAX_BYTES);

    expect(JSON.stringify(value).length).toBe(DOCUMENT_VALUE_MAX_BYTES);
    expect(documentValueSchema.safeParse(value).success).toBe(true);
  });

  it("rejects a value one byte over the cap", () => {
    const value = valueOfSerializedBytes(DOCUMENT_VALUE_MAX_BYTES + 1);

    expect(documentValueSchema.safeParse(value).success).toBe(false);
  });

  it("measures bytes rather than characters for multibyte content", () => {
    // Every "☃" is one UTF-16 code unit but three UTF-8 bytes. Just under the
    // cap by `.length`, well over it by bytes — this is the case a `.length`
    // regression would wrongly accept.
    const snowmen = "☃".repeat(DOCUMENT_VALUE_MAX_BYTES - 100);
    const serialized = JSON.stringify({ v: snowmen });

    expect(serialized.length).toBeLessThan(DOCUMENT_VALUE_MAX_BYTES);
    expect(new TextEncoder().encode(serialized).length).toBeGreaterThan(DOCUMENT_VALUE_MAX_BYTES);
    expect(documentValueSchema.safeParse({ v: snowmen }).success).toBe(false);
  });

  it("accepts a multibyte value that is under the cap in bytes", () => {
    // 1000 snowmen = 3000 bytes of content, comfortably inside the cap.
    expect(documentValueSchema.safeParse({ v: "☃".repeat(1000) }).success).toBe(true);
  });

  it("returns a validation error for a circular value rather than throwing", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    // The assertion that matters is that this does not throw.
    const result = documentValueSchema.safeParse(circular);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/circular references/u);
  });

  it("returns a validation error for values JSON.stringify drops", () => {
    // `JSON.stringify` returns undefined (rather than throwing) for these,
    // which would otherwise be written into a NOT NULL column.
    for (const value of [() => undefined, Symbol("x")]) {
      expect(documentValueSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects a BigInt, which JSON.stringify throws on", () => {
    expect(documentValueSchema.safeParse(1n).success).toBe(false);
  });

  it("still reports a missing value as required rather than as a size problem", () => {
    const result = putDocumentBodySchema.safeParse({ namespace: "cflop", key: "settings" });

    expect(result.success).toBe(false);
    // Exactly one issue: the size refinement must not also fire on a value
    // that was never supplied, or the caller gets a contradictory pair.
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.message).toMatch(/value is required/u);
  });

  it("rejects an over-cap value through putDocumentBodySchema", () => {
    expect(
      putDocumentBodySchema.safeParse({
        namespace: "cflop",
        key: "settings",
        value: valueOfSerializedBytes(DOCUMENT_VALUE_MAX_BYTES + 1),
      }).success,
    ).toBe(false);
  });

  it("leaves the stored/read shape uncapped so pre-cap rows stay readable", () => {
    // userDocumentSchema backs the response contract; capping it would turn a
    // legacy oversized row into a 500 on GET.
    expect(
      storedDocumentValueSchema.safeParse(valueOfSerializedBytes(DOCUMENT_VALUE_MAX_BYTES + 1000))
        .success,
    ).toBe(true);
    expect(
      userDocumentSchema.safeParse({
        namespace: "cflop",
        key: "settings",
        value: valueOfSerializedBytes(DOCUMENT_VALUE_MAX_BYTES + 1000),
        updatedAt: "2026-07-28 00:00:00",
      }).success,
    ).toBe(true);
  });
});
