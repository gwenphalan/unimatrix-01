import assert from "node:assert/strict";
import test from "node:test";

import { createNotFoundErrorEnvelope, normalizeDeployError } from "../src/lib/http/errors.js";

void test("createNotFoundErrorEnvelope returns the standard NOT_FOUND envelope", () => {
  assert.deepEqual(createNotFoundErrorEnvelope(), {
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

void test("a Fastify-shaped 404 normalizes through the generic status branch", () => {
  const normalized = normalizeDeployError(Object.assign(new Error("nope"), { statusCode: 404 }));

  assert.equal(normalized.statusCode, 404);
  assert.equal(normalized.logLevel, "info");
  assert.deepEqual(normalized.envelope, createNotFoundErrorEnvelope());
});

void test("a Fastify client error keeps its status but not its identity", () => {
  const normalized = normalizeDeployError(
    Object.assign(new Error("Unsupported Media Type"), { statusCode: 415 }),
  );

  assert.equal(normalized.statusCode, 415);
  assert.equal(normalized.envelope.error.code, "VALIDATION_ERROR");
  assert.equal(normalized.envelope.error.message, "Unsupported Media Type");
});

void test("an unrecognised error becomes a bare internal error", () => {
  const normalized = normalizeDeployError(new Error("boom"));

  assert.equal(normalized.statusCode, 500);
  assert.equal(normalized.logLevel, "error");
  assert.deepEqual(normalized.envelope, {
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
});

void test("an error with no message still normalizes to something sendable", () => {
  const normalized = normalizeDeployError(Object.assign(new Error(""), { statusCode: 418 }));

  assert.equal(normalized.envelope.error.message, "Request failed");
  assert.equal(normalizeDeployError("not an error").statusCode, 500);
  assert.equal(normalizeDeployError(null).statusCode, 500);
});
