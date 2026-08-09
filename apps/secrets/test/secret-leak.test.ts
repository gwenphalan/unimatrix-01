import assert from "node:assert/strict";
import test from "node:test";

import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { buildApp } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { secretVersionsTable } from "../src/db/schema/index.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import { issueServiceToken } from "../src/service-tokens/index.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const PLAINTEXT = "hunter2-hunter2-do-not-leak-this";

function createCapture(): { lines: string[]; stream: { write: (chunk: string) => void } } {
  const lines: string[] = [];

  return { lines, stream: { write: (chunk: string) => lines.push(chunk) } };
}

function createTestApp(
  env: SecretsRuntimeEnv,
  loggerStream: { write: (chunk: string) => void },
): FastifyInstance {
  const mergedEnv = {
    LOG_LEVEL: "info",
    NODE_ENV: "test",
    SECRETS_KEKS: TEST_KEK,
    SECRETS_DATABASE_URL: ":memory:",
    DB_MIGRATE_ON_START: "true",
    ...env,
  };

  return buildApp(
    { ...loadSecretsRuntimeConfig(mergedEnv), keyring: loadSecretsKeyringFromEnv(mergedEnv) },
    { loggerStream },
  );
}

function assertNoLeak(output: string, body: string, envelope?: string): void {
  assert.ok(!output.includes(PLAINTEXT), "the log echoed the plaintext value");
  assert.ok(!body.includes(PLAINTEXT), "the response body echoed the plaintext value");

  if (envelope !== undefined) {
    assert.ok(!output.includes(envelope), "the log echoed the stored envelope");
    assert.ok(!body.includes(envelope), "the response body echoed the stored envelope");
  }
}

/** Corrupts only the ciphertext field (index 3 of the dot-separated envelope), leaving the KEK version field intact so decryption fails at the auth tag rather than at `ENVELOPE_UNKNOWN_KEK`. */
function corruptEnvelopeCiphertext(envelope: string): string {
  const fields = envelope.split(".");

  fields[3] = Buffer.from("not the real ciphertext").toString("base64");

  return fields.join(".");
}

void test("success: create then read leaks the value into neither the log nor the response body of an unrelated failure", async () => {
  const capture = createCapture();
  const app = createTestApp({}, capture.stream);

  try {
    await app.ready();

    const manageToken = issueServiceToken(app.db, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    }).token;
    const readToken = issueServiceToken(app.db, {
      name: "read",
      scopePrefix: "github",
      capability: "read",
    }).token;

    const created = await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: PLAINTEXT },
    });

    // The create route is the one place a value enters the service, so it is
    // also the one place a handler could hand it straight back. The response
    // schema being strict already turns that into a 500 rather than a leak —
    // this asserts the property directly, so a schema loosened later fails
    // here rather than silently becoming a management route that returns a
    // secret.
    assert.equal(created.statusCode, 200);
    assertNoLeak(capture.lines.join(""), created.payload);

    const response = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${readToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { name: "github/api-token", value: PLAINTEXT });

    const output = capture.lines.join("");

    assert.ok(!output.includes(PLAINTEXT), "the log echoed the plaintext value");
  } finally {
    await app.close();
  }
});

void test("validation error: a value one character over the max leaks into neither the log nor the error body", async () => {
  const capture = createCapture();
  const app = createTestApp({}, capture.stream);

  try {
    await app.ready();

    const token = issueServiceToken(app.db, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    }).token;
    const overLongValue = `${PLAINTEXT}${"x".repeat(8_192 - PLAINTEXT.length + 1)}`;

    const response = await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: overLongValue },
    });

    assert.equal(response.statusCode, 400);
    assertNoLeak(capture.lines.join(""), response.payload);
  } finally {
    await app.close();
  }
});

void test("decrypt failure: a corrupted ciphertext field surfaces as a bare 500, not a leak", async () => {
  const capture = createCapture();
  const app = createTestApp({}, capture.stream);

  try {
    await app.ready();

    const manageToken = issueServiceToken(app.db, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    }).token;
    const readToken = issueServiceToken(app.db, {
      name: "read",
      scopePrefix: "github",
      capability: "read",
    }).token;

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: PLAINTEXT },
    });

    const stored = app.db
      .select({ envelope: secretVersionsTable.envelope })
      .from(secretVersionsTable)
      .where(eq(secretVersionsTable.secretName, "github/api-token"))
      .get();

    assert.ok(stored, "the sealed version was not persisted");

    const corrupted = corruptEnvelopeCiphertext(stored.envelope);

    app.db
      .update(secretVersionsTable)
      .set({ envelope: corrupted })
      .where(eq(secretVersionsTable.secretName, "github/api-token"))
      .run();

    const response = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${readToken}` },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    assertNoLeak(capture.lines.join(""), response.payload, corrupted);
  } finally {
    await app.close();
  }
});

void test("unhandled throw: a dropped secret_versions table surfaces as a bare 500, not a leak", async () => {
  const capture = createCapture();
  const app = createTestApp({}, capture.stream);

  try {
    await app.ready();

    const manageToken = issueServiceToken(app.db, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    }).token;
    const readToken = issueServiceToken(app.db, {
      name: "read",
      scopePrefix: "github",
      capability: "read",
    }).token;

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: PLAINTEXT },
    });

    app.db.run(sql`DROP TABLE secret_versions`);

    const response = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${readToken}` },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    assertNoLeak(capture.lines.join(""), response.payload);
  } finally {
    await app.close();
  }
});

// Pins that "every response schema is strict" is a security property and not
// a style preference: an unexpected key fails serialization rather than
// reaching the wire, and what the failure logs names the key, never the
// value it was attached to.
void test("a strict response schema rejecting an extra key logs the key, not the value it carried", async () => {
  const capture = createCapture();
  const app = createTestApp({}, capture.stream);

  try {
    app.register((scope) => {
      scope.get("/test-only/strict-response", {
        schema: { response: { 200: z.strictObject({ name: z.string() }) } },
        handler: () => ({ name: "fine", extraSecretLookingField: PLAINTEXT }),
      });

      return Promise.resolve();
    });

    await app.ready();

    const token = issueServiceToken(app.db, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    }).token;

    const response = await app.inject({
      method: "GET",
      url: "/test-only/strict-response",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 500);

    const output = capture.lines.join("");

    assert.match(output, /extraSecretLookingField/u);
    assertNoLeak(output, response.payload);
  } finally {
    await app.close();
  }
});
