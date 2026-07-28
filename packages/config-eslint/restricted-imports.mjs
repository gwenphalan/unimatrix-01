import path from "node:path";

/**
 * Per-workspace import bans from the Boundaries section of `AGENTS.md`.
 *
 * This layer exists alongside `boundaries/dependencies` because the two fail in
 * different directions. `boundaries` reasons about *resolved* modules, so an
 * import it cannot resolve is classified as external and skipped — which is
 * exactly what an undeclared, newly-added forbidden dependency looks like
 * before its tsconfig path exists. `no-restricted-imports` matches the
 * specifier string itself and therefore fires whether or not the module
 * resolves.
 *
 * Every entry below is satisfied by the repo as it stands, so these are
 * ratchets against new violations rather than a list of known failures.
 *
 * `files` is deliberately not uniform. A *dependency* ban applies everywhere,
 * because importing the package from a test still means adding it to
 * `package.json`. A *purity* ban ("must stay filesystem-free") applies to
 * `src/**` only, because it is a statement about what the package ships — the
 * repo's own convention tests read source files off disk to enforce
 * conventions, and banning `node:fs` in those would be enforcing the rule
 * against the thing enforcing the rule.
 */
const SHIPPED_SOURCE = ["src/**/*.{ts,tsx,mts,cts}"];
const ALL_SOURCE = ["**/*.{ts,tsx,mts,cts}"];

const WORKSPACE_RESTRICTIONS = {
  "apps/cube-trainer": {
    files: ALL_SOURCE,
    patterns: [
      {
        group: [
          "@unimatrix/api-client",
          "@unimatrix/api-client/*",
          "@unimatrix/shared",
          "@unimatrix/shared/*",
          "@unimatrix/content",
          "@unimatrix/content/*",
          "@tanstack/react-query",
          "@tanstack/react-query/*",
        ],
        message:
          "cube-trainer is intentionally backend-free: no api-client, shared contracts, content loading, or react-query. Adding one of these means adding a real server-backed feature — update AGENTS.md and this rule together if that is the intent.",
      },
    ],
  },
  "apps/auth": {
    files: ALL_SOURCE,
    patterns: [
      {
        group: ["@clerk/clerk-react", "@clerk/clerk-react/*"],
        message:
          "Consume Clerk only through `@unimatrix/auth/react`, never `@clerk/clerk-react` directly, so the provider and hooks stay swappable in one place.",
      },
    ],
  },
  "apps/web": {
    files: ALL_SOURCE,
    patterns: [
      {
        // A regex rather than a `group` with negations: gitignore-style
        // negation inside `group` did not exclude `@unimatrix/ui/public` here —
        // every existing, legitimate import was reported — so the allowed
        // entry points are expressed as explicit lookaheads instead.
        regex: String.raw`^@unimatrix/ui$|^@unimatrix/ui/(?!public$)(?!styles\.css$)`,
        message:
          "The public site consumes `@unimatrix/ui/public` (plus `@unimatrix/ui/styles.css`). Reaching into the wider `@unimatrix/ui` surface widens the public entry point by accident.",
      },
    ],
  },
  "packages/shared": {
    files: SHIPPED_SOURCE,
    patterns: [
      {
        group: ["react", "react-dom", "react/*", "react-dom/*", "node:*"],
        message:
          "`@unimatrix/shared` is framework-agnostic contract code: no UI, no transport, no filesystem. Keep it importable from a browser, a server, and a test alike.",
      },
    ],
  },
  "packages/api-client": {
    files: SHIPPED_SOURCE,
    patterns: [
      {
        group: ["node:*", "@clerk/*"],
        message:
          "`@unimatrix/api-client` stays DOM- and Node-lib-free and auth-library-agnostic — the consumer supplies `getAuthToken`.",
      },
    ],
  },
};

/**
 * The admin CMS is the one part of `apps/web` allowed to import
 * `@unimatrix/ui/editor`, and only from inside its own feature directory.
 *
 * The workspace-wide ban above exists because that entry point carries
 * CodeMirror and the dialog/table primitives: measured on the production
 * build, naming it from a module the public routes reach adds it to the
 * public chunk whether or not the symbols are used. Confining it here means a
 * stray import in a route file is a lint error rather than half a megabyte
 * shipped to every reader.
 *
 * Scoped by file rather than by workspace, so it lives outside the table
 * above. Flat config applies later entries last, so this replaces the
 * workspace rule for these files only.
 */
const WEB_ADMIN_FEATURE_CONFIG = {
  // The admin tests are listed too: they mock `@unimatrix/ui/editor` to
  // intercept `toast`, which means naming the specifier. A test file is not
  // bundled, so it cannot widen a chunk — the pattern stays narrow so this
  // does not become a way to import the entry point from anywhere in `test/`.
  files: ["src/features/admin/**/*.{ts,tsx}", "test/admin-*.test.{ts,tsx}"],
  patterns: [
    {
      regex: String.raw`^@unimatrix/ui$|^@unimatrix/ui/(?!public$)(?!editor$)(?!styles\.css$)`,
      message:
        "The admin feature may import `@unimatrix/ui/editor` (and `./public`), but not the root barrel or any other subpath.",
    },
  ],
};

/**
 * `packages/auth` ships three deliberately separate entry points: `.` stays
 * framework-agnostic and dependency-free, `./server` is Node-only, and
 * `./react` is browser-only. A cross-import between the last two would drag
 * Node built-ins into a browser bundle (or React into a Fastify plugin), which
 * is the kind of failure that surfaces at runtime in one environment only.
 *
 * Scoped by file rather than by workspace, so it lives outside the table above.
 */
const AUTH_ENTRY_POINT_CONFIGS = [
  {
    files: ["src/index.ts"],
    restrictions: [
      {
        group: ["./server", "./server.js", "./react", "./react.js", "./react.tsx"],
        message:
          "The `.` entry point of `@unimatrix/auth` must stay framework-agnostic: it may not pull in the Node-only server entry or the browser-only react entry.",
      },
    ],
  },
  {
    files: ["src/server.ts"],
    restrictions: [
      {
        group: ["./react", "./react.js", "./react.tsx", "react", "react-dom"],
        message:
          "`@unimatrix/auth/server` is Node-only. Importing the react entry (or React itself) here would put browser code in a Fastify plugin.",
      },
    ],
  },
  {
    files: ["src/react.tsx"],
    restrictions: [
      {
        group: ["./server", "./server.js", "node:*"],
        message:
          "`@unimatrix/auth/react` is browser-only. Importing the server entry (or a Node built-in) here would break the browser bundle.",
      },
    ],
  },
];

function workspaceIdOf(tsconfigRootDir) {
  const group = path.basename(path.dirname(tsconfigRootDir));
  return `${group}/${path.basename(tsconfigRootDir)}`;
}

/**
 * Returns the flat-config entries enforcing this workspace's import bans, or an
 * empty array when the workspace has none. `files` patterns in a returned entry
 * are relative to the directory ESLint runs in, which under `turbo run lint` is
 * the workspace directory itself.
 */
export function createRestrictedImportConfigs({ tsconfigRootDir }) {
  const workspaceId = workspaceIdOf(tsconfigRootDir);
  const configs = [];

  const restrictions = WORKSPACE_RESTRICTIONS[workspaceId];
  if (restrictions) {
    configs.push({
      files: restrictions.files,
      rules: {
        "@typescript-eslint/no-restricted-imports": ["error", { patterns: restrictions.patterns }],
      },
    });
  }

  if (workspaceId === "apps/web") {
    configs.push({
      files: WEB_ADMIN_FEATURE_CONFIG.files,
      rules: {
        "@typescript-eslint/no-restricted-imports": [
          "error",
          { patterns: WEB_ADMIN_FEATURE_CONFIG.patterns },
        ],
      },
    });
  }

  if (workspaceId === "packages/auth") {
    for (const entry of AUTH_ENTRY_POINT_CONFIGS) {
      configs.push({
        files: entry.files,
        rules: {
          "@typescript-eslint/no-restricted-imports": ["error", { patterns: entry.restrictions }],
        },
      });
    }
  }

  return configs;
}
