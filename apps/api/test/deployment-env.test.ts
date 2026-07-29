import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiRuntimeConfig } from "../src/config.js";

const COMPOSE_PATH = fileURLToPath(
  new URL("../../../infra/docker/api-compose.yaml", import.meta.url),
);

/**
 * The env the deployed container is actually given, minus anything the compose
 * file leaves to the platform. Kept in step with `infra/docker/api-compose.yaml`
 * by {@link readComposeEnvNames} below rather than by hand.
 */
const PLATFORM_SUPPLIED = [
  "CORS_ALLOWED_ORIGINS",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_JWT_KEY",
];

/** The `KEY: value` names under the api service's `environment:` block. */
async function readComposeEnvNames(): Promise<Set<string>> {
  const source = await readFile(COMPOSE_PATH, "utf8");
  const names = new Set<string>();
  let inEnvironment = false;

  for (const line of source.split("\n")) {
    if (/^\s{4}environment:\s*$/u.test(line)) {
      inEnvironment = true;
      continue;
    }

    if (inEnvironment && /^\s{0,4}\S/u.test(line)) {
      inEnvironment = false;
    }

    const match = inEnvironment ? /^\s{6}([A-Z0-9_]+):/u.exec(line) : null;

    if (match?.[1] !== undefined) {
      names.add(match[1]);
    }
  }

  return names;
}

/**
 * Compose passes a container nothing it does not name. A variable set in the
 * deployment platform but absent from `environment:` never reaches the process,
 * and for the `CLERK_*` trio that is a boot failure in production — which from
 * outside looks like every route 404ing, not like a configuration mistake.
 */
void test("the api compose file passes through every variable production requires", async () => {
  const declared = await readComposeEnvNames();

  for (const name of PLATFORM_SUPPLIED) {
    assert.ok(declared.has(name), `${name} is missing from the api service's environment block`);
  }
});

/**
 * The other half of the same guard: proves the config layer really does refuse
 * to boot without the trio, so the assertion above is protecting something.
 */
void test("production config rejects an environment missing the Clerk variables", () => {
  assert.throws(
    () =>
      loadApiRuntimeConfig({
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3001",
        CORS_ALLOWED_ORIGINS: "https://unimatrix-01.dev",
      }),
    /CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_JWT_KEY must be set in production/u,
  );
});
