import { createSecretKey } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sealSecretEnvelope, type SecretContext } from "../src/envelope.js";
import { SecretsError, type SecretsErrorCode } from "../src/errors.js";
import { loadSecretsKeyring } from "../src/keyring.js";
import { SecretValue } from "../src/secret-value.js";

const KNOWN_PLAINTEXT = "s3cr3t-plaintext-value";
const KNOWN_KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY_BASE64 = Buffer.alloc(32, 9).toString("base64");
const CONTEXT: SecretContext = { name: "github/token", versionId: "v1" };

function assertSecretsError(fn: () => unknown, code: SecretsErrorCode): SecretsError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretsError);
    const secretsError = error as SecretsError;
    expect(secretsError.name).toBe("SecretsError");
    expect(secretsError.code).toBe(code);
    return secretsError;
  }

  throw new Error(`Expected fn to throw a SecretsError with code ${code}`);
}

function assertNoLeak(error: SecretsError): void {
  expect(error.message).not.toContain(KNOWN_PLAINTEXT);
  expect(error.message).not.toContain(KNOWN_KEY_BASE64);
  expect(error.stack ?? "").not.toContain(KNOWN_PLAINTEXT);
  expect(error.stack ?? "").not.toContain(KNOWN_KEY_BASE64);
}

describe("SecretsError", () => {
  it("is reachable and leak-free for every failure code", () => {
    assertNoLeak(assertSecretsError(() => loadSecretsKeyring(undefined), "KEK_MISSING"));
    assertNoLeak(assertSecretsError(() => loadSecretsKeyring("   "), "KEK_MISSING"));

    assertNoLeak(assertSecretsError(() => loadSecretsKeyring("not-an-entry"), "KEK_MALFORMED"));

    assertNoLeak(
      assertSecretsError(
        () => loadSecretsKeyring(`1:${Buffer.alloc(16, 1).toString("base64")}`),
        "KEK_LENGTH",
      ),
    );

    assertNoLeak(
      assertSecretsError(
        () => loadSecretsKeyring(`1:${KNOWN_KEY_BASE64},1:${OTHER_KEY_BASE64}`),
        "KEK_DUPLICATE_VERSION",
      ),
    );

    assertNoLeak(
      assertSecretsError(
        () => loadSecretsKeyring(`1:${KNOWN_KEY_BASE64},2:${OTHER_KEY_BASE64}`),
        "KEK_NOT_NEWEST",
      ),
    );

    const ring = loadSecretsKeyring(`1:${KNOWN_KEY_BASE64}`);
    const sealed = ring.seal({ context: CONTEXT, value: new SecretValue(KNOWN_PLAINTEXT) });

    assertNoLeak(
      assertSecretsError(
        () => ring.open({ context: CONTEXT, envelope: "v1.1.a" }),
        "ENVELOPE_MALFORMED",
      ),
    );

    const otherRing = loadSecretsKeyring(`2:${OTHER_KEY_BASE64}`);
    assertNoLeak(
      assertSecretsError(
        () => otherRing.open({ context: CONTEXT, envelope: sealed }),
        "ENVELOPE_UNKNOWN_KEK",
      ),
    );

    const tamperedFields = sealed.split(".");
    tamperedFields[3] = Buffer.from("tampered-ciphertext-bytes").toString("base64");
    assertNoLeak(
      assertSecretsError(
        () => ring.open({ context: CONTEXT, envelope: tamperedFields.join(".") }),
        "DECRYPT_FAILED",
      ),
    );

    // `assertValidContext` throws before the key is ever touched, so any
    // valid `KeyObject` here exercises `CONTEXT_INVALID` without needing a
    // loaded ring.
    const unusedKey = createSecretKey(Buffer.from(KNOWN_KEY_BASE64, "base64"));
    assertNoLeak(
      assertSecretsError(
        () =>
          sealSecretEnvelope({
            key: unusedKey,
            kekVersion: 1,
            context: { name: "", versionId: "v1" },
            value: new SecretValue(KNOWN_PLAINTEXT),
          }),
        "CONTEXT_INVALID",
      ),
    );
  });
});
