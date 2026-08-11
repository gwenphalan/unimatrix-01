import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp, type BuildSecretsAppOptions } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { secretAuditLogTable, secretsTable, secretVersionsTable } from "../src/db/schema/index.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import { SecretsHttpError } from "../src/lib/http/errors.js";
import { getServiceToken } from "../src/modules/secrets/index.js";
import { issueServiceToken, type ServiceTokenCapability } from "../src/service-tokens/index.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/** `DB_MIGRATE_ON_START` is not optional — without it every table is missing and every route is a 500. */
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

function issueToken(
  app: FastifyInstance,
  options: { name: string; scopePrefix: string; capability: ServiceTokenCapability },
): string {
  return issueServiceToken(app.db, options).token;
}

function readSecretVersions(app: FastifyInstance, name: string) {
  return app.db
    .select()
    .from(secretVersionsTable)
    .where(eq(secretVersionsTable.secretName, name))
    .all();
}

void test("create stores a secret and returns metadata carrying no value", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    // 12+ characters so `SecretValue#mask()` returns a visible prefix rather
    // than an all-stars mask, which is what makes the assertion below able
    // to distinguish "the wrong prefix" from "no prefix logic ran at all".
    const response = await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2-hunter2" },
    });

    assert.equal(response.statusCode, 200);

    const body: { name: string; kekVersion: number; maskedPrefix: string } = response.json();

    assert.equal(body.name, "github/api-token");
    assert.equal(body.kekVersion, 1);
    assert.equal(body.maskedPrefix, "hunt********");
    assert.equal("value" in body, false);
    assert.ok(!response.payload.includes("hunter2"), "the response echoed the plaintext value");

    const versions = readSecretVersions(app, "github/api-token");

    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.supersededAt, null);
  } finally {
    await app.close();
  }
});

void test("create rejects a duplicate name", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });
    const create = () =>
      app.inject({
        method: "POST",
        url: "/secrets",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "github/api-token", value: "hunter2" },
      });

    assert.equal((await create()).statusCode, 200);

    const second = await create();

    assert.equal(second.statusCode, 400);

    const body: { error: { code: string } } = second.json();

    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

void test("create denies a name outside the token's scope", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });
    const response = await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "dokploy/token", value: "hunter2" },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: { code: "NOT_FOUND", message: "Route not found" } });
  } finally {
    await app.close();
  }
});

void test("a read token cannot reach create, rotate or delete", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "read", scopePrefix: "github", capability: "read" });
    const attempts = [
      {
        method: "POST" as const,
        url: "/secrets",
        payload: { name: "github/api-token", value: "x" },
      },
      {
        method: "POST" as const,
        url: "/secrets/rotate",
        payload: { name: "github/api-token", value: "x" },
      },
      { method: "DELETE" as const, url: "/secrets", payload: { names: ["github/api-token"] } },
    ];

    for (const attempt of attempts) {
      const response = await app.inject({
        ...attempt,
        headers: { authorization: `Bearer ${token}` },
      });

      assert.equal(
        response.statusCode,
        404,
        `${attempt.method} ${attempt.url} was reachable by a read token`,
      );
    }
  } finally {
    await app.close();
  }
});

void test("rotate supersedes the old version, keeps exactly one live row, and advances rotatedAt", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2-hunter2" },
    });

    // A past timestamp that direct SQL manipulation makes deterministic —
    // asserting "advanced" against SQLite's second-resolution
    // `CURRENT_TIMESTAMP` any other way risks two writes in the same wall
    // clock second comparing equal.
    const STALE_ROTATED_AT = "2020-01-01 00:00:00";

    await app.db
      .update(secretsTable)
      .set({ rotatedAt: STALE_ROTATED_AT })
      .where(eq(secretsTable.name, "github/api-token"));

    const response = await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter3-hunter3" },
    });

    assert.equal(response.statusCode, 200);

    const body: { name: string; maskedPrefix: string; rotatedAt: string } = response.json();

    assert.equal(body.name, "github/api-token");
    assert.equal(body.maskedPrefix, "hunt********");
    assert.notEqual(body.rotatedAt, STALE_ROTATED_AT);

    const versions = readSecretVersions(app, "github/api-token");

    assert.equal(versions.length, 2);
    assert.equal(versions.filter((version) => version.supersededAt === null).length, 1);
  } finally {
    await app.close();
  }
});

void test("rotate denies a name that does not exist", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });
    const response = await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/missing", value: "hunter2" },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

void test("rotate denies a name outside the token's scope", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageAll = issueToken(app, {
      name: "manage-all",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageAll}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const dokployToken = issueToken(app, {
      name: "manage-dokploy",
      scopePrefix: "dokploy",
      capability: "manage",
    });

    const response = await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${dokployToken}` },
      payload: { name: "github/api-token", value: "hunter3" },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

void test("delete removes secret_versions rows and leaves the audit rows behind", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { names: ["github/api-token"] },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { affected: 1 });
    assert.deepEqual(readSecretVersions(app, "github/api-token"), []);

    const auditRows = app.db.select().from(secretAuditLogTable).all();

    assert.ok(auditRows.length >= 2, "the created and deleted rows should both survive the delete");
  } finally {
    await app.close();
  }
});

void test("delete denies the whole request if any name is out of scope or missing, and deletes nothing", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    for (const name of ["github/one", "github/two"]) {
      await app.inject({
        method: "POST",
        url: "/secrets",
        headers: { authorization: `Bearer ${token}` },
        payload: { name, value: "hunter2" },
      });
    }

    const response = await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { names: ["github/one", "github/two", "github/missing"] },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(readSecretVersions(app, "github/one").length, 1);
    assert.equal(readSecretVersions(app, "github/two").length, 1);
  } finally {
    await app.close();
  }
});

void test("delete denies the whole request if any name is outside the token's scope", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageAll = issueToken(app, {
      name: "manage-all",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageAll}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const dokployToken = issueToken(app, {
      name: "manage-dokploy",
      scopePrefix: "dokploy",
      capability: "manage",
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${dokployToken}` },
      payload: { names: ["github/api-token"] },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(readSecretVersions(app, "github/api-token").length, 1);
  } finally {
    await app.close();
  }
});

/** The most recent `secret_audit_log` row for `action`, in the order rows were inserted. */
function lastAuditRow(app: FastifyInstance, action: string) {
  const rows = app.db
    .select()
    .from(secretAuditLogTable)
    .where(eq(secretAuditLogTable.action, action))
    .all();

  return rows.at(-1);
}

void test("create, rotate and delete land actorUserId on their audit row when the caller sends one", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2", actorUserId: "user_2create" },
    });

    assert.equal(lastAuditRow(app, "secret.created")?.actorUserId, "user_2create");

    await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter3", actorUserId: "user_2rotate" },
    });

    assert.equal(lastAuditRow(app, "secret.rotated")?.actorUserId, "user_2rotate");

    await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { names: ["github/api-token"], actorUserId: "user_2delete" },
    });

    assert.equal(lastAuditRow(app, "secret.deleted")?.actorUserId, "user_2delete");
  } finally {
    await app.close();
  }
});

void test("create, rotate and delete land a null actorUserId when the caller omits one", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    assert.equal(lastAuditRow(app, "secret.created")?.actorUserId, null);

    await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter3" },
    });

    assert.equal(lastAuditRow(app, "secret.rotated")?.actorUserId, null);

    await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { names: ["github/api-token"] },
    });

    assert.equal(lastAuditRow(app, "secret.deleted")?.actorUserId, null);
  } finally {
    await app.close();
  }
});

void test("create, rotate and delete reject an unknown body key even alongside a valid actorUserId", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "manage", scopePrefix: "github", capability: "manage" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2", actorUserId: "user_2c", extra: true },
    });

    assert.equal(createResponse.statusCode, 400);

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const rotateResponse = await app.inject({
      method: "POST",
      url: "/secrets/rotate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "github/api-token", value: "hunter3", actorUserId: "user_2c", extra: true },
    });

    assert.equal(rotateResponse.statusCode, 400);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
      payload: { names: ["github/api-token"], actorUserId: "user_2c", extra: true },
    });

    assert.equal(deleteResponse.statusCode, 400);
  } finally {
    await app.close();
  }
});

void test("create -> read round trip", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const readToken = issueToken(app, { name: "read", scopePrefix: "github", capability: "read" });
    const response = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${readToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { name: "github/api-token", value: "hunter2" });

    const auditRows = app.db
      .select()
      .from(secretAuditLogTable)
      .where(eq(secretAuditLogTable.action, "secret.read"))
      .all();

    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0]?.outcome, "success");
  } finally {
    await app.close();
  }
});

void test("a manage token cannot reach the value route", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${manageToken}` },
    });

    assert.equal(response.statusCode, 404);
    assert.ok(!response.payload.includes("hunter2"), "the response echoed the plaintext value");
  } finally {
    await app.close();
  }
});

void test("the three ways of missing a secret are indistinguishable from each other, headers included", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageToken = issueToken(app, {
      name: "manage",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageToken}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const readGithubToken = issueToken(app, {
      name: "read-github",
      scopePrefix: "github",
      capability: "read",
    });
    const readDokployToken = issueToken(app, {
      name: "read-dokploy",
      scopePrefix: "dokploy",
      capability: "read",
    });

    // Absent: a name with no live version.
    const absent = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fmissing",
      headers: { authorization: `Bearer ${readGithubToken}` },
    });

    // Out of scope: a real name, wrong scope.
    const outOfScope = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${readDokployToken}` },
    });

    // Wrong capability: a manage token presented at the read route.
    const wrongCapability = await app.inject({
      method: "GET",
      url: "/secrets/value?name=github%2Fapi-token",
      headers: { authorization: `Bearer ${manageToken}` },
    });

    // `x-ratelimit-remaining` decrements per request regardless of the
    // reason, so it is left out here — it distinguishes "how many requests
    // happened", never "why one was denied". `x-ratelimit-limit` is the
    // bucket identity: all three land in the same one, distinct from the
    // unmatched-route ceiling (`NOT_FOUND_RATE_LIMIT_OPTIONS`, 30/min).
    for (const response of [absent, outOfScope, wrongCapability]) {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), absent.json());
      assert.equal(response.headers["x-ratelimit-limit"], absent.headers["x-ratelimit-limit"]);
      assert.ok(response.headers["x-ratelimit-limit"] !== undefined);
    }
  } finally {
    await app.close();
  }
});

void test("list returns metadata for in-scope names only, and rejects any query parameter", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const manageAll = issueToken(app, {
      name: "manage-all",
      scopePrefix: "github",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${manageAll}` },
      payload: { name: "github/api-token", value: "hunter2" },
    });

    const dokployToken = issueToken(app, {
      name: "manage-dokploy",
      scopePrefix: "dokploy",
      capability: "manage",
    });

    await app.inject({
      method: "POST",
      url: "/secrets",
      headers: { authorization: `Bearer ${dokployToken}` },
      payload: { name: "dokploy/api-token", value: "hunter2" },
    });

    const scopedList = await app.inject({
      method: "GET",
      url: "/secrets",
      headers: { authorization: `Bearer ${dokployToken}` },
    });

    assert.equal(scopedList.statusCode, 200);

    const body: { secrets: { name: string }[] } = scopedList.json();

    assert.deepEqual(
      body.secrets.map((secret) => secret.name),
      ["dokploy/api-token"],
    );

    const rejected = await app.inject({
      method: "GET",
      url: "/secrets?name=github",
      headers: { authorization: `Bearer ${dokployToken}` },
    });

    assert.equal(rejected.statusCode, 400);
  } finally {
    await app.close();
  }
});

void test("a read token cannot reach list", async () => {
  const app = createTestApp();

  try {
    await app.ready();

    const token = issueToken(app, { name: "read", scopePrefix: "github", capability: "read" });
    const response = await app.inject({
      method: "GET",
      url: "/secrets",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

void test("getServiceToken denies a null service token — unreachable through a real request, since the auth guard already would have", () => {
  const warnings: unknown[] = [];
  const fakeRequest = {
    serviceToken: null,
    id: "fake-request-id",
    routeOptions: { url: "/secrets" },
    log: { warn: (payload: unknown) => warnings.push(payload) },
  } as unknown as FastifyRequest;

  // Asserts the whole envelope, not just the message: a denial that kept this
  // wording but changed to a 401 or a 500 would defeat the point of routing
  // every denial through one construction site, and a message-only regex
  // would still pass.
  assert.throws(
    () => getServiceToken(fakeRequest),
    (error: unknown) =>
      error instanceof SecretsHttpError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND" &&
      error.message === "Route not found",
  );
  assert.equal(warnings.length, 1);
});

/** Strips line and block comments so a comment mentioning `actorUserId` cannot satisfy the check below. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/^[ \t]*\/\/.*$/gmu, "");
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listTsFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The structural counterpart to the trust-argument comment in
 * `src/modules/secrets/index.ts`: `actorUserId` may only appear in the four
 * places that carry it from the request body to the audit row, and never
 * beside a function or operator this service uses to make an authorization
 * decision. A regression here — `actorUserId` reaching `scopeCoversName`,
 * `requireCapability`, or an `if` guarding a denial — would defeat the whole
 * point of treating it as an unverified assertion.
 */
void test("actorUserId appears only where it is carried into the audit log, never in a decision", () => {
  const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
  const ALLOWED_RELATIVE_PATHS = new Set([
    join("modules", "secrets", "index.ts"),
    join("audit", "store.ts"),
    join("db", "schema", "audit-log.ts"),
  ]);
  const DECISION_TOKENS = [
    "scopeCoversName",
    "requireCapability",
    "denySecretAccess",
    "getLiveSecretVersion",
    "listExistingSecretNames",
    "if (",
    "capability !==",
    "capability ===",
  ];

  let sawOccurrence = false;

  for (const file of listTsFiles(srcRoot)) {
    const relativePath = relative(srcRoot, file);
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");

    for (const [index, line] of lines.entries()) {
      if (!line.includes("actorUserId")) {
        continue;
      }

      sawOccurrence = true;

      assert.ok(
        ALLOWED_RELATIVE_PATHS.has(relativePath),
        `actorUserId appears outside the allowed files at ${relativePath}:${String(index + 1)}`,
      );

      for (const token of DECISION_TOKENS) {
        assert.ok(
          !line.includes(token),
          `actorUserId appears alongside the decision-making token "${token}" at ${relativePath}:${String(index + 1)}`,
        );
      }
    }
  }

  assert.ok(sawOccurrence, "expected to find at least one actorUserId occurrence under src/");
});

/** Self-check: if `stripComments` ever stopped working, a comment mentioning `actorUserId` would falsely trip the guard above. */
void test("stripComments hides a commented-out actorUserId mention from the structural guard", () => {
  const commented = 'const x = 1;\n// if (actorUserId === "admin") { deny(); }\nconst y = 2;';
  const stripped = stripComments(commented);

  assert.ok(!stripped.includes("actorUserId"));

  const real = 'const { actorUserId } = request.body;\nif (actorUserId === "admin") { deny(); }';

  assert.ok(stripComments(real).includes("actorUserId"));
});
