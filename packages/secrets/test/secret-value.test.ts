import { inspect, format } from "node:util";

import { describe, expect, it } from "vitest";

import { SecretValue } from "../src/secret-value.js";

const PLAINTEXT_TRAILING_WHITESPACE = "trailing-whitespace-value   ";
const PLAINTEXT_MULTIBYTE = "🔥café́"; // emoji + "café" with a combining accent

describe("SecretValue#reveal", () => {
  it("returns the exact plaintext, including trailing whitespace and multi-byte characters", () => {
    expect(new SecretValue(PLAINTEXT_TRAILING_WHITESPACE).reveal()).toBe(
      PLAINTEXT_TRAILING_WHITESPACE,
    );
    expect(new SecretValue(PLAINTEXT_MULTIBYTE).reveal()).toBe(PLAINTEXT_MULTIBYTE);
  });
});

describe("SecretValue#mask", () => {
  it("shows a 4-character prefix plus 8 stars for values 12 characters or longer", () => {
    expect(new SecretValue("ghp_1234567890").mask()).toBe("ghp_********");
  });

  it("masks fully for values shorter than 12 characters, including empty", () => {
    expect(new SecretValue("short").mask()).toBe("************");
    expect(new SecretValue("").mask()).toBe("************");
  });

  it("produces a mask of identical length for a 12-character and a 4096-character value", () => {
    const twelveChars = "a".repeat(12);
    const fourThousandChars = "b".repeat(4096);

    expect(new SecretValue(twelveChars).mask().length).toBe(12);
    expect(new SecretValue(fourThousandChars).mask().length).toBe(12);
    expect(new SecretValue(twelveChars).mask().length).toBe(
      new SecretValue(fourThousandChars).mask().length,
    );
  });
});

describe("SecretValue redaction", () => {
  const plaintext = "hunter2-super-secret";
  const value = new SecretValue(plaintext);

  function assertRedacted(rendered: string): void {
    expect(rendered).not.toContain(plaintext);
    expect(rendered).toContain("[REDACTED]");
  }

  it("never leaks the plaintext through any serialization or inspection path", () => {
    // This test exists to prove `SecretValue` coerces safely everywhere a
    // real value could reach a log line, including the exact stringification
    // paths the linter otherwise (correctly) flags as unsafe for an
    // arbitrary type.
    /* eslint-disable @typescript-eslint/restrict-template-expressions, @typescript-eslint/restrict-plus-operands */
    assertRedacted(`${value}`);
    assertRedacted(String(value));
    assertRedacted(value + "");
    assertRedacted(JSON.stringify({ v: value }));
    assertRedacted(JSON.stringify([value]));
    assertRedacted(inspect(value));
    assertRedacted(inspect({ v: value }, { depth: null, showHidden: true }));
    assertRedacted(format("%s", value));
    assertRedacted(format("%o", value));
    assertRedacted(format("%j", value));
    assertRedacted(new Error(`x ${value}`).message);
    assertRedacted(inspect(new Error("x", { cause: value })));
    /* eslint-enable @typescript-eslint/restrict-template-expressions, @typescript-eslint/restrict-plus-operands */
  });

  it("exposes no field carrying the plaintext through property or clone introspection", () => {
    expect(Object.getOwnPropertyNames(value)).not.toContain(plaintext);
    for (const propertyName of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
      expect(JSON.stringify(descriptor)).not.toContain(plaintext);
    }

    expect(Object.entries(value)).toEqual([]);

    const cloned = structuredClone(value);
    expect(JSON.stringify(Object.getOwnPropertyNames(cloned))).not.toContain(plaintext);
    expect(cloned).not.toHaveProperty("reveal");
  });
});
