import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `src/server.ts` is the process entrypoint: it calls `loadApiRuntimeConfig()`
 * against the real environment and awaits `app.listen()` at module scope.
 * Importing it would bind a port, so it is the one file this test cannot load
 * — and therefore the one file the coverage denominator below cannot include.
 */
const NOT_IMPORTABLE = new Set(["server.ts"]);

async function listSourceFiles(): Promise<string[]> {
  const entries = await readdir(SRC_DIR, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(SRC_DIR, path.join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * Imports every module under `src/`.
 *
 * This is not primarily an import smoke test — it is what makes the coverage
 * floor mean something. `node --test --experimental-test-coverage` only reports
 * files the run actually loaded, and `--test-coverage-include` filters that set
 * rather than adding to it.
 *
 * Verified rather than assumed. A throwaway `src/zzz-probe.ts` exporting a
 * never-called function did not appear in the report at all before this test
 * existed, and the aggregate stayed at 81.61%. With this test in place the same
 * file appears and the aggregate drops to 81.39%.
 *
 * The consequence without it is a floor that moves the wrong way: a new module
 * with no tests is simply absent from the denominator, so the reported number
 * holds or rises while real coverage falls — a green check certifying the
 * opposite of what it appears to.
 *
 * Two limits worth knowing. V8 counts a module's top-level and declaration
 * lines as covered on import alone, so a wholly untested module lands well
 * above 0% rather than at 0% — this floor is softer than it looks, though a new
 * untested module still drags the aggregate down. And this differs in mechanism
 * from the vitest workspaces, where `@unimatrix/config-vitest` sets
 * `include: ["src/**"]` and v8 reports unloaded files at 0% without help.
 */
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

/**
 * Guards the exclusion list itself. If `server.ts` is ever refactored so its
 * side effects move behind a function call, this fails and the file should
 * rejoin the denominator rather than staying permanently exempt.
 */
void test("the not-importable list names only files that still exist", async () => {
  const files = new Set(await listSourceFiles());

  for (const excluded of NOT_IMPORTABLE) {
    assert.ok(files.has(excluded), `src/${excluded} is excluded from import but no longer exists`);
  }
});
