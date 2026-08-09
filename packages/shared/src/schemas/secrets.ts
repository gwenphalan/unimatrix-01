import { z } from "zod";

/**
 * These shapes back the secrets store served by `apps/secrets` — a Fastify
 * service with its own Drizzle schema, distinct from `@unimatrix/secrets`
 * (crypto, no I/O) and from `@unimatrix/db`. The scoped read route needs a
 * `read`-capability service token; create, rotate, delete and list metadata
 * need `manage`. No route reachable by a `manage` token returns a value.
 */

/**
 * A path-like scope, e.g. `github/api-token`. The prefix before the last `/`
 * is a meaningful scope on its own — a token scoped to `github/` covers every
 * name under it — which is why segments are namespace-like rather than a free
 * string. Excludes `.`, which `packages/secrets/src/envelope.ts`'s AAD
 * reserves as its field separator.
 */
export const secretNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/);

export type SecretName = z.output<typeof secretNameSchema>;

/**
 * 8 KiB of characters, enough to hold an RSA private key PEM or a
 * service-account JSON blob. A character cap rather than the `TextEncoder`
 * byte cap `user-data.ts` uses for arbitrary JSON — a credential is ASCII in
 * every realistic case.
 */
export const SECRET_VALUE_MAX_LENGTH = 8_192;

export const secretValueSchema = z.string().min(1).max(SECRET_VALUE_MAX_LENGTH);

export type SecretPlaintext = z.output<typeof secretValueSchema>;

/**
 * The redacted display form. `SecretValue#mask()` in `@unimatrix/secrets` is
 * its only producer.
 */
export const secretMaskedPrefixSchema = z.string().min(1).max(32);

export type SecretMaskedPrefix = z.output<typeof secretMaskedPrefixSchema>;

/** Query for the scoped read route — a name and nothing else. */
export const getSecretQuerySchema = z.strictObject({
  name: secretNameSchema,
});

export type GetSecretQuery = z.output<typeof getSecretQuerySchema>;

/**
 * The one response shape in this file that carries a decrypted value.
 * `apps/secrets`' scoped read route is its only producer, and reaching it
 * needs a `read`-capability service token — nothing an admin surface can
 * call returns this shape.
 */
export const secretValueResponseSchema = z.strictObject({
  name: secretNameSchema,
  value: secretValueSchema,
});

export type SecretValueResponse = z.output<typeof secretValueResponseSchema>;

/**
 * `kekVersion` is metadata, not a value — it makes incremental rotation
 * observable (which rows still need re-sealing under the newest key) without
 * exposing anything about the plaintext. There is no `description` field.
 * `secretValueResponseSchema` above is the only shape here that carries one.
 */
export const secretMetadataSchema = z.strictObject({
  name: secretNameSchema,
  maskedPrefix: secretMaskedPrefixSchema,
  kekVersion: z.number().int().positive(),
  createdAt: z.string(),
  rotatedAt: z.string(),
});

export type SecretMetadata = z.output<typeof secretMetadataSchema>;

export const listSecretsResponseSchema = z.strictObject({
  secrets: z.array(secretMetadataSchema),
});

export type ListSecretsResponse = z.output<typeof listSecretsResponseSchema>;

/**
 * Not optional and not `z.object({}).passthrough()` — an empty
 * `strictObject` is what makes "no value under any query parameter" a
 * property of the route rather than a claim about the handler.
 */
export const listSecretsQuerySchema = z.strictObject({});

export type ListSecretsQuery = z.output<typeof listSecretsQuerySchema>;

export const createSecretBodySchema = z.strictObject({
  name: secretNameSchema,
  value: secretValueSchema,
});

export type CreateSecretBody = z.output<typeof createSecretBodySchema>;

export const rotateSecretBodySchema = z.strictObject({
  name: secretNameSchema,
  value: secretValueSchema,
});

export type RotateSecretBody = z.output<typeof rotateSecretBodySchema>;

/**
 * Cap mirrors `postIdsSchema` in `./content.ts`: bounded so one request
 * cannot sweep an unbounded number of rows, non-empty so a no-op selection
 * is a validation error rather than a silent success.
 */
export const deleteSecretsBodySchema = z.strictObject({
  names: z.array(secretNameSchema).min(1).max(100),
});

export type DeleteSecretsBody = z.output<typeof deleteSecretsBodySchema>;

// A bulk delete's result reuses `bulkResultSchema` from `./content.js`
// (already re-exported through this barrel) rather than defining a second
// schema for the same shape.
