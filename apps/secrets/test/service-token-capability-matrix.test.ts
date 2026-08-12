import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp, type BuildSecretsAppOptions } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import { issueServiceToken, type ServiceTokenCapability } from "../src/service-tokens/index.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/**
 * The entire regression net for widening `requireCapability` from equality
 * to set membership (`src/modules/secrets/index.ts`) — every
 * (capability, route) pair, both the ones the widening must open and the
 * ones it must keep denying. Every denial reads as the same 404 an
 * out-of-scope or absent name gets, so this checks only status codes.
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

function issueToken(app: FastifyInstance, capability: ServiceTokenCapability, suffix: string): string {
  return issueServiceToken(app.db, {
    name: `probe-${capability}-${suffix}`,
    scopePrefix: "matrix",
    capability,
  }).token;
}

const CAPABILITIES: ServiceTokenCapability[] = ["read", "write", "manage"];

void test("POST /secrets: only write and manage tokens can create", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    for (const capability of CAPABILITIES) {
      const token = issueToken(app, capability, "create");
      const response = await app.inject({
        method: "POST",
        url: "/secrets",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: `matrix/create-${capability}`, value: "hunter2-hunter2" },
      });
      const shouldAllow = capability === "write" || capability === "manage";

      assert.equal(
        response.statusCode,
        shouldAllow ? 200 : 404,
        `${capability} token got ${String(response.statusCode)} from POST /secrets`,
      );
    }
  } finally {
    await app.close();
  }
});

void test("POST /secrets/rotate: only write and manage tokens can rotate", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, "manage", "seed");

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "matrix/rotate-target", value: "hunter2-hunter2" },
    });

    for (const capability of CAPABILITIES) {
      const token = issueToken(app, capability, "rotate");
      const response = await app.inject({
        method: "POST",
        url: "/secrets/rotate",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "matrix/rotate-target", value: `rotated-by-${capability}` },
      });
      const shouldAllow = capability === "write" || capability === "manage";

      assert.equal(
        response.statusCode,
        shouldAllow ? 200 : 404,
        `${capability} token got ${String(response.statusCode)} from POST /secrets/rotate`,
      );
    }
  } finally {
    await app.close();
  }
});

void test("DELETE /secrets: only manage tokens can delete — read and write are both refused", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, "manage", "seed");

    for (const capability of CAPABILITIES) {
      const name = `matrix/delete-${capability}`;

      await app.inject({
        method: "POST",
        url: "/secrets",
        headers: { authorization: `Bearer ${manageToken}` },
        payload: { name, value: "hunter2-hunter2" },
      });

      const token = issueToken(app, capability, "delete");
      const response = await app.inject({
        method: "DELETE",
        url: "/secrets",
        headers: { authorization: `Bearer ${token}` },
        payload: { names: [name] },
      });
      const shouldAllow = capability === "manage";

      assert.equal(
        response.statusCode,
        shouldAllow ? 200 : 404,
        `${capability} token got ${String(response.statusCode)} from DELETE /secrets`,
      );
    }
  } finally {
    await app.close();
  }
});

void test("GET /secrets: only write and manage tokens can list — a write-only token must still see rows", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, "manage", "seed");

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "matrix/listed", value: "hunter2-hunter2" },
    });

    for (const capability of CAPABILITIES) {
      const token = issueToken(app, capability, "list");
      const response = await app.inject({
        method: "GET",
        url: "/secrets",
        headers: { authorization: `Bearer ${token}` },
      });
      const shouldAllow = capability === "write" || capability === "manage";

      assert.equal(
        response.statusCode,
        shouldAllow ? 200 : 404,
        `${capability} token got ${String(response.statusCode)} from GET /secrets`,
      );

      if (shouldAllow) {
        const body: { secrets: { name: string }[] } = response.json();

        assert.ok(
          body.secrets.some((secret) => secret.name === "matrix/listed"),
          `${capability} token listed no rows, and a write-only token that cannot list would leave the console showing none`,
        );
      }
    }
  } finally {
    await app.close();
  }
});

void test("GET /secrets/value: only a read token can reach it — write and manage are both refused", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, "manage", "seed");

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "matrix/readable", value: "hunter2-hunter2" },
    });

    for (const capability of CAPABILITIES) {
      const token = issueToken(app, capability, "value");
      const response = await app.inject({
        method: "GET",
        url: "/secrets/value?name=matrix%2Freadable",
        headers: { authorization: `Bearer ${token}` },
      });
      const shouldAllow = capability === "read";

      assert.equal(
        response.statusCode,
        shouldAllow ? 200 : 404,
        `${capability} token got ${String(response.statusCode)} from GET /secrets/value`,
      );
    }
  } finally {
    await app.close();
  }
});
