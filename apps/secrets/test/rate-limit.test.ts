import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import type { SecretsHttpErrorEnvelope } from "../src/lib/http/errors.js";
import {
  HEALTH_RATE_LIMIT_OPTIONS,
  NOT_FOUND_RATE_LIMIT_OPTIONS,
} from "../src/plugins/rate-limit.js";
import { issueServiceToken } from "../src/service-tokens/index.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/** The global ceiling from `setupRateLimit`, which the plugin keeps private. */
const GLOBAL_RATE_LIMIT_MAX = 60;

function createTestApp(env: SecretsRuntimeEnv = {}): FastifyInstance {
  const mergedEnv = {
    LOG_LEVEL: "error",
    NODE_ENV: "test",
    SECRETS_KEKS: TEST_KEK,
    SECRETS_DATABASE_URL: ":memory:",
    DB_MIGRATE_ON_START: "true",
    ...env,
  };

  return buildApp({
    ...loadSecretsRuntimeConfig(mergedEnv),
    keyring: loadSecretsKeyringFromEnv(mergedEnv),
  });
}

// Inside `app.register`, never on the root instance: a route added to the root
// after `buildApp()` predates the rate-limit plugin's `onRoute` hook and would
// silently answer 200 forever.
function addProtectedRoute(app: FastifyInstance): void {
  app.register((scope) => {
    scope.get("/protected", () => ({ ok: true }));

    return Promise.resolve();
  });
}

async function statusesFor(
  app: FastifyInstance,
  url: string,
  count: number,
  headers: Record<string, string> = {},
): Promise<number[]> {
  const statuses: number[] = [];

  for (let index = 0; index < count; index += 1) {
    statuses.push((await app.inject({ method: "GET", url, headers })).statusCode);
  }

  return statuses;
}

void test("/health is capped by its own per-route ceiling", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const statuses = await statusesFor(app, "/health", HEALTH_RATE_LIMIT_OPTIONS.max + 1);

    assert.deepEqual(
      statuses.slice(0, HEALTH_RATE_LIMIT_OPTIONS.max),
      Array.from({ length: HEALTH_RATE_LIMIT_OPTIONS.max }, () => 200),
    );
    assert.equal(statuses.at(-1), 429);
  } finally {
    await app.close();
  }
});

void test("a 429 comes back as the app's own envelope", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    await statusesFor(app, "/health", HEALTH_RATE_LIMIT_OPTIONS.max);

    const limited = await app.inject({ method: "GET", url: "/health" });

    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json<SecretsHttpErrorEnvelope>().error.code, "RATE_LIMITED");
  } finally {
    await app.close();
  }
});

void test("an authenticated route is capped by the global ceiling", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    const issued = issueServiceToken(app.db, {
      name: "api",
      scopePrefix: "github",
      capability: "read",
    });
    const headers = { authorization: `Bearer ${issued.token}` };
    const statuses = await statusesFor(app, "/protected", GLOBAL_RATE_LIMIT_MAX + 1, headers);

    assert.equal(statuses.filter((status) => status === 200).length, GLOBAL_RATE_LIMIT_MAX);
    assert.equal(statuses.at(-1), 429);
  } finally {
    await app.close();
  }
});

// Why the guard sits at `preValidation`: the limiter is a route-level hook and
// route-level hooks run after instance-level ones of the same type, so an
// instance-level `onRequest` guard would be unreachable by it. A 429 arriving
// before a 401 is what proves the limiter got there first.
void test("the ceiling is reached without authenticating first", async () => {
  const app = createTestApp();
  addProtectedRoute(app);

  try {
    await app.ready();

    const statuses = await statusesFor(app, "/protected", GLOBAL_RATE_LIMIT_MAX + 1);

    assert.equal(statuses.filter((status) => status === 401).length, GLOBAL_RATE_LIMIT_MAX);
    assert.equal(statuses.at(-1), 429);
  } finally {
    await app.close();
  }
});

// The gap this closes: `setNotFoundHandler` fires no `onRoute` event, so the
// global ceiling never reaches an unmatched URL. Denying rather than 404-ing
// those is what made it matter — without this the guard would hash and query
// on every one, unbounded.
void test("unmatched URLs are bounded even though nobody has authenticated", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const statuses = await statusesFor(app, "/nope", NOT_FOUND_RATE_LIMIT_OPTIONS.max + 1);

    assert.deepEqual(
      statuses.slice(0, NOT_FOUND_RATE_LIMIT_OPTIONS.max),
      Array.from({ length: NOT_FOUND_RATE_LIMIT_OPTIONS.max }, () => 401),
    );
    assert.equal(statuses.at(-1), 429, "the not-found path never reached its ceiling");
  } finally {
    await app.close();
  }
});
