import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `src/server.ts` is the process entrypoint: it calls `loadDeployRuntimeConfig()` against the real
 * environment and awaits `app.listen()` at module scope. Importing it would bind a port, so it is
 * the one file this test cannot load — and therefore the one file the coverage denominator below
 * cannot include. See `apps/secrets/test/module-graph.test.ts`, which this mirrors.
 */
const NOT_IMPORTABLE = new Set(["server.ts"]);

async function listSourceFiles(): Promise<string[]> {
  const entries = await readdir(SRC_DIR, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(SRC_DIR, path.join(entry.parentPath, entry.name)))
    .sort();
}

void test("every src module outside the process entrypoint can be imported", async () => {
  const files = await listSourceFiles();

  assert.ok(files.length > 0, "expected to find source files under src/");

  const importable = files.filter((file) => !NOT_IMPORTABLE.has(file));

  for (const file of importable) {
    const moduleUrl = pathToFileURL(path.join(SRC_DIR, file)).href;

    await assert.doesNotReject(async () => {
      await import(moduleUrl);
    }, `failed to import src/${file}`);
  }
});

void test("the not-importable list names only files that still exist", async () => {
  const files = new Set(await listSourceFiles());

  for (const excluded of NOT_IMPORTABLE) {
    assert.ok(files.has(excluded), `src/${excluded} is excluded from import but no longer exists`);
  }
});
