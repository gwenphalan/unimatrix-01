import { createCipheriv, createDecipheriv, randomBytes, type KeyObject } from "node:crypto";

import { SecretsError } from "./errors.js";
import { SecretValue } from "./secret-value.js";

/**
 * The GCM literal type, not `: string` — verified against this repo's
 * tsconfig: annotating this `string` fails `TS2769` because the literal type
 * is what selects `createCipheriv`/`createDecipheriv`'s GCM-specific
 * overload (the one carrying `setAAD`/`getAuthTag`). A convenience note, not
 * a trap: the wrong annotation fails to compile.
 */
const ALGORITHM = "aes-256-gcm";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FIELD_SEPARATOR = ".";
const ENVELOPE_FIELD_COUNT = 5;

const KEK_VERSION_FIELD_PATTERN = /^[1-9][0-9]{0,3}$/;

export const SECRET_ENVELOPE_FORMAT_VERSION = "v1";

/**
 * What a sealed value is bound to. Both fields are authenticated as part of
 * the envelope's AAD (see `buildAad`), so `open` must be given the identical
 * context or the GCM tag fails to verify — copying one secret's ciphertext
 * onto another's row, or restoring a superseded version over the live row,
 * both fail to open rather than silently succeeding.
 */
export interface SecretContext {
  readonly name: string;
  readonly versionId: string;
}

function assertValidContext(context: SecretContext): void {
  if (context.name.trim().length === 0) {
    throw new SecretsError({ code: "CONTEXT_INVALID", message: "context.name must not be empty." });
  }

  if (context.versionId.trim().length === 0) {
    throw new SecretsError({
      code: "CONTEXT_INVALID",
      message: "context.versionId must not be empty.",
    });
  }

  if (context.name.includes(FIELD_SEPARATOR)) {
    throw new SecretsError({
      code: "CONTEXT_INVALID",
      message: "context.name must not contain the envelope field separator '.'.",
    });
  }

  if (context.versionId.includes(FIELD_SEPARATOR)) {
    throw new SecretsError({
      code: "CONTEXT_INVALID",
      message: "context.versionId must not contain the envelope field separator '.'.",
    });
  }
}

/**
 * Binds the KEK version and the context into the ciphertext's authentication
 * tag without encrypting them. Three properties fall out: the stored KEK
 * version is authenticated rather than an attacker-steerable lookup hint;
 * copying one secret's ciphertext onto another's row fails to open; and
 * restoring a superseded version over the live row fails to open, because
 * `versionId` — not just `name` — is bound in. This granularity is fixed
 * once the first row is sealed under it; changing it requires re-encrypting
 * the whole store.
 */
function buildAad(kekVersion: number, context: SecretContext): Buffer {
  return Buffer.from(
    `${SECRET_ENVELOPE_FORMAT_VERSION}.${kekVersion}.${context.name}.${context.versionId}`,
    "utf8",
  );
}

export function sealSecretEnvelope(options: {
  key: KeyObject;
  kekVersion: number;
  context: SecretContext;
  value: SecretValue;
}): string {
  assertValidContext(options.context);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, options.key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(buildAad(options.kekVersion, options.context));

  const ciphertext = Buffer.concat([cipher.update(options.value.reveal(), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_ENVELOPE_FORMAT_VERSION,
    String(options.kekVersion),
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(FIELD_SEPARATOR);
}

export function openSecretEnvelope(options: {
  resolveKey: (kekVersion: number) => KeyObject | undefined;
  context: SecretContext;
  envelope: string;
}): SecretValue {
  assertValidContext(options.context);

  const rawFields = options.envelope.split(FIELD_SEPARATOR);
  if (rawFields.length !== ENVELOPE_FIELD_COUNT) {
    throw new SecretsError({
      code: "ENVELOPE_MALFORMED",
      message: `Envelope must have ${ENVELOPE_FIELD_COUNT} dot-separated fields.`,
    });
  }

  const [formatVersionRaw, kekVersionRaw, ivRaw, ciphertextRaw, tagRaw] = rawFields;
  const formatVersion = formatVersionRaw ?? "";
  const kekVersionField = kekVersionRaw ?? "";
  const ivField = ivRaw ?? "";
  const ciphertextField = ciphertextRaw ?? "";
  const tagField = tagRaw ?? "";

  if (formatVersion !== SECRET_ENVELOPE_FORMAT_VERSION) {
    throw new SecretsError({
      code: "ENVELOPE_MALFORMED",
      message: `Envelope format version must be "${SECRET_ENVELOPE_FORMAT_VERSION}".`,
    });
  }

  if (!KEK_VERSION_FIELD_PATTERN.test(kekVersionField)) {
    throw new SecretsError({
      code: "ENVELOPE_MALFORMED",
      message: "Envelope KEK version field is malformed.",
    });
  }

  const kekVersion = Number(kekVersionField);

  const iv = Buffer.from(ivField, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new SecretsError({
      code: "ENVELOPE_MALFORMED",
      message: `Envelope IV must decode to ${IV_LENGTH} bytes.`,
    });
  }

  const ciphertext = Buffer.from(ciphertextField, "base64");

  const tag = Buffer.from(tagField, "base64");
  if (tag.length !== TAG_LENGTH) {
    throw new SecretsError({
      code: "ENVELOPE_MALFORMED",
      message: `Envelope tag must decode to ${TAG_LENGTH} bytes.`,
    });
  }

  const key = options.resolveKey(kekVersion);
  if (key === undefined) {
    throw new SecretsError({
      code: "ENVELOPE_UNKNOWN_KEK",
      message: `No KEK is loaded for version ${kekVersion}.`,
    });
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAAD(buildAad(kekVersion, options.context));
  decipher.setAuthTag(tag);

  try {
    // `decipher.update()` returns the full decrypted plaintext *before* the
    // GCM tag is checked — verified against this Node build, where a wrong
    // AAD still returns the plaintext from `update()` and only `final()`
    // throws. Decrypting as one expression means the throw aborts before
    // any unverified plaintext is ever bound to a variable; never split this
    // into a separate `update()` statement followed by a try around
    // `final()`, and never log, inspect, or return `update()`'s output on a
    // failure path.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new SecretValue(plaintext.toString("utf8"));
  } catch (cause) {
    throw new SecretsError({
      code: "DECRYPT_FAILED",
      message: "Envelope failed authentication or decryption.",
      cause,
    });
  }
}
