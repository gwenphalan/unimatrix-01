#!/usr/bin/env node
//
// The deploy artifacts under `infra/docker/` must configure the images they
// build. No other check reads them.
//
// It happened: `infra/docker/api-compose.yaml` named no `CLERK_*` variable
// under `environment:`, so the deployed container sat in `Restarting (1)` with
// a one-second lifetime while every required `Images` check stayed green —
// correctly, because the *image* was fine. Fixed in #120. Proving the image
// runs and proving the deployment configures it are different checks, and only
// the second was ever missing: a container-start smoke on the built image would
// not have caught it.
//
// `infra/docker/README.md` holds the compose-file contract — which files exist,
// that each is single-service, and which variables each one reads. This script
// enforces four things on top of it.
//
//   1. Pairing. Every `apps/*/Dockerfile` has an `infra/docker/<app>-compose.yaml`
//      and vice versa, and each compose file's `build.dockerfile` and
//      `build.context` match the convention. Without the second half, pointing
//      `admin-compose.yaml` at `apps/web/Dockerfile` leaves every check green —
//      `Images (admin)` builds the Dockerfile directly and never reads compose —
//      while the deploy builds the wrong image.
//   2. The API probe. The effective env is the Dockerfile's `ENV` lines
//      overlaid by the compose `environment:` block, and it is fed to the real
//      `loadApiRuntimeConfig`. The overlay ordering matters: `apps/api/Dockerfile`
//      already sets `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL` and `DATABASE_URL`,
//      so asserting against the compose file alone would redden on deleting
//      those redundant compose lines — a change that leaves the container
//      booting identically.
//   3. Vite build args. Every `ARG VITE_*` in an app's Dockerfile appears under
//      `build.args:` and vice versa, *and* a value is actually passed for an
//      `ARG` with no Dockerfile default. Key presence alone is not enough:
//      changing admin's `${VITE_CLERK_PUBLISHABLE_KEY}` to `${VITE_CLERK_PUBLISHABLE_KEY:-}`
//      keeps the key present, lets Vite inline an empty string without
//      complaint, and leaves `loadAdminAppRuntimeConfig` throwing in the browser
//      on first load — the same shape as #120, passing through the check built
//      to catch it. `apps/web/Dockerfile` declares `ARG VITE_CLERK_PUBLISHABLE_KEY=`,
//      an empty *default*, so web's `${VITE_CLERK_PUBLISHABLE_KEY:-}` is
//      legitimate and this rule does not fire there.
//   4. A compose mini-parser, because this step runs before `pnpm install` and
//      no YAML library is resolvable.
//
// Two constraints on the files this reads:
//
//   - `apps/api/src/config.ts` must stay erasable-syntax-only. It is imported
//     here through Node's type stripping, which refuses enums, namespaces and
//     parameter properties; any of those and the probe stops loading. It
//     currently imports only `node:net`, so it loads with no `node_modules` on
//     the path.
//   - A future API env var with a format validator needs an entry in
//     `PLACEHOLDERS` below. The failure is loud — the parser's own message —
//     never a silent pass. `CORS_ALLOWED_ORIGINS` is the one entry required
//     today: the bare `"placeholder"` default throws `must be valid http:// or
//     https:// origins`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const composeDir = join(repoRoot, "infra", "docker");
const appsDir = join(repoRoot, "apps");

/**
 * Substitutions for `${VAR}` references with no compose default, used only to
 * build the env the API config parser is probed with. A var whose parser
 * validates a format needs a value that satisfies it.
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

const composePath = (app) => join(composeDir, `${app}-compose.yaml`);
const composeRel = (app) => `infra/docker/${app}-compose.yaml`;
const dockerfileRel = (app) => `apps/${app}/Dockerfile`;

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(".*"|'.*')$/su.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const indentOf = (line) => line.length - line.trimStart().length;
const isSkippable = (line) => line.trim().length === 0 || line.trim().startsWith("#");

/**
 * Reads a `key: value` block out of a compose file.
 *
 * Finds the line whose trimmed text is exactly `${blockKey}:`, then consumes
 * every following line indented deeper than it. Anything inside that is not a
 * `NAME: value` pair — notably a `- ` list entry — is a hard error naming the
 * file and line rather than a skip, because a form this cannot read is a form
 * whose contents it would otherwise report as empty.
 *
 * Returns `null` when the block is absent, so callers decide whether that is an
 * error. Entries carry their indent, letting a caller take direct children only.
 */
function readBlock(relPath, text, blockKey) {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === `${blockKey}:`);
  if (startIndex === -1) return null;

  const blockIndent = indentOf(lines[startIndex]);
  const entries = [];

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (isSkippable(line)) continue;
    const indent = indentOf(line);
    if (indent <= blockIndent) break;

    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match === null) {
      fail(
        `${relPath}:${i + 1} — unreadable line inside \`${blockKey}:\`: ${line.trim()}. ` +
          `This check reads only \`NAME: value\` pairs; rewrite it in that form.`,
      );
      return { entries, unreadable: true };
    }

    entries.push({ key: match[1], value: stripQuotes(match[2]), indent, line: i + 1 });
  }

  return { entries, unreadable: false };
}

/** The direct children of a block — entries at the shallowest indent found. */
function directChildren(block) {
  if (block === null || block.entries.length === 0) return new Map();
  const shallowest = Math.min(...block.entries.map((entry) => entry.indent));
  return new Map(
    block.entries.filter((entry) => entry.indent === shallowest).map((entry) => [entry.key, entry]),
  );
}

/**
 * Every `ARG` name declared in a Dockerfile, with whether it carries a default.
 *
 * `ARG A=1 B=2` on one line is valid and declares two names, so this splits on
 * whitespace rather than taking one name per line. An `ARG` whose default is the
 * empty string (`ARG NAME=`) still *has* a default — the `=` is what decides.
 */
function dockerfileArgs(relPath, text) {
  const args = new Map();
  text.split("\n").forEach((line, index) => {
    const match = /^\s*ARG\s+(.+)$/u.exec(line);
    if (match === null) return;
    for (const token of match[1].trim().split(/\s+/u)) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        fail(`${relPath}:${index + 1} — unreadable ARG token: ${token}`);
        continue;
      }
      args.set(name, { hasDefault: eq !== -1 });
    }
  });
  return args;
}

/**
 * Every `ENV NAME=VALUE` in a Dockerfile, in file order so a later stage wins.
 *
 * All stages are collected: this is a superset of what the runtime stage sets,
 * which is safe here because the extra names (`PNPM_HOME`, `PATH`) are ones the
 * API config parser never reads. A line that is not a single `NAME=VALUE` is a
 * hard error rather than a skip — the legacy `ENV NAME value` form and
 * multi-pair lines would otherwise silently drop from the effective env.
 */
function dockerfileEnv(relPath, text) {
  const env = {};
  text.split("\n").forEach((line, index) => {
    const match = /^\s*ENV\s+(.+)$/u.exec(line);
    if (match === null) return;
    const pair = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(match[1].trim());
    if (pair === null) {
      fail(
        `${relPath}:${index + 1} — unreadable ENV line: ${line.trim()}. ` +
          `This check reads only a single \`ENV NAME=VALUE\` per line.`,
      );
      return;
    }
    env[pair[1]] = stripQuotes(pair[2]);
  });
  return env;
}

/** Resolves a compose value's `${VAR}` / `${VAR:-default}` form for the probe. */
function resolveComposeValue(value) {
  const withDefault = /^\$\{([A-Za-z_][A-Za-z0-9_]*):-(.*)\}$/su.exec(value);
  if (withDefault !== null) return withDefault[2];

  const bare = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(value);
  if (bare !== null) return PLACEHOLDERS[bare[1]] ?? DEFAULT_PLACEHOLDER;

  return value;
}

// --- 1. Pairing ------------------------------------------------------------

const appsWithDockerfile = readdirSync(appsDir)
  .filter((name) => existsSync(join(appsDir, name, "Dockerfile")))
  .sort();

const appsWithCompose = readdirSync(composeDir)
  .map((name) => /^(.+)-compose\.yaml$/u.exec(name)?.[1])
  .filter((name) => name !== undefined)
  .sort();

for (const app of appsWithDockerfile) {
  if (!appsWithCompose.includes(app)) {
    fail(`${dockerfileRel(app)} exists but ${composeRel(app)} does not.`);
  }
}
for (const app of appsWithCompose) {
  if (!appsWithDockerfile.includes(app)) {
    fail(`${composeRel(app)} exists but ${dockerfileRel(app)} does not.`);
  }
}

const pairedApps = appsWithDockerfile.filter((app) => appsWithCompose.includes(app));

for (const app of pairedApps) {
  const rel = composeRel(app);
  const text = readFileSync(composePath(app), "utf8");
  const build = directChildren(readBlock(rel, text, "build"));

  const declaredDockerfile = build.get("dockerfile");
  if (declaredDockerfile === undefined) {
    fail(`${rel} declares no \`build.dockerfile\`.`);
  } else if (declaredDockerfile.value !== dockerfileRel(app)) {
    fail(
      `${rel}:${declaredDockerfile.line} — \`build.dockerfile\` is ` +
        `${declaredDockerfile.value}, expected ${dockerfileRel(app)}. ` +
        `A compose file pointing at another app's Dockerfile deploys the wrong image ` +
        `while every \`Images\` check stays green.`,
    );
  }

  const declaredContext = build.get("context");
  if (declaredContext === undefined) {
    fail(`${rel} declares no \`build.context\`.`);
  } else if (declaredContext.value !== "../..") {
    fail(
      `${rel}:${declaredContext.line} — \`build.context\` is ${declaredContext.value}, ` +
        `expected ../.. (the repo root; see infra/docker/README.md).`,
    );
  }
}

// --- 2. Vite build args ----------------------------------------------------

for (const app of pairedApps) {
  const composeRelPath = composeRel(app);
  const dockerRelPath = dockerfileRel(app);
  const args = dockerfileArgs(
    dockerRelPath,
    readFileSync(join(repoRoot, "apps", app, "Dockerfile"), "utf8"),
  );
  const composeArgs = directChildren(
    readBlock(composeRelPath, readFileSync(composePath(app), "utf8"), "args"),
  );

  for (const [name, { hasDefault }] of args) {
    if (!name.startsWith("VITE_")) continue;

    const declared = composeArgs.get(name);
    if (declared === undefined) {
      fail(
        `${dockerRelPath} declares \`ARG ${name}\` but ${composeRelPath} passes no ` +
          `\`build.args\` entry for it, so the deployed image is built without it.`,
      );
      continue;
    }

    if (hasDefault) continue;

    // No Dockerfile default, so compose is the only source of a value. An empty
    // compose default inlines an empty string at build time and fails in the
    // browser, not in CI. `${VAR:-""}` is that same hole spelled differently, so
    // the default is unquoted before it is measured.
    const withDefault = /^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.*)\}$/su.exec(declared.value);
    const isBareReference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(declared.value);
    const resolved =
      withDefault !== null ? stripQuotes(withDefault[1]) : isBareReference ? name : declared.value;

    if (resolved.length === 0) {
      fail(
        `${composeRelPath}:${declared.line} — ${name} resolves to an empty value and ` +
          `${dockerRelPath} gives the ARG no default. Vite inlines the empty string ` +
          `without complaint and the app fails on first load in a browser. Use ` +
          `\${${name}} or a non-empty default.`,
      );
    }
  }

  for (const [name, entry] of composeArgs) {
    if (!args.has(name)) {
      fail(
        `${composeRelPath}:${entry.line} — \`build.args\` passes ${name}, which ` +
          `${dockerRelPath} declares no \`ARG\` for, so the build ignores it.`,
      );
    }
  }
}

// --- 3. The API probe ------------------------------------------------------

const apiComposeRel = composeRel("api");
const apiEnvBlock = readBlock(
  apiComposeRel,
  readFileSync(composePath("api"), "utf8"),
  "environment",
);

if (apiEnvBlock === null) {
  fail(
    `${apiComposeRel} has no \`environment:\` block. Compose passes nothing to a ` +
      `container it does not name there, so the API boots without its configuration ` +
      `and restart-loops — this is the #120 regression.`,
  );
} else {
  const effectiveEnv = dockerfileEnv(
    dockerfileRel("api"),
    readFileSync(join(repoRoot, "apps", "api", "Dockerfile"), "utf8"),
  );

  for (const [key, entry] of directChildren(apiEnvBlock)) {
    effectiveEnv[key] = resolveComposeValue(entry.value);
  }

  if (effectiveEnv.NODE_ENV !== "production") {
    // Checked before the probe, never after. `parseClerkConfig` returns `null`
    // instead of throwing when all three `CLERK_*` are absent outside
    // production, and `NODE_ENV` defaults to development — so a probe run in
    // that state measures nothing while appearing to pass.
    fail(
      `${apiComposeRel} — the effective NODE_ENV is ${effectiveEnv.NODE_ENV ?? "unset"}, ` +
        `not production. Outside production the API config parser tolerates missing ` +
        `CLERK_* variables, so the probe below would measure nothing.`,
    );
  } else {
    const { loadApiRuntimeConfig } = await import(
      pathToFileURL(join(repoRoot, "apps", "api", "src", "config.ts")).href
    );

    try {
      loadApiRuntimeConfig(effectiveEnv);
    } catch (error) {
      fail(`${apiComposeRel} — ${error.message}`);
    }
  }
}

// --- Result ----------------------------------------------------------------

if (failures > 0) {
  console.log(`\ncheck-compose-env: ${failures} failure(s).`);
  process.exit(1);
}

console.log(`check-compose-env: OK (${pairedApps.length} compose files).`);
