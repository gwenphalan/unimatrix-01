import { z } from "zod";

/**
 * These shapes back a secrets store that does not exist yet — `@unimatrix/secrets`
 * (crypto, no I/O) has no persistence layer or routes behind it. Which service
 * serves them (`apps/api` proxying, or `apps/admin` gaining its own backend) is
 * an open question the routes item decides; committing paths now would bet on
 * an undecided question, so only shapes ship here.
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

export type SecretValue = z.output<typeof secretValueSchema>;

/**
 * The redacted display form. `SecretValue#mask()` in `@unimatrix/secrets` is
 * its only producer and always returns exactly 12 characters — the two
 * packages deliberately cannot import each other, so keep both in sync by
 * hand if that width changes.
 */
export const secretMaskedPrefixSchema = z.string().min(1).max(32);

export type SecretMaskedPrefix = z.output<typeof secretMaskedPrefixSchema>;

/**
 * `kekVersion` is metadata, not a value — it makes incremental rotation
 * observable (which rows still need re-sealing under the newest key) without
 * exposing anything about the plaintext. There is no `description` field and
 * no shape for reading a value back over a browser session; the absence is
 * the security property.
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
