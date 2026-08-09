import assert from "node:assert/strict";
import test from "node:test";

import { SecretsError } from "@unimatrix/secrets";

import { normalizeSecretsError, SecretsHttpError } from "../src/lib/http/errors.js";

void test("a SecretsHttpError keeps its own status, code and message", () => {
  const normalized = normalizeSecretsError(
    new SecretsHttpError({ statusCode: 401, code: "UNAUTHORIZED", message: "nope" }),
  );

  assert.equal(normalized.statusCode, 401);
  assert.equal(normalized.logLevel, "warn");
  assert.deepEqual(normalized.envelope, { error: { code: "UNAUTHORIZED", message: "nope" } });
});

void test("a Fastify client error keeps its status but not its identity", () => {
  const normalized = normalizeSecretsError(
    Object.assign(new Error("Unsupported Media Type"), { statusCode: 415 }),
  );

  assert.equal(normalized.statusCode, 415);
  assert.equal(normalized.envelope.error.code, "VALIDATION_ERROR");
});

// The crypto package's error codes name the failing operation. They belong in
// the log; nothing about them belongs on the wire.
void test("a SecretsError from the crypto package becomes a bare internal error", () => {
  const normalized = normalizeSecretsError(
    new SecretsError({ code: "DECRYPT_FAILED", message: "sealed value could not be opened" }),
  );

  assert.equal(normalized.statusCode, 500);
  assert.equal(normalized.logLevel, "error");
  assert.deepEqual(normalized.envelope, {
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
});

void test("an error with no message still normalizes to something sendable", () => {
  const normalized = normalizeSecretsError(Object.assign(new Error(""), { statusCode: 418 }));

  assert.equal(normalized.envelope.error.message, "Request failed");
  assert.equal(normalizeSecretsError("not an error").statusCode, 500);
  assert.equal(normalizeSecretsError(null).statusCode, 500);
});
