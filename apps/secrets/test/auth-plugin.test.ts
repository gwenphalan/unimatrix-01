import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp, type BuildSecretsAppOptions } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import { PUBLIC_ROUTE_URLS } from "../src/plugins/auth.js";
import {
  issueServiceToken,
  listServiceTokens,
  revokeServiceToken,
} from "../src/service-tokens/index.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/**
 * `DB_MIGRATE_ON_START` is not optional here: without it `service_tokens` does
 * not exist and every token lookup is a 500 rather than an authentication
 * result.
 */
function createTestApp(
  env: SecretsRuntimeEnv = {},
  options: BuildSecretsAppOptions = {},
): FastifyInstance {
  const mergedEnv = {
    LOG_LEVEL: "error",
    NODE_ENV: "test",
    SECRETS_KEKS: TEST_KEK,
    SECRETS_DATABASE_URL: ":memory:",
    DB_MIGRATE_ON_START: "true",
    ...env,
  };

  return buildApp(
    {
      ...loadSecretsRuntimeConfig(mergedEnv),
      keyring: loadSecretsKeyringFromEnv(mergedEnv),
    },
    options,
  );
}

/**
 * Registered through `app.register`, never on the root instance. Fastify runs
 * `onRoute` hooks synchronously at `route()` time while the rate-limit plugin
 * boots through avvio, so a route added on the root instance after `buildApp()`
 * predates the limiter's `onRoute` hook and gets no ceiling at all.
 */
function addProtectedRoute(app: FastifyInstance): void {
  app.register((scope) => {
    scope.get("/protected", (request) => ({ serviceToken: request.serviceToken }));

    return Promise.resolve();
  });
}

void test("the public allowlist is exactly /health", () => {
  assert.deepEqual([...PUBLIC_ROUTE_URLS], ["/health"]);
});

void test("/health answers without a token and everything else does not", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);

    for (const url of ["/protected", "/missing-route"]) {
      const response = await app.inject({ method: "GET", url });

      assert.equal(response.statusCode, 401, `${url} was not denied`);
      assert.equal(response.headers["www-authenticate"], "Bearer");
    }
  } finally {
    await app.close();
  }
});

void test("a valid token reaches the handler and carries its scope and capability", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    const issued = issueServiceToken(app.db, {
      name: "api",
      scopePrefix: "github",
      capability: "manage",
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${issued.token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      serviceToken: {
        id: issued.record.id,
        name: "api",
        scopePrefix: "github",
        capability: "manage",
      },
    });

    // A missing route is a 404 only once the caller is known.
    const notFound = await app.inject({
      method: "GET",
      url: "/missing-route",
      headers: { authorization: `Bearer ${issued.token}` },
    });

    assert.equal(notFound.statusCode, 404);
    assert.deepEqual(notFound.json(), {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } finally {
    await app.close();
  }
});

void test("authenticating stamps the token's last-used time", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    const issued = issueServiceToken(app.db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });

    assert.equal(issued.record.lastUsedAt, null);

    await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${issued.token}` },
    });

    // Resolved and asserted present first: `[0]?.lastUsedAt` on an empty list
    // is `undefined`, which passes a `notEqual(null)` while proving nothing.
    const stored = listServiceTokens(app.db).find((token) => token.id === issued.record.id);

    assert.ok(stored, "the issued token was not persisted");
    assert.notEqual(stored.lastUsedAt, null);
  } finally {
    await app.close();
  }
});

void test("every rejection is the same response, and none of it echoes the token", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    const issued = issueServiceToken(app.db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });

    revokeServiceToken(app.db, "api");

    const unissued = `usk_${"A".repeat(43)}`;
    const request = async (authorization: string) =>
      app.inject({ method: "GET", url: "/protected", headers: { authorization } });

    const revoked = await request(`Bearer ${issued.token}`);
    const unknown = await request(`Bearer ${unissued}`);
    const malformed = await request("Bearer not-a-token");
    const wrongScheme = await request(`Basic ${issued.token}`);

    for (const response of [revoked, unknown, malformed, wrongScheme]) {
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers["www-authenticate"], "Bearer");
      assert.deepEqual(response.json(), unknown.json());
    }

    assert.ok(
      !revoked.payload.includes(issued.token.slice(4)),
      "the rejection echoed part of the presented token",
    );
  } finally {
    await app.close();
  }
});

// A broken schema must not read as a bad credential: a 401 would send the
// caller hunting for a token that is fine.
void test("a database fault inside the guard is a 500, not a 401", async () => {
  // The stack trace this logs is the point of the test, not a symptom; it goes
  // to a sink rather than the runner's output.
  const app = createTestApp(
    { DB_MIGRATE_ON_START: "false" },
    { loggerStream: { write: () => {} } },
  );
  addProtectedRoute(app);

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer usk_${"A".repeat(43)}` },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  } finally {
    await app.close();
  }
});
