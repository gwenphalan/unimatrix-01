import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@unimatrix/db";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { buildApp, type BuildApiAppOptions } from "../src/app.js";
import { loadApiRuntimeConfig, type ApiRuntimeEnv } from "../src/config.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

const SECRETS_ENV: ApiRuntimeEnv = {
  SECRETS_BASE_URL: "http://secrets.internal:3002",
  SECRETS_SERVICE_TOKEN: "svc_test_token",
};

/** Never appears in a captured log line — see the redaction test below. */
const PLAINTEXT = "TOTALLY-SECRET-PLAINTEXT-VALUE";

type FakeSecretsResponse = { status: number; value?: string } | "hang" | "reject";

/**
 * A minimal `typeof fetch` standing in for the secrets service: keyed by the
 * `name` query parameter, same shape `packages/secrets/test/client.test.ts`
 * exercises against the real client. `signals`, when given, records the
 * `AbortSignal` each call received — used to prove the boot deadline is
 * shared, not per-name (see the "shares one deadline" test below).
 */
function createFakeSecretsFetch(
  responses: Record<string, FakeSecretsResponse>,
  signals?: AbortSignal[],
): typeof fetch {
  const impl: typeof fetch = (input, init) => {
    const url = new URL(
      input instanceof URL ? input : input instanceof Request ? input.url : input,
    );
    const name = url.searchParams.get("name") ?? "";

    if (init?.signal) {
      signals?.push(init.signal);
    }

    const spec = responses[name];

    if (spec === undefined || spec === "reject") {
      return Promise.reject(new Error(`no fake response configured for ${name}`));
    }

    if (spec === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }

    const body =
      spec.status === 200
        ? { name, value: spec.value ?? "unused-value" }
        : { error: { code: "NOT_FOUND" } };

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: spec.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  return impl;
}

interface TestContext {
  app: ReturnType<typeof buildApp>;
  cleanup: () => void;
}

/**
 * Builds an app against a throwaway SQLite file, mirroring
 * `content-routes.test.ts` — the database plugin runs unconditionally, so
 * every test here needs one even though none of them touch it.
 */
function createTestApp(env: ApiRuntimeEnv, options: BuildApiAppOptions = {}): TestContext {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-integration-credentials-"));
  const filePath = join(directory, "integration-credentials.sqlite");
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

void test("a boot fetch populates the cache and get(name) returns the value", async () => {
  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token" },
    { secretsFetch: createFakeSecretsFetch({ "github/token": { status: 200, value: "abc123" } }) },
  );

  try {
    await app.ready();

    assert.equal(app.integrationCredentials.get("github/token")?.reveal(), "abc123");
    assert.notEqual(app.integrationCredentials.loadedAt, null);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a fetch that rejects leaves the app answering /health with an empty cache", async () => {
  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token" },
    { secretsFetch: createFakeSecretsFetch({}) },
  );

  try {
    await app.ready();

    assert.equal(app.integrationCredentials.get("github/token"), undefined);

    const health = await app.inject({ method: "GET", url: "/health" });

    assert.equal(health.statusCode, 200);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a 404 for one name records it denied while a second name still loads", async () => {
  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token,discord/webhook" },
    {
      secretsFetch: createFakeSecretsFetch({
        "github/token": { status: 404 },
        "discord/webhook": { status: 200, value: "webhook-value" },
      }),
    },
  );

  try {
    await app.ready();

    // The boot fetch already ran `refresh()` once inside `onReady`, which
    // discards its own result — a second call against the same fake fetch
    // reaches the same outcome and hands the `RefreshResult` back directly.
    const result = await app.integrationCredentials.refresh();

    assert.deepEqual(result.denied, ["github/token"]);
    assert.deepEqual(result.loaded, ["discord/webhook"]);
    assert.equal(app.integrationCredentials.get("discord/webhook")?.reveal(), "webhook-value");
    assert.equal(app.integrationCredentials.get("github/token"), undefined);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a failed refresh leaves a previously cached value in place", async () => {
  const responses: Record<string, FakeSecretsResponse> = {
    "github/token": { status: 200, value: "first-value" },
  };
  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token" },
    { secretsFetch: createFakeSecretsFetch(responses) },
  );

  try {
    await app.ready();
    assert.equal(app.integrationCredentials.get("github/token")?.reveal(), "first-value");

    // The fake fetch reads `responses` on every call, so removing the entry
    // makes the next `refresh()` reject for this name without rebuilding the
    // app — there is no seam to swap the fetch implementation after `buildApp()`.
    delete responses["github/token"];

    const result = await app.integrationCredentials.refresh();

    assert.deepEqual(result.failed, ["github/token"]);
    assert.equal(
      app.integrationCredentials.get("github/token")?.reveal(),
      "first-value",
      "a failed refresh must not empty a working cache",
    );
  } finally {
    await app.close();
    cleanup();
  }
});

void test("refresh() re-fetches and returns a rotated value", async () => {
  const responses: Record<string, FakeSecretsResponse> = {
    "github/token": { status: 200, value: "original-value" },
  };
  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token" },
    { secretsFetch: createFakeSecretsFetch(responses) },
  );

  try {
    await app.ready();
    assert.equal(app.integrationCredentials.get("github/token")?.reveal(), "original-value");

    responses["github/token"] = { status: 200, value: "rotated-value" };

    const result = await app.integrationCredentials.refresh();

    assert.deepEqual(result.loaded, ["github/token"]);
    assert.equal(app.integrationCredentials.get("github/token")?.reveal(), "rotated-value");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("every configured name is fetched concurrently, so a hang does not multiply by the name count", async () => {
  const callTimestamps: number[] = [];
  const fetchImpl = createFakeSecretsFetch({
    "github/token": { status: 200, value: "a" },
    "discord/webhook": { status: 200, value: "b" },
  });
  const trackedFetch: typeof fetch = (input, init) => {
    callTimestamps.push(Date.now());
    return fetchImpl(input, init);
  };

  const { app, cleanup } = createTestApp(
    { ...SECRETS_ENV, SECRETS_INTEGRATION_NAMES: "github/token,discord/webhook" },
    { secretsFetch: trackedFetch },
  );

  try {
    await app.ready();

    assert.equal(callTimestamps.length, 2, "one fetch per configured name");

    // `refresh()` builds every request from `names.map(...)` and awaits them
    // together through `Promise.allSettled` — both calls start in the same
    // tick. A sequential per-name loop (one shared deadline notwithstanding)
    // would space these calls out by however long each fetch took; started
    // together, they land within a few milliseconds of each other.
    const [first, second] = callTimestamps;
    assert.ok(
      first !== undefined && second !== undefined && Math.abs(second - first) < 50,
      `expected both fetches to start together, got a ${Math.abs((second ?? 0) - (first ?? 0))}ms gap`,
    );
  } finally {
    await app.close();
    cleanup();
  }
});

void test("with secretsStore null nothing is decorated and no fetch is attempted", async () => {
  const fetchImpl = createFakeSecretsFetch({});
  let called = false;
  const trackedFetch: typeof fetch = (input, init) => {
    called = true;
    return fetchImpl(input, init);
  };

  const { app, cleanup } = createTestApp({}, { secretsFetch: trackedFetch });

  try {
    await app.ready();

    assert.equal(app.integrationCredentials, undefined);
    assert.equal(called, false);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("a malformed configured name throws at setup", () => {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-integration-credentials-"));
  const filePath = join(directory, "integration-credentials.sqlite");
  const previousDatabaseUrl = process.env.DATABASE_URL;

  const instance = createDatabase({ filePath });
  migrate(instance.db, { migrationsFolder: MIGRATIONS_FOLDER });
  instance.client.close();

  process.env.DATABASE_URL = filePath;

  try {
    assert.throws(
      () =>
        buildApp(
          loadApiRuntimeConfig({
            LOG_LEVEL: "error",
            NODE_ENV: "test",
            ...SECRETS_ENV,
            SECRETS_INTEGRATION_NAMES: "Not A Valid Name!",
          }),
          { secretsFetch: createFakeSecretsFetch({}) },
        ),
      /malformed name/,
    );
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("no log record emitted during a boot fetch contains the plaintext", async () => {
  const chunks: string[] = [];
  const { app, cleanup } = createTestApp(
    {
      ...SECRETS_ENV,
      SECRETS_INTEGRATION_NAMES: "github/token,discord/webhook",
      LOG_LEVEL: "warn",
    },
    {
      // One name loads (carrying the plaintext) and one is denied — the
      // denial guarantees at least one `warn`-level log record exists to
      // assert against, since a successful load logs nothing on its own.
      secretsFetch: createFakeSecretsFetch({
        "github/token": { status: 200, value: PLAINTEXT },
        "discord/webhook": { status: 404 },
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

    assert.equal(app.integrationCredentials.get("github/token")?.reveal(), PLAINTEXT);
    assert.ok(chunks.length > 0, "expected at least the denial's warn-level log record");
    assert.ok(chunks.every((chunk) => !chunk.includes(PLAINTEXT)));
  } finally {
    await app.close();
    cleanup();
  }
});
