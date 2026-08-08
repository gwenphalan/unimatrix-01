import { inspect, format } from "node:util";

import { describe, expect, it } from "vitest";

import { SecretsError } from "../src/errors.js";
import { loadSecretsKeyring } from "../src/keyring.js";

const KEY_1 = Buffer.alloc(32, 1).toString("base64");
const KEY_2 = Buffer.alloc(32, 2).toString("base64");
const KEY_3 = Buffer.alloc(32, 3).toString("base64");

function hexOfFirst8Bytes(base64Key: string): string {
  return Buffer.from(base64Key, "base64").subarray(0, 8).toString("hex");
}

describe("loadSecretsKeyring — activeVersion and versions", () => {
  it("reports the sole version for a single-entry ring", () => {
    const ring = loadSecretsKeyring(`1:${KEY_1}`);
    expect(ring.activeVersion).toBe(1);
    expect(ring.versions).toEqual([1]);
  });

  it("treats the first-listed entry as active when it is also the highest version", () => {
    const ring = loadSecretsKeyring(`3:${KEY_3},2:${KEY_2},1:${KEY_1}`);
    expect(ring.activeVersion).toBe(3);
    expect(ring.versions).toEqual([3, 2, 1]);
  });
});

describe("loadSecretsKeyring — error codes", () => {
  it("KEK_MISSING on undefined, empty, and whitespace-only input", () => {
    for (const input of [undefined, "", "   "]) {
      expect(() => loadSecretsKeyring(input)).toThrowError(
        expect.objectContaining({ code: "KEK_MISSING" }),
      );
    }
  });

  it("KEK_MALFORMED on an entry that does not match `<version>:<base64key>`", () => {
    for (const input of ["nope", "1-abc", ":abc", "1:", "01:abc"]) {
      expect(() => loadSecretsKeyring(input)).toThrowError(
        expect.objectContaining({ code: "KEK_MALFORMED" }),
      );
    }
  });

  it("KEK_LENGTH on a well-formed-base64 16-byte key", () => {
    const shortKey = Buffer.alloc(16, 1).toString("base64");
    expect(() => loadSecretsKeyring(`1:${shortKey}`)).toThrowError(
      expect.objectContaining({ code: "KEK_LENGTH" }),
    );
  });

  it("KEK_LENGTH — not KEK_MALFORMED — on an input that base64-decodes to 8 bytes", () => {
    // Pins Node's lenient base64 decoding: this string passes the lexical
    // regex (alphabet-only) but decodes to fewer than 32 bytes.
    const eightByteDecoding = Buffer.alloc(8, 1).toString("base64");
    let caught: unknown;
    try {
      loadSecretsKeyring(`1:${eightByteDecoding}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretsError);
    expect((caught as SecretsError).code).toBe("KEK_LENGTH");
  });

  it("KEK_DUPLICATE_VERSION when a version appears twice", () => {
    expect(() => loadSecretsKeyring(`1:${KEY_1},1:${KEY_2}`)).toThrowError(
      expect.objectContaining({ code: "KEK_DUPLICATE_VERSION" }),
    );
  });

  it("KEK_NOT_NEWEST when the first-listed version is not the highest present", () => {
    expect(() => loadSecretsKeyring(`1:${KEY_1},2:${KEY_2}`)).toThrowError(
      expect.objectContaining({ code: "KEK_NOT_NEWEST" }),
    );
  });

  it("names both versions in the KEK_NOT_NEWEST message", () => {
    let caught: unknown;
    try {
      loadSecretsKeyring(`1:${KEY_1},2:${KEY_2}`);
    } catch (error) {
      caught = error;
    }
    const message = (caught as SecretsError).message;
    expect(message).toContain("1");
    expect(message).toContain("2");
  });
});

describe("SecretsKeyring — key material never escapes", () => {
  it("never appears in string coercion, JSON, or inspection of the ring", () => {
    const ring = loadSecretsKeyring(`2:${KEY_2},1:${KEY_1}`);
    const key1Hex = hexOfFirst8Bytes(KEY_1);
    const key2Hex = hexOfFirst8Bytes(KEY_2);

    const renderings = [
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- exercising the same coercion path a real log call would take
      `${ring}`,
      String(ring),
      JSON.stringify({ ring }),
      inspect(ring, { depth: null, showHidden: true }),
      format("%o", ring),
    ];

    for (const rendered of renderings) {
      expect(rendered).not.toContain(KEY_1);
      expect(rendered).not.toContain(KEY_2);
      expect(rendered).not.toContain(key1Hex);
      expect(rendered).not.toContain(key2Hex);
    }
  });

  it("exposes no own property carrying key material", () => {
    const ring = loadSecretsKeyring(`1:${KEY_1}`);
    const propertyNames = Object.getOwnPropertyNames(ring);

    for (const propertyName of propertyNames) {
      const descriptor = Object.getOwnPropertyDescriptor(ring, propertyName);
      expect(JSON.stringify(descriptor)).not.toContain(KEY_1);
    }
  });
});
