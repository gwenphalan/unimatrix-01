#!/usr/bin/env node
//
// Every workspace package an app imports must appear in that app's Dokploy
// watch-path list.
//
// The list lives in a fenced ```text block in `apps/<app>/README.md` and is
// copied by hand into the Dokploy service's configuration. Dokploy rebuilds a
// service only when a push touches one of those paths, so a missing entry means
// the app silently stops redeploying when that dependency changes — the failure
// this check exists to prevent, and it reports nothing on its own.
//
// It happened: `packages/chrome/**` was absent from `apps/web`, `apps/auth` and
// `apps/admin` while all three resolved `@unimatrix/chrome` to source. The shared
// site chrome could change and only some apps would rebuild, so two surfaces
// served different chrome with nothing to indicate it. Lint, typecheck, tests and
// every image build stay green through all of that.
//
// One-directional on purpose. Every imported package must be listed; extra
// entries are allowed, because real build inputs exist that no `import`
// statement names — `packages/config-typescript/**` is read through a tsconfig
// `extends`, and the root pnpm manifests govern the frozen install.
//
// "Imports" is measured from the app's own `src/` tree rather than from
// `package.json`, because a declared-but-unused dependency is not a build input
// and listing it would train the reader to distrust the list.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let failures = 0;
const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures += 1;
};

/** Maps `@unimatrix/<name>` to the workspace directory that provides it. */
function packageDirectories() {
  const map = new Map();
  for (const dir of readdirSync(join(repoRoot, "packages"))) {
    const manifest = join(repoRoot, "packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name) map.set(name, `packages/${dir}`);
  }
  return map;
}

/** Every `@unimatrix/*` specifier that appears anywhere under the app's `src/`. */
function importedPackages(appDir) {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        for (const match of readFileSync(path, "utf8").matchAll(/@unimatrix\/[a-z0-9-]+/g)) {
          found.add(match[0]);
        }
      }
    }
  };
  const src = join(appDir, "src");
  if (existsSync(src)) walk(src);
  return found;
}

/**
 * The watch-path list: the first fenced block in the README whose first line is
 * the app's own `apps/<app>/**` glob.
 *
 * Anchored on that first line rather than on "the first ```text block" so a
 * README that grows an earlier code sample does not silently start checking the
 * wrong block. A block that cannot be found is a failure, not a skip.
 */
function watchPaths(readme, appName) {
  const blocks = readFileSync(readme, "utf8").matchAll(/```(?:text)?\n([\s\S]*?)```/g);
  for (const [, body] of blocks) {
    const lines = body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines[0] === `apps/${appName}/**`) return lines;
  }
  return null;
}

console.log("check-watch-paths: every imported workspace package must be a watch path\n");

const packages = packageDirectories();
const apps = readdirSync(join(repoRoot, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (apps.length === 0) fail("no apps found — the check cannot pass vacuously");

for (const app of apps) {
  const appDir = join(repoRoot, "apps", app);
  const readme = join(appDir, "README.md");

  if (!existsSync(readme)) {
    fail(`apps/${app}: no README.md — nowhere for the watch-path list to live`);
    continue;
  }

  const listed = watchPaths(readme, app);
  if (listed === null) {
    fail(`apps/${app}: README.md has no fenced block starting with 'apps/${app}/**'`);
    continue;
  }

  const missing = [];
  for (const specifier of [...importedPackages(appDir)].sort()) {
    // `@unimatrix/auth/react` and `@unimatrix/ui/public` collapse to their package.
    const dir = packages.get(specifier);
    if (!dir) continue; // an app, or a subpath already reduced to its package
    if (!listed.includes(`${dir}/**`)) missing.push(`${dir}/** (imports ${specifier})`);
  }

  if (missing.length > 0) {
    for (const entry of missing) {
      fail(`apps/${app}: watch paths omit ${entry} — a change there will not redeploy this app`);
    }
  } else {
    console.log(`  ok    apps/${app}: ${listed.length} watch paths cover every imported package`);
  }
}

console.log("");

if (failures > 0) {
  console.log(`check-watch-paths: ${failures} failure(s)`);
  process.exit(1);
}

console.log("check-watch-paths: every app's watch paths cover its imported packages");
