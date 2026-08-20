import assert from "node:assert/strict";
import test from "node:test";

import type { DeployDesiredState } from "@unimatrix/deploy-config";

import { createDokployClient, type DokployClient } from "../src/dokploy/client.js";
import { collectReconcileRun } from "../src/reconcile/collect.js";
import { renderReconcileRun } from "../src/reconcile/report.js";
import type { ReconcileRun } from "../src/reconcile/collect.js";

const BASE_URL = "http://dokploy:3000";
const API_KEY = "dokploy_test_key";
const CANARY = "sk_live_CANARY_DO_NOT_PRINT";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ONE_APP_DESIRED: DeployDesiredState = [
  {
    appDir: "api",
    packageName: "@unimatrix/api",
    kind: "node-api",
    composePath: "infra/docker/api-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-api",
    containerPort: 3001,
    env: [
      { name: "IMAGE_TAG", required: true },
      { name: "CLERK_SECRET_KEY", required: true },
    ],
  },
];

const PROJECTS_BODY = [
  {
    projectId: "project-1",
    name: "Unimatrix-01",
    environments: [
      {
        environmentId: "env-1",
        name: "production",
        compose: [{ composeId: "compose-1", composeStatus: "done", name: "api" }],
      },
    ],
  },
];

function clientWithComposeEnv(env: string): DokployClient {
  return createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (url) => {
      // callProcedure always passes a URL instance.
      const target = (url as URL).toString();

      if (target.includes("project.all")) {
        return Promise.resolve(jsonResponse(PROJECTS_BODY));
      }

      return Promise.resolve(
        jsonResponse({
          composeId: "compose-1",
          name: "api",
          environmentId: "env-1",
          composePath: "infra/docker/api-compose.yaml",
          sourceType: "github",
          branch: "main",
          autoDeploy: false,
          env,
        }),
      );
    },
  });
}

async function runWithEnv(
  env: string,
): Promise<{ run: ReconcileRun; rendered: readonly string[] }> {
  const client = clientWithComposeEnv(env);
  const run = await collectReconcileRun(client, ONE_APP_DESIRED);
  const rendered = renderReconcileRun(run);

  return { run, rendered };
}

void test("canary: a plaintext secret in Dokploy's env blob never reaches JSON.stringify(run)", async () => {
  const { run } = await runWithEnv(`CLERK_SECRET_KEY=${CANARY}\nHAND_EDITED_AT_2AM=value\n`);

  assert.ok(!JSON.stringify(run).includes(CANARY));
});

void test("canary: a plaintext secret in Dokploy's env blob never reaches the rendered report", async () => {
  const { rendered } = await runWithEnv(`CLERK_SECRET_KEY=${CANARY}\nHAND_EDITED_AT_2AM=value\n`);
  const joined = rendered.join("\n");

  assert.ok(!joined.includes(CANARY));
});

void test("an undeclared key IS reported by name, just never by value", async () => {
  const { rendered } = await runWithEnv(`CLERK_SECRET_KEY=${CANARY}\nHAND_EDITED_AT_2AM=value\n`);
  const joined = rendered.join("\n");

  assert.ok(joined.includes("HAND_EDITED_AT_2AM"));
  assert.ok(joined.includes("undeclared"));
});

void test("renders MISSING for a declared app with no matching Dokploy compose service", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse([])),
  });

  const run = await collectReconcileRun(client, ONE_APP_DESIRED);
  const rendered = renderReconcileRun(run);

  assert.deepEqual(rendered, ['api: MISSING — no Dokploy compose service named "api"']);
});

void test("renders AMBIGUOUS when more than one Dokploy compose service shares the name", async () => {
  const projects = [
    {
      projectId: "project-1",
      name: "Unimatrix-01",
      environments: [
        {
          environmentId: "env-1",
          name: "production",
          compose: [
            { composeId: "compose-1", composeStatus: "done", name: "api" },
            { composeId: "compose-2", composeStatus: "done", name: "api" },
          ],
        },
      ],
    },
  ];
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse(projects)),
  });

  const run = await collectReconcileRun(client, ONE_APP_DESIRED);
  const rendered = renderReconcileRun(run);

  assert.deepEqual(rendered, ['api: AMBIGUOUS — 2 Dokploy compose services named "api"']);
});

void test("renders IN SYNC when every env and setting finding matches", async () => {
  const { rendered } = await runWithEnv(`CLERK_SECRET_KEY=set-value\nIMAGE_TAG=abc123\n`);

  assert.deepEqual(rendered, ["api: IN SYNC"]);
});

void test("a Dokploy compose service the repo declares nowhere is simply never reported", async () => {
  const projects = [
    {
      projectId: "project-1",
      name: "Smart Home",
      environments: [
        {
          environmentId: "env-1",
          name: "production",
          compose: [{ composeId: "compose-9", composeStatus: "done", name: "home-assistant" }],
        },
      ],
    },
  ];
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: () => Promise.resolve(jsonResponse(projects)),
  });

  // ONE_APP_DESIRED declares only "api" — reconcile is desired-state-driven, so the
  // "home-assistant" service above is invisible to it, and "api" is reported missing.
  const run = await collectReconcileRun(client, ONE_APP_DESIRED);
  const rendered = renderReconcileRun(run);

  assert.deepEqual(rendered, ['api: MISSING — no Dokploy compose service named "api"']);
});

void test("renders ERROR when compose.one fails, isolated to that app", async () => {
  const client = createDokployClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    fetch: (url) => {
      // callProcedure always passes a URL instance.
      const target = (url as URL).toString();

      if (target.includes("project.all")) {
        return Promise.resolve(jsonResponse(PROJECTS_BODY));
      }

      return Promise.resolve(jsonResponse({ message: "boom" }, 500));
    },
  });

  const run = await collectReconcileRun(client, ONE_APP_DESIRED);
  const rendered = renderReconcileRun(run);

  assert.equal(rendered.length, 1);
  assert.ok(rendered[0]?.startsWith("api: ERROR — "));
});
