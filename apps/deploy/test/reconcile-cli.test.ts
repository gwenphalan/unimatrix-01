import assert from "node:assert/strict";
import test from "node:test";

import type { DeployDesiredState } from "@unimatrix/deploy-config";

import type { DokployClient } from "../src/dokploy/client.js";
import { runReconcileCli } from "../src/cli/reconcile.js";

const IN_SYNC_DESIRED: DeployDesiredState = [
  {
    appDir: "api",
    packageName: "@unimatrix/api",
    kind: "node-api",
    composePath: "infra/docker/api-compose.yaml",
    image: "ghcr.io/unimatrixcore/unimatrix-api",
    containerPort: 3001,
    env: [{ name: "IMAGE_TAG", required: true }],
  },
];

function stubClient(overrides: Partial<DokployClient> = {}): DokployClient {
  return {
    getDokployVersion: () => Promise.reject(new Error("not used")),
    getContainers: () => Promise.reject(new Error("not used")),
    getProjects: () => Promise.resolve([]),
    getCompose: () => Promise.reject(new Error("not used")),
    ...overrides,
  };
}

function collectLines(): { write: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { write: (line) => lines.push(line), lines };
}

const IN_SYNC_PROJECTS = [
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

void test("exit 0 when every declared app is in sync", async () => {
  const { write, lines } = collectLines();
  const client = stubClient({
    getProjects: () => Promise.resolve(IN_SYNC_PROJECTS),
    getCompose: () =>
      Promise.resolve({
        composeId: "compose-1",
        name: "api",
        environmentId: "env-1",
        composePath: "infra/docker/api-compose.yaml",
        sourceType: "github",
        branch: "main",
        autoDeploy: false,
        env: [{ key: "IMAGE_TAG", blank: false }],
      }),
  });

  const exitCode = await runReconcileCli(["report"], { client, desired: IN_SYNC_DESIRED, write });

  assert.equal(exitCode, 0);
  assert.deepEqual(lines, ["api: IN SYNC"]);
});

void test("exit 1 when an app needs a decision (missing)", async () => {
  const { write, lines } = collectLines();
  const client = stubClient({ getProjects: () => Promise.resolve([]) });

  const exitCode = await runReconcileCli(["report"], { client, desired: IN_SYNC_DESIRED, write });

  assert.equal(exitCode, 1);
  assert.deepEqual(lines, ['api: MISSING — no Dokploy compose service named "api"']);
});

void test("exit 2 when the run cannot complete at all (project.all fails)", async () => {
  const { write, lines } = collectLines();
  const client = stubClient({ getProjects: () => Promise.reject(new Error("network down")) });

  const exitCode = await runReconcileCli(["report"], { client, desired: IN_SYNC_DESIRED, write });

  assert.equal(exitCode, 2);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("could not complete"));
});

void test("exit 2 when a single app's compose.one fails, isolated to that app rather than aborting", async () => {
  const { write, lines } = collectLines();
  const twoAppDesired: DeployDesiredState = [
    ...IN_SYNC_DESIRED,
    {
      appDir: "web",
      packageName: "@unimatrix/web",
      kind: "static-spa",
      composePath: "infra/docker/web-compose.yaml",
      image: "ghcr.io/unimatrixcore/unimatrix-web",
      containerPort: 8080,
      env: [{ name: "IMAGE_TAG", required: true }],
    },
  ];
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
            { composeId: "compose-2", composeStatus: "done", name: "web" },
          ],
        },
      ],
    },
  ];
  const client = stubClient({
    getProjects: () => Promise.resolve(projects),
    getCompose: (composeId) =>
      composeId === "compose-1"
        ? Promise.reject(new Error("dokploy said no"))
        : Promise.resolve({
            composeId: "compose-2",
            name: "web",
            environmentId: "env-1",
            composePath: "infra/docker/web-compose.yaml",
            sourceType: "github",
            branch: "main",
            autoDeploy: false,
            env: [{ key: "IMAGE_TAG", blank: false }],
          }),
  });

  const exitCode = await runReconcileCli(["report"], { client, desired: twoAppDesired, write });

  assert.equal(exitCode, 2);
  // Both apps are reported — the api failure did not abort the web app's diff.
  assert.equal(lines.length, 2);
  assert.ok(lines.some((line) => line.startsWith("api: ERROR — ")));
  assert.ok(lines.some((line) => line === "web: IN SYNC"));
});

void test("prints usage and exits 2 with no subcommand", async () => {
  const { write, lines } = collectLines();
  const client = stubClient();

  const exitCode = await runReconcileCli([], { client, desired: IN_SYNC_DESIRED, write });

  assert.equal(exitCode, 2);
  assert.ok(lines.some((line) => line.startsWith("Usage:")));
});

void test("prints usage and exits 2 with an unknown subcommand", async () => {
  const { write, lines } = collectLines();
  const client = stubClient();

  const exitCode = await runReconcileCli(["apply"], { client, desired: IN_SYNC_DESIRED, write });

  assert.equal(exitCode, 2);
  assert.ok(lines.some((line) => line.startsWith("Usage:")));
});

void test("prints usage and exits 2 when report carries a trailing argument", async () => {
  const { write, lines } = collectLines();
  const client = stubClient();

  const exitCode = await runReconcileCli(["report", "--apply"], {
    client,
    desired: IN_SYNC_DESIRED,
    write,
  });

  assert.equal(exitCode, 2);
  assert.ok(lines.some((line) => line.startsWith("Usage:")));
});
