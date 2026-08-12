import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@unimatrix/db";
import {
  SECRET_REGISTRY,
  type AdminDeleteSecretResponse,
  type AdminListSecretsResponse,
  type AdminSecretRow,
  type SecretMetadata,
  type SecretRegistryEntry,
} from "@unimatrix/shared";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { buildApp, type BuildApiAppOptions } from "../src/app.js";
import { loadApiRuntimeConfig, type ApiRuntimeEnv } from "../src/config.js";
import type { ApiErrorEnvelope } from "../src/lib/http/errors.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

const FRONTEND_API_HOST = "example.clerk.accounts.dev";

/**
 * Own keypair for this file, same reasoning as `integration-routes.test.ts`:
 * `@clerk/backend` caches the derived JWK per `kid` for the process's life,
 * and `node --test` runs each file in its own process.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const SIGNING_KEY_ID = "unimatrix-secrets-admin-routes-test-key";

const CLERK_JWT_KEY = publicKey.export({ format: "pem", type: "spki" }).toString();

const CLERK_ENV: ApiRuntimeEnv = {
  CLERK_SECRET_KEY: "sk_test_dummy",
  CLERK_PUBLISHABLE_KEY: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
  CLERK_JWT_KEY,
};

const READ_TOKEN = "svc_read_token";
const INTEGRATIONS_TOKEN = "svc_integrations_manage_token";
const PLATFORM_TOKEN = "svc_platform_write_token";

const SECRETS_ENV: ApiRuntimeEnv = {
  SECRETS_BASE_URL: "http://secrets.internal:3002",
  SECRETS_SERVICE_TOKEN: READ_TOKEN,
  SECRETS_INTEGRATIONS_MANAGE_TOKEN: INTEGRATIONS_TOKEN,
  SECRETS_PLATFORM_WRITE_TOKEN: PLATFORM_TOKEN,
};

const ADMIN_USER = "user_2cccccccccccccccccccccccccc";
const NON_ADMIN_USER = "user_2ddddddddddddddddddddddddd";

/** Never appears in a captured log line or an error envelope — see the redaction test below. */
const PLAINTEXT = "TOTALLY-SECRET-PLAINTEXT-VALUE";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signSessionToken(userId: string, permissions?: Record<string, string[]>): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", kid: SIGNING_KEY_ID, typ: "JWT" };
  const payload = {
    azp: "http://localhost",
    exp: issuedAt + 60,
    iat: issuedAt,
    iss: `https://${FRONTEND_API_HOST}`,
    nbf: issuedAt - 5,
    sid: `sess_${userId}`,
    sub: userId,
    v: 2,
    ...(permissions === undefined ? {} : { permissions }),
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

function adminAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signSessionToken(ADMIN_USER, { auth: ["admin"] })}` };
}

function nonAdminAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signSessionToken(NON_ADMIN_USER, { auth: ["editor"] })}` };
}

interface TestContext {
  app: ReturnType<typeof buildApp>;
  cleanup: () => void;
}

function createTestApp(env: ApiRuntimeEnv, options: BuildApiAppOptions = {}): TestContext {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-admin-routes-"));
  const filePath = join(directory, "secrets-admin-routes.sqlite");
  const previousDatabaseUrl = process.env.DATABASE_URL;

  const instance = createDatabase({ filePath });

  migrate(instance.db, { migrationsFolder: MIGRATIONS_FOLDER });
  instance.client.close();

  process.env.DATABASE_URL = filePath;

  const app = buildApp(
    loadApiRuntimeConfig({ LOG_LEVEL: "error", NODE_ENV: "test", ...env }),
    options,
  );

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }

  return {
    app,
    cleanup: () => {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

interface CapturedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

/**
 * A minimal `typeof fetch` standing in for the secrets store's manage
 * surface. `respond` decides the response for each call; every call is
 * recorded in `captured` regardless of outcome, so a test can assert on the
 * outbound request (method, path, body, bearer token) independent of what
 * came back.
 */
function createFakeStoreFetch(
  captured: CapturedRequest[],
  respond: (request: CapturedRequest) => Response,
): typeof fetch {
  const impl: typeof fetch = (input, init) => {
    const url =
      input instanceof URL ? input : input instanceof Request ? new URL(input.url) : new URL(input);
    const headers = init?.headers as Record<string, string> | undefined;
    const rawBody = init?.body;
    const body: unknown =
      typeof rawBody === "string" && rawBody.length > 0 ? JSON.parse(rawBody) : undefined;

    const request: CapturedRequest = {
      method: init?.method ?? "GET",
      path: url.pathname,
      authorization: headers?.authorization,
      body,
    };

    captured.push(request);

    return Promise.resolve(respond(request));
  };

  return impl;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Undeclared on purpose: the registry's integration tier is empty. */
const INTEGRATION_NAME = "integrations/github/token";
const PLATFORM_NAME = "platform/clerk-secret-key";

function secretRegistryEntry(name: string): SecretRegistryEntry {
  const entry = SECRET_REGISTRY.find((candidate) => candidate.name === name);

  assert.ok(entry, `${name} is expected to be declared in SECRET_REGISTRY`);

  return entry;
}

const METADATA: SecretMetadata = {
  name: "github/api-token",
  maskedPrefix: PLAINTEXT.slice(0, 4),
  kekVersion: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  rotatedAt: "2026-07-01T00:00:00.000Z",
};

/**
 * The store reports the keyring's active version on every list response, so a
 * stub that omits it is not a valid store response — the client parses these
 * against the shared schema and a missing field surfaces as a 502, not as a
 * malformed body the route passes through.
 */
const ACTIVE_KEK_VERSION = 1;

/**
 * `GET /secrets/admin` makes one list call per scoped token, so a stub has to
 * answer both. Keyed by the outbound bearer token, which is the only thing
 * distinguishing the two requests — same method, same path.
 */
function listResponder(lists: {
  platform?: SecretMetadata[];
  integrations?: SecretMetadata[];
  activeKekVersion?: { platform: number; integrations: number };
}): (request: CapturedRequest) => Response {
  return (request) => {
    const isPlatform = request.authorization === `Bearer ${PLATFORM_TOKEN}`;

    return jsonResponse(200, {
      secrets: (isPlatform ? lists.platform : lists.integrations) ?? [],
      activeKekVersion: isPlatform
        ? (lists.activeKekVersion?.platform ?? ACTIVE_KEK_VERSION)
        : (lists.activeKekVersion?.integrations ?? ACTIVE_KEK_VERSION),
    });
  };
}

const LIST_URL = "/secrets/admin";
const CREATE_URL = "/secrets/admin";
const ROTATE_URL = "/secrets/admin/rotate";
const DELETE_URL = "/secrets/admin";

// --- 1. Absence ---------------------------------------------------------

void test("every admin secrets route is absent without Clerk, even with a fully configured store", async () => {
  const { app, cleanup } = createTestApp(SECRETS_ENV, {
    secretsFetch: createFakeStoreFetch([], listResponder({})),
  });

  try {
    await app.ready();

    for (const request of [
      { method: "GET" as const, url: LIST_URL },
      { method: "POST" as const, url: CREATE_URL },
      { method: "POST" as const, url: ROTATE_URL },
      { method: "DELETE" as const, url: DELETE_URL },
    ]) {
      const response = await app.inject({ method: request.method, url: request.url });
      assert.equal(response.statusCode, 404, `${request.method} ${request.url}`);
    }
  } finally {
    await app.close();
    cleanup();
  }
});

void test("every admin secrets route is absent without a configured store, even with Clerk", async () => {
  const { app, cleanup } = createTestApp(CLERK_ENV);

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * Both scoped tokens or no console at all. With one, the tier it cannot reach
 * would render as "this credential is not set" — a token fault shown as a
 * missing credential is the silent wrong answer this page exists to avoid.
 */
for (const configured of [
  {
    label: "only the integrations token",
    env: { SECRETS_INTEGRATIONS_MANAGE_TOKEN: INTEGRATIONS_TOKEN },
  },
  { label: "only the platform token", env: { SECRETS_PLATFORM_WRITE_TOKEN: PLATFORM_TOKEN } },
  { label: "neither admin token", env: {} },
]) {
  void test(`every admin secrets route is absent with Clerk, a store, and ${configured.label}`, async () => {
    const { app, cleanup } = createTestApp(
      {
        ...CLERK_ENV,
        SECRETS_BASE_URL: SECRETS_ENV.SECRETS_BASE_URL,
        SECRETS_SERVICE_TOKEN: SECRETS_ENV.SECRETS_SERVICE_TOKEN,
        ...configured.env,
      },
      { secretsFetch: createFakeStoreFetch([], listResponder({})) },
    );

    try {
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: LIST_URL,
        headers: adminAuthHeaders(),
      });

      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
      cleanup();
    }
  });
}

// --- 2. Non-admin sessions ----------------------------------------------

void test("a signed-in session lacking auth:admin is refused with 403 on every route", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], listResponder({})),
    },
  );

  try {
    await app.ready();

    const requests: Array<{
      method: "DELETE" | "GET" | "POST";
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: "GET", url: LIST_URL },
      { method: "POST", url: CREATE_URL, payload: { name: "github/api-token", value: "x" } },
      { method: "POST", url: ROTATE_URL, payload: { name: "github/api-token", value: "x" } },
      { method: "DELETE", url: DELETE_URL, payload: { name: "github/api-token" } },
    ];

    for (const request of requests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: nonAdminAuthHeaders(),
        ...(request.payload === undefined ? {} : { payload: request.payload }),
      });
      assert.equal(response.statusCode, 403, `${request.method} ${request.url}`);
    }
  } finally {
    await app.close();
    cleanup();
  }
});

// --- 3. actorUserId forwarding -------------------------------------------

void test("create forwards actorUserId equal to the signed token's sub", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, METADATA)) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: CREATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 200);
    const call = captured.at(-1);
    assert.equal((call?.body as { actorUserId?: string } | undefined)?.actorUserId, ADMIN_USER);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("rotate forwards actorUserId equal to the signed token's sub", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, METADATA)) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: ROTATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 200);
    const call = captured.at(-1);
    assert.equal((call?.body as { actorUserId?: string } | undefined)?.actorUserId, ADMIN_USER);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("delete forwards actorUserId equal to the signed token's sub, and a single name as names: [name]", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, { affected: 1 })) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "DELETE",
      url: DELETE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token" },
    });

    assert.equal(response.statusCode, 200);
    const body: AdminDeleteSecretResponse = response.json();
    assert.deepEqual(body, { deleted: true });

    const call = captured.at(-1);
    const capturedBody = call?.body as { actorUserId?: string; names?: string[] } | undefined;
    assert.equal(capturedBody?.actorUserId, ADMIN_USER);
    assert.deepEqual(capturedBody?.names, ["github/api-token"]);
    assert.equal(call?.authorization, `Bearer ${INTEGRATIONS_TOKEN}`);
  } finally {
    await app.close();
    cleanup();
  }
});

// --- 3b. A platform name can never be deleted here -----------------------

void test("deleting a platform name is refused before the store is called, and says why", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, { affected: 1 })) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "DELETE",
      url: DELETE_URL,
      headers: adminAuthHeaders(),
      payload: { name: PLATFORM_NAME },
    });

    assert.equal(response.statusCode, 403);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "FORBIDDEN");
    assert.match(body.error.message, /Platform credentials cannot be deleted here/);
    assert.equal(captured.length, 0, "the store must never see a platform delete");
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * The other half of the same rule, and the half that survives someone deleting
 * the route check: delete is wired to the integrations client, whose token is
 * scoped to `integrations` and so cannot name a `platform/*` secret at all.
 * The platform token additionally holds `write`, which cannot delete anything.
 */
void test("the module's only deleteSecrets call site is the integrations client", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/modules/secrets/index.ts", import.meta.url)),
    "utf8",
  );

  const callSites = source.match(/[\w.]*\.deleteSecrets\(/gu) ?? [];

  assert.deepEqual(callSites, ["app.secretsManagement.integrations.deleteSecrets("]);
});

// --- 4. A browser-supplied actorUserId never reaches the store ----------

void test("a browser-supplied actorUserId in the body is a 400 and never reaches the store", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, METADATA)) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: CREATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue", actorUserId: "user_attacker" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(captured.length, 0, "the store must never see a request for a rejected body");
  } finally {
    await app.close();
    cleanup();
  }
});

// --- 5. Which token goes out on the wire --------------------------------

void test("list calls the store once per scoped token, and never with the read token", async () => {
  const captured: CapturedRequest[] = [];
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch(captured, listResponder({})) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      captured.map((call) => call.authorization).sort(),
      [`Bearer ${INTEGRATIONS_TOKEN}`, `Bearer ${PLATFORM_TOKEN}`].sort(),
    );
    assert.ok(captured.every((call) => call.authorization !== `Bearer ${READ_TOKEN}`));
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * A service token carries one scope prefix and no wildcard, so a mutation sent
 * on the wrong token comes back as the store's 404 — which reads as "no such
 * secret" and says nothing about scope.
 */
for (const mutation of [
  { url: CREATE_URL, label: "create" },
  { url: ROTATE_URL, label: "rotate" },
]) {
  void test(`${mutation.label} sends a platform name on the platform token and an integration name on the integrations token`, async () => {
    const captured: CapturedRequest[] = [];
    const { app, cleanup } = createTestApp(
      { ...CLERK_ENV, ...SECRETS_ENV },
      { secretsFetch: createFakeStoreFetch(captured, () => jsonResponse(200, METADATA)) },
    );

    try {
      await app.ready();

      for (const expected of [
        { name: PLATFORM_NAME, token: PLATFORM_TOKEN },
        { name: INTEGRATION_NAME, token: INTEGRATIONS_TOKEN },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: mutation.url,
          headers: adminAuthHeaders(),
          payload: { name: expected.name, value: "ghp_newvalue" },
        });

        assert.equal(response.statusCode, 200, expected.name);
        assert.equal(captured.at(-1)?.authorization, `Bearer ${expected.token}`, expected.name);
      }
    } finally {
      await app.close();
      cleanup();
    }
  });
}

// --- 6. The union list ----------------------------------------------------

function rowFor(body: AdminListSecretsResponse, name: string): AdminSecretRow | undefined {
  return body.secrets.find((row) => row.name === name);
}

async function listAsAdmin(
  lists: Parameters<typeof listResponder>[0],
): Promise<{ statusCode: number; body: AdminListSecretsResponse }> {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: createFakeStoreFetch([], listResponder(lists)) },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    return { statusCode: response.statusCode, body: response.json() };
  } finally {
    await app.close();
    cleanup();
  }
}

void test("a registry name the store does not hold is listed with no metadata", async () => {
  const { statusCode, body } = await listAsAdmin({});

  assert.equal(statusCode, 200);

  for (const entry of SECRET_REGISTRY) {
    assert.deepEqual(rowFor(body, entry.name), {
      name: entry.name,
      tier: entry.tier,
      metadata: null,
      consumedBy: entry.consumedBy,
    });
  }
});

void test("a registry name the store holds carries its metadata and its consumedBy", async () => {
  const stored: SecretMetadata = { ...METADATA, name: PLATFORM_NAME };
  const { statusCode, body } = await listAsAdmin({ platform: [stored] });

  assert.equal(statusCode, 200);
  assert.deepEqual(rowFor(body, PLATFORM_NAME), {
    name: PLATFORM_NAME,
    tier: "platform",
    metadata: stored,
    consumedBy: secretRegistryEntry(PLATFORM_NAME).consumedBy,
  });
});

void test("a stored name the registry does not declare is listed with no consumedBy", async () => {
  const stored: SecretMetadata = { ...METADATA, name: INTEGRATION_NAME };
  const { statusCode, body } = await listAsAdmin({ integrations: [stored] });

  assert.equal(statusCode, 200);
  assert.deepEqual(rowFor(body, INTEGRATION_NAME), {
    name: INTEGRATION_NAME,
    tier: "integration",
    metadata: stored,
    consumedBy: null,
  });
});

void test("the response carries the higher active KEK version when a rotation lands mid-request", async () => {
  const { body } = await listAsAdmin({ activeKekVersion: { platform: 2, integrations: 1 } });

  assert.equal(body.activeKekVersion, 2);
});

/**
 * The whole point of the union: an unreachable tier must never render as
 * "missing", which would tell an operator the system lacks a credential it
 * actually has. Either list failing takes the whole route down instead.
 */
for (const failing of [
  { label: "the platform list", token: PLATFORM_TOKEN },
  { label: "the integrations list", token: INTEGRATIONS_TOKEN },
]) {
  void test(`a store failure on ${failing.label} makes the whole route a 502`, async () => {
    const { app, cleanup } = createTestApp(
      { ...CLERK_ENV, ...SECRETS_ENV },
      {
        secretsFetch: createFakeStoreFetch([], (request) =>
          request.authorization === `Bearer ${failing.token}`
            ? jsonResponse(500, { error: { code: "INTERNAL" } })
            : jsonResponse(200, { secrets: [METADATA], activeKekVersion: ACTIVE_KEK_VERSION }),
        ),
      },
    );

    try {
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: LIST_URL,
        headers: adminAuthHeaders(),
      });

      assert.equal(response.statusCode, 502);
      const body: ApiErrorEnvelope = response.json();
      assert.equal(body.error.code, "INTERNAL_ERROR");
    } finally {
      await app.close();
      cleanup();
    }
  });
}

// --- 6b. Store status mapping ---------------------------------------------

void test("a 409 from the store on create maps to 409 CLIENT_ERROR", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(409, { error: { code: "CONFLICT" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: CREATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 409);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "CLIENT_ERROR");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 400 from the store maps to 502 INTERNAL_ERROR", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(400, { error: { code: "VALIDATION_ERROR" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: CREATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 502);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 404 from the store on create maps to 404 NOT_FOUND with the out-of-namespace message", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(404, { error: { code: "NOT_FOUND" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: CREATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "outside/scope", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 404);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.match(body.error.message, /outside the namespace/);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 404 from the store on list maps to 502, never a client-side 404", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(404, { error: { code: "NOT_FOUND" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    // The list route names no secret, so an upstream 404 can only mean the
    // store's route is missing or this API's token lacks `manage` — faults on
    // our side, not the caller's. Reporting them as a client 404 would send an
    // operator hunting a secret that was never named.
    assert.equal(response.statusCode, 502);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.match(body.error.message, /The secrets store is unavailable/);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 404 from the store on rotate maps to 404 NOT_FOUND with the unreachable message", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(404, { error: { code: "NOT_FOUND" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: ROTATE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token", value: "ghp_newvalue" },
    });

    assert.equal(response.statusCode, 404);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.match(body.error.message, /No secret with that name is reachable/);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 404 from the store on delete maps to 404 NOT_FOUND with the unreachable message", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(404, { error: { code: "NOT_FOUND" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "DELETE",
      url: DELETE_URL,
      headers: adminAuthHeaders(),
      payload: { name: "github/api-token" },
    });

    assert.equal(response.statusCode, 404);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await app.close();
    cleanup();
  }
});

for (const status of [401, 403]) {
  void test(`a ${status} from the store maps to 502 INTERNAL_ERROR and never discloses the credential problem`, async () => {
    const { app, cleanup } = createTestApp(
      { ...CLERK_ENV, ...SECRETS_ENV },
      {
        secretsFetch: createFakeStoreFetch([], () =>
          jsonResponse(status, { error: { code: "FORBIDDEN" } }),
        ),
      },
    );

    try {
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: LIST_URL,
        headers: adminAuthHeaders(),
      });

      assert.equal(response.statusCode, 502);
      const body: ApiErrorEnvelope = response.json();
      assert.equal(body.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(body.error.message.toLowerCase(), /token|credential/);
    } finally {
      await app.close();
      cleanup();
    }
  });
}

void test("a 429 from the store maps to 429 RATE_LIMITED", async () => {
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () =>
        jsonResponse(429, { error: { code: "RATE_LIMITED" } }),
      ),
    },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    assert.equal(response.statusCode, 429);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "RATE_LIMITED");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a network failure maps to 502 INTERNAL_ERROR", async () => {
  const failingFetch: typeof fetch = () => Promise.reject(new Error("connection reset"));
  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    { secretsFetch: failingFetch },
  );

  try {
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: LIST_URL,
      headers: adminAuthHeaders(),
    });

    assert.equal(response.statusCode, 502);
    const body: ApiErrorEnvelope = response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
  } finally {
    await app.close();
    cleanup();
  }
});

// --- 7. Structural: no value-read surface reachable from this module -----

void test("the module source references neither getSecretValueContract nor getSecretValue", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/modules/secrets/index.ts", import.meta.url)),
    "utf8",
  );

  assert.ok(!source.includes("getSecretValueContract"));
  assert.ok(!source.includes("getSecretValue"));
});

// --- 8. Redaction ----------------------------------------------------------

void test("the plaintext value never appears in a captured log line or in any error envelope", async () => {
  const chunks: string[] = [];
  const responses: Response[] = [
    jsonResponse(400, { error: { code: "VALIDATION_ERROR" } }),
    jsonResponse(404, { error: { code: "NOT_FOUND" } }),
    jsonResponse(409, { error: { code: "CONFLICT" } }),
    jsonResponse(500, { error: { code: "INTERNAL" } }),
  ];
  let callIndex = 0;

  const { app, cleanup } = createTestApp(
    { ...CLERK_ENV, ...SECRETS_ENV },
    {
      secretsFetch: createFakeStoreFetch([], () => {
        const response = responses[callIndex] ?? jsonResponse(200, METADATA);
        callIndex += 1;
        return response;
      }),
      loggerStream: {
        write: (chunk) => {
          chunks.push(chunk);
        },
      },
    },
  );

  try {
    await app.ready();

    const bodies: Array<Record<string, unknown>> = [
      { name: "github/api-token", value: PLAINTEXT },
      { name: "github/api-token", value: PLAINTEXT },
      { name: "github/api-token", value: PLAINTEXT },
      { name: "github/api-token", value: PLAINTEXT },
    ];

    for (const payload of bodies) {
      const response = await app.inject({
        method: "POST",
        url: CREATE_URL,
        headers: adminAuthHeaders(),
        payload,
      });

      assert.ok(
        !JSON.stringify(response.json()).includes(PLAINTEXT),
        "error envelope leaked plaintext",
      );
    }

    assert.ok(chunks.length > 0, "expected at least one captured log record");
    assert.ok(
      chunks.every((chunk) => !chunk.includes(PLAINTEXT)),
      "a log line leaked plaintext",
    );
  } finally {
    await app.close();
    cleanup();
  }
});
