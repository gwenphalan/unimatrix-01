import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

function createTestApp(env: SecretsRuntimeEnv = {}) {
  const mergedEnv = {
    LOG_LEVEL: "error",
    NODE_ENV: "test",
    SECRETS_KEKS: TEST_KEK,
    SECRETS_DATABASE_URL: ":memory:",
    ...env,
  };

  return buildApp({
    ...loadSecretsRuntimeConfig(mergedEnv),
    keyring: loadSecretsKeyringFromEnv(mergedEnv),
  });
}

void test("GET /health returns the expected health payload and cache headers", async () => {
  const app = createTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      service: "secrets",
      status: "ok",
    });
    assert.equal(response.headers["cache-control"], "no-store, no-cache, must-revalidate");
    assert.equal(response.headers.pragma, "no-cache");
  } finally {
    await app.close();
  }
});

void test("GET /health rejects unexpected query parameters", async () => {
  const app = createTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health?unexpected=1",
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

// Not a 404. A URL matching no route is denied like any other, so route
// existence is not something an unauthenticated caller can enumerate.
// `auth-plugin.test.ts` is where the same URL answers 404 with a valid token.
void test("GET /missing-route is denied rather than answered", async () => {
  const app = createTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/missing-route",
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "A valid service token is required",
      },
    });
  } finally {
    await app.close();
  }
});
