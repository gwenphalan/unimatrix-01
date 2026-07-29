import { createAppConfig } from "@unimatrix/config-eslint";

/**
 * `lab` sits one level below the repo root, while `createBoundariesConfig` and
 * `createRestrictedImportConfigs` both derive their identity from a workspace
 * being *two* levels deep (`apps/<name>`, `packages/<name>`). Verified rather
 * than assumed: with only `createAppConfig` applied, every `boundaries/*` and
 * `no-restricted-imports` rule in the shared config is a silent no-op here.
 *
 * Rather than reshape a config on the critical path of eleven other workspaces
 * for one dev-only harness, the ban lab actually needs is written locally. It
 * is `no-restricted-imports` rather than a `boundaries` policy on purpose, and
 * for the reason `restricted-imports.mjs` documents for itself: it matches the
 * specifier string, so it fires whether or not the module resolves — which is
 * exactly what an undeclared, newly-added forbidden dependency looks like.
 *
 * `eslint src` in `package.json` already keeps `prototypes/` out of scope; the
 * `ignores` entry below is the belt to that braces, so a stray `eslint .` does
 * not start reporting throwaway sketches.
 */
export default [
  ...createAppConfig({
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    ignores: ["prototypes/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@unimatrix/api-client",
                "@unimatrix/api-client/*",
                "@unimatrix/user-data",
                "@unimatrix/user-data/*",
                // The `.` entry of `@unimatrix/auth` is allowed and used: it is
                // the framework-agnostic permission scheme, and typing the
                // session mock against it is what makes an `APP_SLUGS` or
                // `Role` change break the mock. These two are the ones that
                // carry a real Clerk client and a real Fastify plugin.
                "@unimatrix/auth/react",
                "@unimatrix/auth/server",
                "@clerk/*",
              ],
              message:
                "Prototypes reach data through `src/mocks/` only. A real transport, a real store, or a real Clerk session in the lab means a laptop can mutate live content or hold a live session from the least-reviewed code in the repo. Mock the surface against `@unimatrix/shared` types instead.",
            },
          ],
        },
      ],
    },
  },
];
