import { createHash, randomBytes } from "node:crypto";

const SERVICE_TOKEN_ENTROPY_BYTES = 32;

/**
 * 256 random bits, base64url-encoded behind a `usk_` prefix — 47 characters.
 * The prefix is not decoration: it makes a leaked token greppable in a log or a
 * paste, and gives secret scanning something to match. No checksum suffix —
 * those exist for scanning services that do not reach a private store.
 */
export function generateServiceToken(): string {
  return `usk_${randomBytes(SERVICE_TOKEN_ENTROPY_BYTES).toString("base64url")}`;
}

const SERVICE_TOKEN_SHAPE = /^usk_[A-Za-z0-9_-]{43}$/u;

/** Checked before any hashing or database work, so a malformed header costs nothing. */
export function isServiceTokenShape(value: string): boolean {
  return SERVICE_TOKEN_SHAPE.test(value);
}

/**
 * SHA-256 hex, with no salt, pepper or KDF. That is the opposite of what a
 * password needs, and deliberately so:
 *
 * - A password gets a slow KDF because it carries ~30 bits of entropy and is
 *   guessable. {@link generateServiceToken} emits 256 bits, so offline brute
 *   force of the digest is arithmetic that does not close.
 * - A salted digest cannot be looked up. `service_tokens.token_hash` is the
 *   lookup key (see `../db/schema/service-tokens.ts`), and only a deterministic
 *   digest makes that index work — the alternative is a scan-and-verify over
 *   every row.
 * - The guard runs before any route match, so a memory-hard KDF would put tens
 *   of milliseconds of work in front of every unauthenticated request,
 *   including the unmatched ones the not-found limiter only bounds per IP.
 *
 * No `timingSafeEqual` either: the comparison is a B-tree lookup on a digest,
 * which an attacker cannot walk without already holding a preimage.
 */
export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
