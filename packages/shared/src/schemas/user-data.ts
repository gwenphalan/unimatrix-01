import { z } from "zod";

/**
 * `TextEncoder` is a standard global in both Node and the browser, but this
 * package's `lib` is `["ES2023"]` with no DOM and no `@types/node` — on
 * purpose, since it is consumed from both. Declaring the one member used here
 * keeps the byte measurement typed without widening `lib` to DOM, which would
 * also make `window`/`document` typecheck in a package that must stay
 * environment-agnostic.
 *
 * Module-scoped rather than `declare global`, so nothing leaks into consumers.
 * `tsconfig.json` would typecheck without this: its `include` carries
 * `vitest.config.ts`, and vite's types pull `@types/node` into that program.
 * `tsconfig.build.json` compiles `src` only and does not include
 * `vitest.config.ts`, which is the configuration that matters.
 */
declare const TextEncoder: {
  new (): { encode(input: string): { length: number } };
};

/**
 * A namespace groups a user's documents/files into a logical bucket (for
 * example, a service or feature slug). Kept as a lowercase, hyphenated slug
 * so it is safe to use as a path segment or storage key component.
 */
export const dataNamespaceSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export type DataNamespace = z.output<typeof dataNamespaceSchema>;

/**
 * A key identifies a single document/file within a namespace.
 */
export const dataKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export type DataKey = z.output<typeof dataKeySchema>;

/**
 * The largest a single document value may be once serialized.
 *
 * Deliberately the same number as `CONTENT_BODY_MAX_LENGTH` (262_144), but
 * **the unit differs**: that one is a character cap on a markdown string,
 * this is a byte cap on the UTF-8 encoding of `JSON.stringify(value)`.
 * Measuring characters here would let a payload of three-byte characters
 * store roughly 3x the nominal cap, so the number would not mean what it
 * says. This is the per-request bound; the cumulative per-user bound lives
 * server-side (see `MAX_USER_STORAGE_BYTES` in `apps/api`).
 */
export const DOCUMENT_VALUE_MAX_BYTES = 262_144;

/**
 * Serialized byte length of `value`, or `null` when it cannot be persisted
 * as JSON at all.
 *
 * `JSON.stringify` fails in two different ways and both have to become a
 * validation error rather than a 500: it *throws* on a circular structure
 * (and on `BigInt`), and it *returns `undefined`* for a function, a symbol,
 * or `undefined` itself — which would then be written into a NOT NULL
 * column.
 *
 * `TextEncoder` rather than `Buffer.byteLength`: this package is bundled
 * into browser code (`apps/web` imports it), where `Buffer` does not exist.
 * `TextEncoder` is a standard global in both Node and the browser. A
 * typecheck passing on `Buffer` here proves nothing — see the `TextEncoder`
 * declaration at the top of this file for why `@types/node` is visible.
 */
function serializedJsonByteLength(value: unknown): number | null {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }

  if (serialized === undefined) {
    return null;
  }

  return new TextEncoder().encode(serialized).length;
}

/**
 * A document's JSON value as it comes *back out* of storage. Rejects
 * `undefined` — and a missing `value` property, since this is not
 * `z.unknown()`/`z.any()` (which Zod treats as optional) — so the API
 * returns a validation error instead of persisting
 * `JSON.stringify(undefined)` into a NOT NULL column. The output type stays
 * `unknown` so callers can store any JSON value without friction.
 *
 * Deliberately **not** byte-capped, unlike {@link documentValueSchema}. This
 * schema backs the read/response shape, and rows written before the cap
 * existed may exceed it — a cap here would turn those into a 500 on GET and
 * leave the owner unable to read their own data. A size limit is a rule
 * about what may be written, not a description of what is stored.
 */
export const storedDocumentValueSchema = z.custom<unknown>((value) => value !== undefined, {
  message: "value is required and must be a defined JSON value.",
});

export type StoredDocumentValue = z.output<typeof storedDocumentValueSchema>;

/**
 * A document's JSON value at the write boundary: everything
 * {@link storedDocumentValueSchema} requires, plus a
 * {@link DOCUMENT_VALUE_MAX_BYTES} ceiling on its serialized size.
 *
 * The size bound is a `superRefine` rather than a `.max()` because
 * `z.custom` has no length to cap — the predicate has to serialize the
 * value and measure it. Zod skips the refinement when the `z.custom` check
 * above it already failed, so the "required" message is never doubled up.
 */
export const documentValueSchema = storedDocumentValueSchema.superRefine((value, ctx) => {
  const byteLength = serializedJsonByteLength(value);

  if (byteLength === null) {
    ctx.addIssue({
      code: "custom",
      message:
        "value must be JSON-serializable; circular references and non-JSON values are not supported.",
    });

    return;
  }

  if (byteLength > DOCUMENT_VALUE_MAX_BYTES) {
    ctx.addIssue({
      code: "custom",
      message: `value must serialize to at most ${DOCUMENT_VALUE_MAX_BYTES} bytes of JSON. Received ${byteLength} bytes.`,
    });
  }
});

export type DocumentValue = z.output<typeof documentValueSchema>;

export const userDocumentSchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
  value: storedDocumentValueSchema,
  updatedAt: z.string(),
});

export type UserDocument = z.output<typeof userDocumentSchema>;

export const getDocumentQuerySchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
});

export type GetDocumentQuery = z.output<typeof getDocumentQuerySchema>;

export const putDocumentBodySchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
  value: documentValueSchema,
});

export type PutDocumentBody = z.output<typeof putDocumentBodySchema>;

export const deleteDocumentBodySchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
});

export type DeleteDocumentBody = z.output<typeof deleteDocumentBodySchema>;

export const listDocumentsQuerySchema = z.strictObject({
  namespace: dataNamespaceSchema,
});

export type ListDocumentsQuery = z.output<typeof listDocumentsQuerySchema>;

export const listDocumentsResponseSchema = z.strictObject({
  documents: z.array(userDocumentSchema),
});

export type ListDocumentsResponse = z.output<typeof listDocumentsResponseSchema>;

export const deleteResultSchema = z.strictObject({
  deleted: z.boolean(),
});

export type DeleteResult = z.output<typeof deleteResultSchema>;

export const userFileMetadataSchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export type UserFileMetadata = z.output<typeof userFileMetadataSchema>;

export const listFilesQuerySchema = z.strictObject({
  namespace: dataNamespaceSchema,
});

export type ListFilesQuery = z.output<typeof listFilesQuerySchema>;

export const listFilesResponseSchema = z.strictObject({
  files: z.array(userFileMetadataSchema),
});

export type ListFilesResponse = z.output<typeof listFilesResponseSchema>;

export const deleteFileBodySchema = z.strictObject({
  namespace: dataNamespaceSchema,
  key: dataKeySchema,
});

export type DeleteFileBody = z.output<typeof deleteFileBodySchema>;
