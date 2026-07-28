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
 *
 * Every threshold in this repo was re-baselined once, on the vitest 3 -> 4
 * upgrade, and the numbers before and after are not comparable. vitest 4 counts
 * coverage by mapping V8's output onto the source AST (`ast-v8-to-istanbul`);
 * the older sourcemap-based path is not merely off by default, it is gone —
 * v4 no longer ships `@ampproject/remapping`, `istanbul-lib-source-maps` or
 * `magic-string`. There is no flag that restores the old numbers.
 *
 * The effect is directional, not noise: statement denominators shrink and
 * function denominators grow, because AST counting sees arrow functions and
 * callbacks that V8 never attributed. Statement floors mostly rose; function
 * floors mostly fell, sharply in places — `@unimatrix/auth` went from 5/7
 * functions (71%) to 4/17 (23%) over an identical tree with identical passing
 * tests. Nothing stopped being tested; seventeen functions were always there
 * and only seven were ever counted.
 *
 * So the low function floors are honest measurements, not a relaxed standard.
 * They are also genuinely weak protection until the underlying gaps are
 * covered — `@unimatrix/auth` (23%), `@unimatrix/auth-app` (33%) and
 * `@unimatrix/cube-trainer` (41%) are the ones worth attention. Raise them by
 * writing tests, never by editing the number.
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
