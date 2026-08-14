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
      return Promise.resolve(jsonResponse({ version: "0.29.13" }));
    },
  });

  const version = await client.getDokployVersion();

  assert.deepEqual(version, { version: "0.29.13" });
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
