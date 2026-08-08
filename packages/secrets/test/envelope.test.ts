import { describe, expect, it } from "vitest";

import { SecretsError } from "../src/errors.js";
import { loadSecretsKeyring, type SecretsKeyring } from "../src/keyring.js";
import { SECRET_ENVELOPE_FORMAT_VERSION } from "../src/envelope.js";
import { SecretValue } from "../src/secret-value.js";
import type { SecretContext } from "../src/envelope.js";

const KEY_1 = Buffer.alloc(32, 1).toString("base64");
const KEY_2 = Buffer.alloc(32, 2).toString("base64");

const CONTEXT: SecretContext = { name: "github/token", versionId: "v1" };

function ringWith(...entries: string[]): SecretsKeyring {
  return loadSecretsKeyring(entries.join(","));
}

function expectSecretsErrorCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SecretsError);
  expect((caught as SecretsError).code).toBe(code);
}

describe("seal / open — round trip", () => {
  const ring = ringWith(`1:${KEY_1}`);

  it.each([
    ["ASCII", "a-plain-ascii-secret"],
    ["a value containing '.' and '='", "part.one=value.two=="],
    ["multi-byte UTF-8 (emoji + combining sequence)", "🔥café́"],
    ["a 1-character value", "x"],
  ])("round-trips %s", (_label, plaintext) => {
    const envelope = ring.seal({ context: CONTEXT, value: new SecretValue(plaintext) });
    const opened = ring.open({ context: CONTEXT, envelope });
    expect(opened.reveal()).toBe(plaintext);
  });

  it("round-trips a value at SECRET_VALUE_MAX_LENGTH characters", () => {
    const SECRET_VALUE_MAX_LENGTH = 8_192;
    const plaintext = "x".repeat(SECRET_VALUE_MAX_LENGTH);
    const envelope = ring.seal({ context: CONTEXT, value: new SecretValue(plaintext) });
    expect(ring.open({ context: CONTEXT, envelope }).reveal()).toBe(plaintext);
  });

  it("round-trips an empty-string plaintext with a 0-byte ciphertext field", () => {
    const envelope = ring.seal({ context: CONTEXT, value: new SecretValue("") });
    const fields = envelope.split(".");
    expect(fields[3]).toBe("");
    expect(ring.open({ context: CONTEXT, envelope }).reveal()).toBe("");
  });

  it("produces the expected 5-field shape", () => {
    const envelope = ring.seal({ context: CONTEXT, value: new SecretValue("shape-check") });
    const fields = envelope.split(".");

    expect(fields).toHaveLength(5);
    expect(fields[0]).toBe(SECRET_ENVELOPE_FORMAT_VERSION);
    expect(fields[1]).toBe(String(ring.activeVersion));
    expect(Buffer.from(fields[2] ?? "", "base64")).toHaveLength(12);
    expect(Buffer.from(fields[4] ?? "", "base64")).toHaveLength(16);
  });
});

describe("seal — IV distinctness", () => {
  it("draws a fresh IV per call", () => {
    // This shows the IV is drawn per call from `randomBytes`; it does NOT
    // prove global non-reuse across a store's lifetime, which is a
    // probabilistic property of a 96-bit random nonce (birthday bound
    // roughly 2^32 messages under one key — far beyond what a credential
    // store approaches). "Never reused" is not an assertable claim.
    const ring = ringWith(`1:${KEY_1}`);
    const value = new SecretValue("same-plaintext-every-time");

    const envelopes = Array.from({ length: 1000 }, () => ring.seal({ context: CONTEXT, value }));
    const ivFields = envelopes.map((envelope) => envelope.split(".")[2]);

    expect(new Set(ivFields).size).toBe(1000);
    expect(new Set(envelopes).size).toBe(1000);
  });
});

describe("open — tamper detection", () => {
  const ring = ringWith(`2:${KEY_2},1:${KEY_1}`);
  const plaintext = "known-plaintext-value";
  const sealed = ring.seal({ context: CONTEXT, value: new SecretValue(plaintext) });

  function withField(envelope: string, index: number, replacement: string): string {
    const fields = envelope.split(".");
    fields[index] = replacement;
    return fields.join(".");
  }

  function flipLastByte(base64Field: string): string {
    const buffer = Buffer.from(base64Field, "base64");
    const lastIndex = buffer.length - 1;
    buffer[lastIndex] = (buffer[lastIndex] ?? 0) ^ 0xff;
    return buffer.toString("base64");
  }

  it("DECRYPT_FAILED on a flipped ciphertext byte", () => {
    const fields = sealed.split(".");
    const tampered = withField(sealed, 3, flipLastByte(fields[3] ?? ""));
    expectSecretsErrorCode(
      () => ring.open({ context: CONTEXT, envelope: tampered }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED on a flipped tag byte", () => {
    const fields = sealed.split(".");
    const tampered = withField(sealed, 4, flipLastByte(fields[4] ?? ""));
    expectSecretsErrorCode(
      () => ring.open({ context: CONTEXT, envelope: tampered }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED on a flipped IV byte", () => {
    const fields = sealed.split(".");
    const tampered = withField(sealed, 2, flipLastByte(fields[2] ?? ""));
    expectSecretsErrorCode(
      () => ring.open({ context: CONTEXT, envelope: tampered }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED when field 1 is rewritten to another version the ring holds, even under identical key bytes", () => {
    // Two versions sharing the same key bytes isolates the AAD's
    // contribution: only the version literal embedded in the AAD differs
    // between the two, so a failure here proves the KEK version header is
    // authenticated data, not a bare lookup hint that could be swapped
    // freely between resolvable versions.
    const sameKeyRing = ringWith(`2:${KEY_1}`, `1:${KEY_1}`);
    const sameKeySealed = sameKeyRing.seal({ context: CONTEXT, value: new SecretValue(plaintext) });
    const tampered = withField(sameKeySealed, 1, "1");
    expectSecretsErrorCode(
      () => sameKeyRing.open({ context: CONTEXT, envelope: tampered }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED when opened with a different name", () => {
    expectSecretsErrorCode(
      () => ring.open({ context: { ...CONTEXT, name: "github/other-token" }, envelope: sealed }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED when opened with a different versionId — the rollback case", () => {
    // The whole reason the AAD carries versionId: restoring an older
    // sealed row over the live one must fail to open, not silently decrypt
    // under the stale credential.
    expectSecretsErrorCode(
      () => ring.open({ context: { ...CONTEXT, versionId: "v2" }, envelope: sealed }),
      "DECRYPT_FAILED",
    );
  });

  it("DECRYPT_FAILED when opened with a ring holding the same version but different key bytes", () => {
    // `sealed` carries this ring's active version (2, sealed under KEY_2).
    // `otherRing` resolves version 2 too, but to different key bytes.
    const otherRing = ringWith(`2:${KEY_1}`);
    expectSecretsErrorCode(
      () => otherRing.open({ context: CONTEXT, envelope: sealed }),
      "DECRYPT_FAILED",
    );
  });

  it("ENVELOPE_MALFORMED when field 0 is rewritten to an unknown format version", () => {
    const tampered = withField(sealed, 0, "v2");
    expectSecretsErrorCode(
      () => ring.open({ context: CONTEXT, envelope: tampered }),
      "ENVELOPE_MALFORMED",
    );
  });

  it("ENVELOPE_MALFORMED on 4 fields, 6 fields, an 11-byte IV, an 8-byte tag, a malformed version field, and an empty string", () => {
    const fourFields = sealed.split(".").slice(0, 4).join(".");
    const sixFields = `${sealed}.extra`;
    const elevenByteIv = withField(sealed, 2, Buffer.alloc(11, 1).toString("base64"));
    const eightByteTag = withField(sealed, 4, Buffer.alloc(8, 1).toString("base64"));
    const malformedVersionField = withField(sealed, 1, "not-a-version");

    for (const envelope of [
      fourFields,
      sixFields,
      elevenByteIv,
      eightByteTag,
      malformedVersionField,
      "",
    ]) {
      expectSecretsErrorCode(() => ring.open({ context: CONTEXT, envelope }), "ENVELOPE_MALFORMED");
    }
  });

  it("does not surface Node's own short-tag-length message, proving the wrap is real", () => {
    const eightByteTag = withField(sealed, 4, Buffer.alloc(8, 1).toString("base64"));
    let caught: unknown;
    try {
      ring.open({ context: CONTEXT, envelope: eightByteTag });
    } catch (error) {
      caught = error;
    }
    expect((caught as SecretsError).message).not.toContain("Invalid authentication tag length");
  });

  it("ENVELOPE_UNKNOWN_KEK when the version is not in the ring", () => {
    const smallRing = ringWith(`1:${KEY_1}`);
    const otherSealed = ringWith(`5:${KEY_2}`).seal({
      context: CONTEXT,
      value: new SecretValue(plaintext),
    });
    expectSecretsErrorCode(
      () => smallRing.open({ context: CONTEXT, envelope: otherSealed }),
      "ENVELOPE_UNKNOWN_KEK",
    );
  });

  it("releases no plaintext on a failed open — message and stack contain neither the plaintext nor a prefix of it", () => {
    let caught: unknown;
    try {
      ring.open({ context: { ...CONTEXT, name: "wrong-name" }, envelope: sealed });
    } catch (error) {
      caught = error;
    }

    const secretsError = caught as SecretsError;
    // Prefixes shorter than this are indistinguishable from coincidence —
    // `stack` also carries this repo's own file paths (e.g. "packages"),
    // which contain almost every letter of the alphabet on their own. A
    // meaningful leak check needs a prefix long enough that a match could
    // only come from the plaintext itself.
    const MEANINGFUL_PREFIX_LENGTH = 6;
    for (
      let prefixLength = MEANINGFUL_PREFIX_LENGTH;
      prefixLength <= plaintext.length;
      prefixLength += 1
    ) {
      const prefix = plaintext.slice(0, prefixLength);
      expect(secretsError.message).not.toContain(prefix);
      expect(secretsError.stack ?? "").not.toContain(prefix);
    }
  });
});

describe("CONTEXT_INVALID", () => {
  const ring = ringWith(`1:${KEY_1}`);
  const value = new SecretValue("v");

  it.each([
    ["empty name", { name: "", versionId: "v1" }],
    ["empty versionId", { name: "n", versionId: "" }],
    ["whitespace-only name", { name: "   ", versionId: "v1" }],
    ["whitespace-only versionId", { name: "n", versionId: "   " }],
    ["a '.' in name", { name: "a.b", versionId: "v1" }],
    ["a '.' in versionId", { name: "n", versionId: "v.1" }],
  ])("rejects %s", (_label, context) => {
    expectSecretsErrorCode(() => ring.seal({ context, value }), "CONTEXT_INVALID");
  });
});
