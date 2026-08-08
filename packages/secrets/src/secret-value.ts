const REDACTED = "[REDACTED]";

/**
 * Same censor string as `apps/api/src/lib/http/logging.ts`'s pino `redact`
 * config. Two spellings of "redacted" in one log stream is the drift this
 * avoids.
 */
const MASK_WIDTH = 12;
const MASK_PREFIX_LENGTH = 4;
const MASK_STAR_COUNT = MASK_WIDTH - MASK_PREFIX_LENGTH;

/**
 * A plaintext secret value that refuses to serialize itself. `reveal()` is
 * the only way out, so every call site that needs the raw value is
 * greppable. Backed by a `#private` field: `Object.keys`, a spread, and
 * `structuredClone` all reach nothing (measured against this class).
 *
 * A JS string cannot be zeroized, so this bounds accidental disclosure
 * through logs and serialization, not memory-scraping.
 */
export class SecretValue {
  readonly #plaintext: string;

  constructor(plaintext: string) {
    this.#plaintext = plaintext;
  }

  reveal(): string {
    return this.#plaintext;
  }

  /**
   * Fixed-width mask so the output never leaks the value's length. The
   * width (12) is duplicated as `.max()` on `secretMaskedPrefixSchema` in
   * `packages/shared/src/schemas/secrets.ts` — the two packages deliberately
   * cannot import each other, so keep both in sync by hand if this changes.
   */
  mask(): string {
    if (this.#plaintext.length >= MASK_WIDTH) {
      return this.#plaintext.slice(0, MASK_PREFIX_LENGTH) + "*".repeat(MASK_STAR_COUNT);
    }

    return "*".repeat(MASK_WIDTH);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
