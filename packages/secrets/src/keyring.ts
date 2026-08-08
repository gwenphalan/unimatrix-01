import { createSecretKey, type KeyObject } from "node:crypto";

import { openSecretEnvelope, sealSecretEnvelope, type SecretContext } from "./envelope.js";
import { SecretsError } from "./errors.js";
import type { SecretValue } from "./secret-value.js";

/** `<version>:<base64key>`. */
const KEK_ENTRY_PATTERN = /^([1-9][0-9]{0,3}):([A-Za-z0-9+/]+={0,2})$/;
const KEK_KEY_BYTE_LENGTH = 32;
const KEK_ENTRY_SEPARATOR = ",";

interface ParsedKekEntry {
  readonly version: number;
  readonly key: KeyObject;
}

/**
 * Splits and validates every `<version>:<base64key>` entry. Lexical
 * validation (the regex) runs before decoding on purpose — measured:
 * `Buffer.from("not a real key!!!!", "base64")` returns 8 bytes instead of
 * throwing, because Node's decoder silently skips non-alphabet characters.
 * Decoding first would let prose that was never a key reach `KEK_LENGTH` as
 * a plausible-looking length complaint instead of failing as
 * `KEK_MALFORMED`, which is what it actually is.
 */
function parseKeks(encodedKeys: string): ParsedKekEntry[] {
  const entries: ParsedKekEntry[] = [];
  const seenVersions = new Set<number>();

  for (const rawEntry of encodedKeys.split(KEK_ENTRY_SEPARATOR)) {
    const match = KEK_ENTRY_PATTERN.exec(rawEntry);
    if (match === null) {
      throw new SecretsError({
        code: "KEK_MALFORMED",
        message: "SECRETS_KEKS entries must match `<version>:<base64key>`.",
      });
    }

    const versionField = match[1] ?? "";
    const keyField = match[2] ?? "";
    const version = Number(versionField);
    const keyBuffer = Buffer.from(keyField, "base64");

    if (keyBuffer.length !== KEK_KEY_BYTE_LENGTH) {
      throw new SecretsError({
        code: "KEK_LENGTH",
        message: `KEK version ${version} decodes to ${keyBuffer.length} bytes; expected ${KEK_KEY_BYTE_LENGTH}.`,
      });
    }

    if (seenVersions.has(version)) {
      throw new SecretsError({
        code: "KEK_DUPLICATE_VERSION",
        message: `KEK version ${version} appears more than once.`,
      });
    }
    seenVersions.add(version);

    entries.push({ version, key: createSecretKey(keyBuffer) });
  }

  return entries;
}

/**
 * A loaded, validated set of key-encryption keys. Every entry can open;
 * only `activeVersion` seals new envelopes. `seal`/`open` are methods here
 * rather than free functions taking the ring as an argument — `#private` is
 * class-scoped, so a free `sealSecretValue(keyring, value)` in a sibling
 * module would force the key material to be a public property, one
 * `JSON.stringify(config)` away from a log aggregator.
 */
export class SecretsKeyring {
  readonly #activeVersion: number;
  readonly #keys: Map<number, KeyObject>;

  /**
   * Private: `#keys` and `#activeVersion` can only be built together, by
   * {@link SecretsKeyring.load}, which is the only place `SECRETS_KEKS`
   * validation runs. That is what makes `seal()`'s lookup of the active key
   * provably safe rather than merely documented as safe — `new
   * SecretsKeyring(5, new Map())` is not reachable from outside this file.
   */
  private constructor(activeVersion: number, keys: Map<number, KeyObject>) {
    this.#activeVersion = activeVersion;
    this.#keys = keys;
  }

  /**
   * The package never reads `process.env` itself — the encoded string is
   * always an argument, same rule as `packages/auth`. There is no "boot"
   * here: this throws, and a future `apps/secrets` turns that into a failed
   * start.
   */
  static load(encodedKeys: string | undefined): SecretsKeyring {
    if (encodedKeys === undefined || encodedKeys.trim().length === 0) {
      throw new SecretsError({ code: "KEK_MISSING", message: "No KEK material was provided." });
    }

    const entries = parseKeks(encodedKeys);
    const keys = new Map(entries.map((entry) => [entry.version, entry.key]));

    let activeVersion = 0;
    let highestVersion = 0;
    let isFirstEntry = true;

    for (const entry of entries) {
      if (isFirstEntry) {
        activeVersion = entry.version;
        isFirstEntry = false;
      }

      if (entry.version > highestVersion) {
        highestVersion = entry.version;
      }
    }

    // The active (first-listed) key otherwise decides which key seals new
    // writes by paste order in an env var, and nothing observes it — so an
    // env var written in ascending order (the order a human sorts into)
    // would silently seal every new write under the *older* key. Requiring
    // the active version to be the highest present makes that misordering a
    // load error instead of a silent downgrade.
    if (activeVersion !== highestVersion) {
      throw new SecretsError({
        code: "KEK_NOT_NEWEST",
        message: `The active KEK (version ${activeVersion}, listed first) is not the highest version present (version ${highestVersion}). Put the highest version first.`,
      });
    }

    return new SecretsKeyring(activeVersion, keys);
  }

  get activeVersion(): number {
    return this.#activeVersion;
  }

  get versions(): readonly number[] {
    return [...this.#keys.keys()];
  }

  seal(options: { context: SecretContext; value: SecretValue }): string {
    // The constructor is private, so `#keys` and `#activeVersion` can only
    // be built together by `static load` — this key is always present, an
    // invariant no external input can violate, and so not a case
    // `noUncheckedIndexedAccess`'s usual "destructure and narrow" guidance
    // can be tested against.
    const activeKey = this.#keys.get(this.#activeVersion)!;

    return sealSecretEnvelope({
      key: activeKey,
      kekVersion: this.#activeVersion,
      context: options.context,
      value: options.value,
    });
  }

  open(options: { context: SecretContext; envelope: string }): SecretValue {
    return openSecretEnvelope({
      resolveKey: (version) => this.#keys.get(version),
      context: options.context,
      envelope: options.envelope,
    });
  }

  toString(): string {
    return "[REDACTED keyring]";
  }

  toJSON(): string {
    return "[REDACTED keyring]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[REDACTED keyring]";
  }
}

export function loadSecretsKeyring(encodedKeys: string | undefined): SecretsKeyring {
  return SecretsKeyring.load(encodedKeys);
}
