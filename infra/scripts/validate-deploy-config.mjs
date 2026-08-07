#!/usr/bin/env node
//
// Validates every `apps/<app>/deploy.config.ts` before the generator ever
// writes a file from it.
//
// `packages/deploy-config`'s own `validateAppConfig()` covers what a config
// can fail on its own — see that package's `AGENTS.md`. This script adds
// everything that needs the filesystem or `apps/api/src/config.ts`, neither
// of which that package may import (a pkg -> app edge is a lint error under
// `boundaries.mjs`, and this script sits in no workspace, so it imports both
// by absolute path instead):
//
//   1. Pairing, both directions. Every `apps/*/Dockerfile` needs a
//      `deploy.config.ts`, and so does every `infra/docker/*-compose.yaml` —
//      the generator iterates *discovered configs*, never `apps/*`, so a
//      deleted app's compose file would otherwise sit un-generated and
//      un-checked forever. Also asserts a config's own `appDir` names the
//      directory it actually lives in: `build.dockerfile`/`build.context`
//      and the compose filename are derived from `appDir` inside the
//      generator, so a mismatch here is what would let them drift.
//   2. The API probe. Builds the effective env — the config's own
//      `dockerfileEnv` overlaid by `composeEnv` — and feeds it to the real
//      `loadApiRuntimeConfig`, so this cannot drift from the parser it is
//      checking against. `NODE_ENV` is checked first: `parseClerkConfig`
//      returns `null` instead of throwing outside production, so probing a
//      non-production effective env would measure nothing.
//
// Fails closed on zero configs discovered, matching `check-watch-paths.mjs`
// and `check-coverage-drift.mjs`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appsDir = join(repoRoot, "apps");
const composeDir = join(repoRoot, "infra", "docker");

/**
 * Placeholders for a compose `${VAR}` reference with no default, used only to
 * build the env the API config parser is probed with. A var whose parser
 * validates a format needs an entry here that satisfies it.
 */
const PLACEHOLDERS = {
  CORS_ALLOWED_ORIGINS: "https://placeholder.example",
};
const DEFAULT_PLACEHOLDER = "placeholder";

let failures = 0;
const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures += 1;
};

console.log(
  "validate-deploy-config: every apps/*/Dockerfile and compose file needs a deploy.config.ts\n",
);

const appDirs = existsSync(appsDir)
  ? readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

const appsWithDockerfile = appDirs.filter((app) => existsSync(join(appsDir, app, "Dockerfile")));
const appsWithConfig = appDirs.filter((app) => existsSync(join(appsDir, app, "deploy.config.ts")));

const composeApps = existsSync(composeDir)
  ? readdirSync(composeDir)
      .map((name) => /^(.+)-compose\.yaml$/u.exec(name)?.[1])
      .filter((name) => name !== undefined)
      .sort()
  : [];

for (const app of appsWithDockerfile) {
  if (!appsWithConfig.includes(app)) {
    fail(`apps/${app}/Dockerfile exists but apps/${app}/deploy.config.ts does not.`);
  }
}
for (const app of composeApps) {
  if (!appsWithConfig.includes(app)) {
    fail(
      `infra/docker/${app}-compose.yaml exists but apps/${app}/deploy.config.ts does not — an ` +
        `orphaned compose file the generator never writes or checks again.`,
    );
  }
}

if (appsWithConfig.length === 0) {
  fail("no apps/*/deploy.config.ts found — this check cannot pass vacuously");
  console.log(`\nvalidate-deploy-config: ${failures} failure(s).`);
  process.exit(1);
}

const { validateAppConfig } = await import(
  pathToFileURL(join(repoRoot, "packages", "deploy-config", "src", "index.ts")).href
);

/** Resolves one compose env value to what the probe should see. */
function resolveComposeEnvValue(value) {
  if (value.kind === "literal") {
    const trimmed = value.value.trim();
    return /^".*"$/u.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  }
  if (value.default !== undefined) return value.default;
  return PLACEHOLDERS[value.name] ?? DEFAULT_PLACEHOLDER;
}

let sawNodeApiConfig = false;

for (const app of appsWithConfig) {
  const configPath = join(appsDir, app, "deploy.config.ts");
  const mod = await import(pathToFileURL(configPath).href);
  const config = mod.default;

  if (config === undefined || typeof config !== "object") {
    fail(`apps/${app}/deploy.config.ts must have a default export.`);
    continue;
  }

  if (config.appDir !== app) {
    fail(
      `apps/${app}/deploy.config.ts declares appDir ${JSON.stringify(config.appDir)}, which does ` +
        `not match the directory it lives in. build.dockerfile and the compose filename are both ` +
        `derived from appDir, so a mismatch here is what lets them point at the wrong app.`,
    );
  }

  for (const message of validateAppConfig(config)) {
    fail(`apps/${app}/deploy.config.ts — ${message}`);
  }

  if (config.kind !== "node-api") continue;
  sawNodeApiConfig = true;

  const effectiveEnv = {};
  for (const entry of config.dockerfileEnv) effectiveEnv[entry.name] = entry.value;
  for (const entry of config.composeEnv)
    effectiveEnv[entry.name] = resolveComposeEnvValue(entry.value);

  if (effectiveEnv.NODE_ENV !== "production") {
    fail(
      `apps/${app}/deploy.config.ts — the effective NODE_ENV is ${effectiveEnv.NODE_ENV ?? "unset"}, ` +
        `not production. Outside production the API config parser tolerates missing CLERK_* ` +
        `variables, so the probe below would measure nothing.`,
    );
    continue;
  }

  const { loadApiRuntimeConfig } = await import(
    pathToFileURL(join(repoRoot, "apps", "api", "src", "config.ts")).href
  );

  try {
    loadApiRuntimeConfig(effectiveEnv);
  } catch (error) {
    fail(`apps/${app}/deploy.config.ts — ${error.message}`);
  }
}

if (!sawNodeApiConfig) {
  console.log("  note  no node-api config found — the API probe did not run this time");
}

console.log("");

if (failures > 0) {
  console.log(`validate-deploy-config: ${failures} failure(s).`);
  process.exit(1);
}

console.log(`validate-deploy-config: OK (${appsWithConfig.length} deploy config(s)).`);
