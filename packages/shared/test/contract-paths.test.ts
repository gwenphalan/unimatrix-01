import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md: "`ApiContract` paths stay static (no path params) — use
 * query/body schemas instead."
 *
 * The `path` field is typed `` `/${string}` ``, which the compiler happily
 * satisfies with `/me/data/:id` or an interpolated template, so TypeScript
 * cannot hold this line. It also cannot be an import rule — nothing is being
 * imported. So it follows the repo's existing source-text convention tests
 * (`apps/web/test/content-registry.test.ts`,
 * `apps/web/test/public-ui-usage.test.ts`).
 *
 * A dynamic path breaks quietly rather than loudly: `@unimatrix/api-client`
 * builds request URLs by concatenating the contract path, so a `:id` segment
 * would be sent to the server verbatim and 404 at runtime with a perfectly
 * green build.
 */
const CONTRACTS_DIRECTORY = join(process.cwd(), "src", "contracts");

function getContractSourceFileNames(): string[] {
  return readdirSync(CONTRACTS_DIRECTORY)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

/** Every `path:` value assigned in a contract source file, as written. */
function getDeclaredPaths(fileName: string): string[] {
  const source = readFileSync(join(CONTRACTS_DIRECTORY, fileName), "utf8");
  const matches = source.matchAll(/^\s*path:\s*(?<value>[^,\n]+),/gmu);

  return [...matches].map((match) => (match.groups?.value ?? "").trim());
}

describe("shared API contract paths", () => {
  const fileNames = getContractSourceFileNames();

  it("finds contract sources to check", () => {
    expect(fileNames.length).toBeGreaterThan(0);
  });

  it.each(fileNames)("%s declares only static double-quoted paths", (fileName) => {
    for (const declaredPath of getDeclaredPaths(fileName)) {
      // A plain double-quoted literal: rules out template literals (and the
      // interpolation they enable) without needing to parse TypeScript.
      expect(declaredPath).toMatch(/^"\/[^"]*"$/u);
      // `:id`-style params. Matched after the opening quote so a URL scheme
      // could never be confused for one.
      expect(declaredPath).not.toMatch(/\/:/u);
    }
  });

  it("the path matcher actually finds the paths it is checking", () => {
    const allPaths = fileNames.flatMap((fileName) => getDeclaredPaths(fileName));

    expect(allPaths).toContain('"/health"');
    expect(allPaths.length).toBeGreaterThan(1);
  });
});
