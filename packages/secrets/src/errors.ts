/**
 * Every failure mode this package can raise. HTTP status mapping is not this
 * package's concern — that belongs to `apps/secrets`, which wraps it.
 */
export type SecretsErrorCode =
  | "KEK_MISSING"
  | "KEK_MALFORMED"
  | "KEK_LENGTH"
  | "KEK_DUPLICATE_VERSION"
  | "KEK_NOT_NEWEST"
  | "ENVELOPE_MALFORMED"
  | "ENVELOPE_UNKNOWN_KEK"
  | "DECRYPT_FAILED"
  | "CONTEXT_INVALID";

interface SecretsErrorOptions {
  readonly code: SecretsErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Thrown by every public entry point in this package. `message` must never
 * contain key material, plaintext, or ciphertext field contents — callers
 * (eventually a log line) are expected to surface it as-is.
 */
export class SecretsError extends Error {
  readonly code: SecretsErrorCode;

  constructor(options: SecretsErrorOptions) {
    super(options.message);

    this.name = "SecretsError";
    this.code = options.code;

    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}
