/**
 * Shared Vitest coverage configuration.
 *
 * Thresholds are a ratchet, not a target: each workspace passes the numbers it
 * already achieves, rounded down, so coverage cannot silently thin out one
 * shallow test at a time. Raising a threshold after genuinely improving a
 * workspace is the intended workflow; lowering one should be a deliberate,
 * explained edit rather than a quiet fix for a red build.
 *
 * Only `statements` and `functions` are gated. Branch coverage sits between 78%
 * and 100% everywhere already and is the noisiest of the four — a single added
 * guard clause moves it without any real loss of test quality — so it is
 * reported but not enforced.
 */

/** Never counted: generated output, config, test scaffolding, type-only files. */
const ALWAYS_EXCLUDED = [
  "**/*.config.{ts,mts,cts,js,mjs,cjs}",
  "**/*.d.ts",
  "**/dist/**",
  "**/node_modules/**",
  "**/routeTree.gen.ts",
  "src/**/*.test.{ts,tsx}",
];

/**
 * @param {object} options
 * @param {{ statements: number, functions: number }} options.thresholds
 *   The workspace's current measured coverage, rounded down.
 * @param {string[]} [options.exclude]
 *   Extra globs to leave out, on top of `ALWAYS_EXCLUDED`. Use for vendored
 *   code the repo does not maintain — counting it sets a floor from someone
 *   else's testing decisions.
 */
export function createCoverageConfig({ thresholds, exclude = [] }) {
  return {
    // On by default rather than behind a `--coverage` flag. A threshold only
    // fails the run when coverage is actually collected, so gating it behind a
    // flag would mean the floor is enforced in whichever command remembers to
    // pass it — and silently absent everywhere else, including `turbo run test`.
    enabled: true,
    provider: "v8",
    // `src` only. Including `test` would let the test files inflate their own
    // coverage number, which makes the floor meaningless.
    include: ["src/**"],
    exclude: [...ALWAYS_EXCLUDED, ...exclude],
    reporter: ["text-summary", "html"],
    reportsDirectory: "./coverage",
    thresholds: {
      statements: thresholds.statements,
      functions: thresholds.functions,
    },
  };
}
