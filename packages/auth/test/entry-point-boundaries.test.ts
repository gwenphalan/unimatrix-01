import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md: `@unimatrix/auth` "takes config as arguments and never reads
 * `process.env`". That invariant is what lets the same package be configured
 * differently by the API, the auth app, and a test — a stray `process.env` read
 * would silently reintroduce ambient configuration and only misbehave in
 * whichever environment forgot to set the variable.
 *
 * It cannot be expressed as an import rule, since `process` is a global rather
 * than a module, so it follows the repo's existing source-text convention tests
 * (`apps/web/test/content-registry.test.ts`,
 * `apps/web/test/public-ui-usage.test.ts`).
 */
function readEntryPointSource(fileName: string): string {
  return readFileSync(join(process.cwd(), "src", fileName), "utf8");
}

/**
 * Strips block and line comments so a comment *describing* the invariant is not
 * mistaken for a violation of it — `src/server.ts` documents this exact rule in
 * prose, and matching raw source would fail on that sentence alone.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

const ENTRY_POINTS = ["index.ts", "server.ts", "react.tsx"];

describe("@unimatrix/auth entry points", () => {
  it.each(ENTRY_POINTS)("%s never reads process.env", (fileName) => {
    expect(stripComments(readEntryPointSource(fileName))).not.toMatch(/process\s*\.\s*env/u);
  });

  it("stripComments does not hide a real violation", () => {
    const withRealRead = stripComments(`
      // packages never read process.env
      export const secret = process.env.SOME_KEY;
    `);

    expect(withRealRead).toMatch(/process\s*\.\s*env/u);
  });
});
