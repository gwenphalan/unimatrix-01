import assert from "node:assert/strict";
import test from "node:test";

import {
  createDokployClient,
  DokployClientError,
  loadDokployApiKey,
} from "../src/dokploy/client.js";

const BASE_URL = "http://dokploy:3000";
const API_KEY = "dokploy_super_secret_key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

void test("loadDokployApiKey returns the trimmed key", () => {
  assert.equal(loadDokployApiKey({ DOKPLOY_API_KEY: "  a-key  " }), "a-key");
});

void test("loadDokployApiKey throws with no key", () => {
  assert.throws(() => loadDokployApiKey({}), /DOKPLOY_API_KEY must be set/);
});

void test("loadDokployApiKey throws with a blank key", () => {
  assert.throws(() => loadDokployApiKey({ DOKPLOY_API_KEY: "   " }), /DOKPLOY_API_KEY must be set/);
});

void test("getDokployVersion sends the x-api-key header and parses a valid body", async () => {
  let capturedHeaders: Headers | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(jsonResponse("v0.29.13"));
    },
  });

  const version = await client.getDokployVersion();

  assert.equal(version, "v0.29.13");
  assert.equal(capturedHeaders?.get("x-api-key"), API_KEY);
});

void test("getContainers parses a valid body", async () => {
  const container = {
    containerId: "abc123",
    name: "deploy",
    image: "ghcr.io/unimatrixcore/unimatrix-deploy:main",
    ports: "3001/tcp",
    state: "running",
    status: "Up 2 hours",
  };
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse([container])),
  });

  assert.deepEqual(await client.getContainers(), [container]);
});

void test("a non-2xx response throws DokployClientError carrying the status", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse({ message: "nope" }, 403)),
  });

  await assert.rejects(
    () => client.getDokployVersion(),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      assert.equal(error.status, 403);
      return true;
    },
  );
});

void test("a non-JSON body throws DokployClientError", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(new Response("not json", { status: 200 })),
  });

  await assert.rejects(
    () => client.getDokployVersion(),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      assert.equal(error.status, 200);
      return true;
    },
  );
});

void test("a body failing the schema throws DokployClientError", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse({ notVersion: true })),
  });

  await assert.rejects(
    () => client.getDokployVersion(),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      return true;
    },
  );
});

void test("getProjects sends the x-api-key header and strips the project-level env blob", async () => {
  let capturedHeaders: Headers | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        jsonResponse([
          {
            projectId: "project-1",
            name: "Unimatrix-01",
            env: "SECRETS_KEKS=super-secret-blob\n",
            environments: [
              {
                environmentId: "env-1",
                name: "production",
                compose: [{ composeId: "compose-1", composeStatus: "done", name: "api" }],
              },
            ],
          },
        ]),
      );
    },
  });

  const projects = await client.getProjects();

  assert.equal(capturedHeaders?.get("x-api-key"), API_KEY);
  assert.equal(projects.length, 1);
  assert.equal(Object.hasOwn(projects[0] ?? {}, "env"), false);
  assert.equal(JSON.stringify(projects).includes("super-secret-blob"), false);
});

void test("getCompose builds the composeId query param through URL/URLSearchParams", async () => {
  let capturedUrl: string | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (url) => {
      // callProcedure always passes a URL instance.
      capturedUrl = (url as URL).toString();
      return Promise.resolve(
        jsonResponse({
          composeId: "abc&123#",
          name: "api",
          environmentId: "env-1",
          composePath: "infra/docker/api-compose.yaml",
          sourceType: "github",
          branch: "main",
          autoDeploy: false,
          owner: "unimatrixcore",
          repository: "unimatrix-01",
          env: null,
        }),
      );
    },
  });

  await client.getCompose("abc&123#");

  // A composeId containing & or # cannot reshape the request into extra query params or drop the
  // rest of the URL — URLSearchParams percent-encodes both.
  assert.equal(capturedUrl, `${BASE_URL}/api/compose.one?composeId=abc%26123%23`);
});

void test("getCompose sends the x-api-key header and reduces env to key/blank pairs", async () => {
  let capturedHeaders: Headers | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        jsonResponse({
          composeId: "compose-1",
          name: "api",
          environmentId: "env-1",
          composePath: "infra/docker/api-compose.yaml",
          sourceType: "github",
          branch: "main",
          autoDeploy: false,
          owner: "unimatrixcore",
          repository: "unimatrix-01",
          env: "CLERK_SECRET_KEY=sk_live_whatever\nEMPTY_VAR=\n",
        }),
      );
    },
  });

  const compose = await client.getCompose("compose-1");

  assert.equal(capturedHeaders?.get("x-api-key"), API_KEY);
  assert.deepEqual(compose.env, [
    { key: "CLERK_SECRET_KEY", blank: false },
    { key: "EMPTY_VAR", blank: true },
  ]);
});

void test("a compose.one 500 whose body is an env blob throws DokployClientError carrying no fragment of it", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () =>
      Promise.resolve(jsonResponse({ env: "SECRETS_KEKS=leaked-value-if-this-ever-appears" }, 500)),
  });

  await assert.rejects(
    () => client.getCompose("compose-1"),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      assert.equal(error.status, 500);
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      assert.ok(!serialized.includes("leaked-value-if-this-ever-appears"));
      return true;
    },
  );
});

void test("updateComposeSettings POSTs JSON to compose.update with the x-api-key and content-type headers", async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: string | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (url, init) => {
      capturedUrl = (url as URL).toString();
      capturedInit = init;
      return Promise.resolve(jsonResponse({ composeId: "compose-1" }));
    },
  });

  await client.updateComposeSettings("compose-1", { branch: "main" });

  assert.equal(capturedUrl, `${BASE_URL}/api/compose.update`);
  assert.equal(capturedInit?.method, "POST");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-api-key"), API_KEY);
  assert.equal(headers.get("content-type"), "application/json");
});

void test("updateComposeSettings serialises exactly composeId plus the settings passed, no more", async () => {
  let capturedBody: string | undefined;
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (_url, init) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse({ composeId: "compose-1" }));
    },
  });

  await client.updateComposeSettings("compose-1", { composePath: "infra/docker/api-compose.yaml" });

  assert.ok(capturedBody !== undefined);
  const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["composeId", "composePath"]);
  assert.deepEqual(parsed, {
    composeId: "compose-1",
    composePath: "infra/docker/api-compose.yaml",
  });
});

void test("updateComposeSettings on a 200 resolves to undefined and never reads the body", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () =>
      Promise.resolve(
        jsonResponse({
          composeId: "compose-1",
          env: "SECRETS_KEKS=super-secret-if-this-is-ever-read",
        }),
      ),
  });

  const call = client.updateComposeSettings("compose-1", { autoDeploy: false }) as Promise<unknown>;
  const result = await call;

  assert.equal(result, undefined);
});

void test("updateComposeSettings on a 400 names field keys only, never a zod message or an env value", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () =>
      Promise.resolve(
        jsonResponse(
          {
            code: "BAD_REQUEST",
            message: 'Invalid input: expected string, received number at "branch"',
            data: {
              zodError: {
                formErrors: [],
                fieldErrors: {
                  branch: [
                    'Invalid input: expected string, received number, value "SECRETS_KEKS=leaked-if-printed"',
                  ],
                },
              },
            },
            issues: [],
          },
          400,
        ),
      ),
  });

  await assert.rejects(
    () => client.updateComposeSettings("compose-1", { branch: "main" }),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      assert.equal(error.status, 400);
      assert.ok(error.message.includes("branch"));
      assert.ok(!error.message.includes("leaked-if-printed"));
      assert.ok(!error.message.includes("Invalid input"));
      return true;
    },
  );
});

void test("updateComposeSettings on a non-JSON error body degrades to the bare status", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(new Response("not json", { status: 500 })),
  });

  await assert.rejects(
    () => client.updateComposeSettings("compose-1", { branch: "main" }),
    (error: unknown) => {
      assert.ok(error instanceof DokployClientError);
      assert.equal(error.status, 500);
      return true;
    },
  );
});

void test("no thrown error ever carries the API key or a response-body fragment", async () => {
  const sensitiveBody = { project: "prod", secretEnvBlob: "SECRETS_KEKS=super-sensitive-value" };
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse(sensitiveBody, 500)),
  });

  await assert.rejects(
    () => client.getDokployVersion(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(API_KEY));
      assert.ok(!error.message.includes("secretEnvBlob"));
      assert.ok(!error.message.includes("super-sensitive-value"));
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      assert.ok(!serialized.includes(API_KEY));
      assert.ok(!serialized.includes("secretEnvBlob"));
      assert.ok(!serialized.includes("super-sensitive-value"));
      return true;
    },
  );
});
