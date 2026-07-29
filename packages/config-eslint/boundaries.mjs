import path from "node:path";

import boundaries from "eslint-plugin-boundaries";

/**
 * The cross-workspace import graph from the Boundaries section of `AGENTS.md`,
 * expressed as data so lint enforces it instead of prose asking an agent to.
 *
 * Key: workspace directory. Value: the `packages/*` directories it may import
 * from. A workspace may always import from itself. Anything not listed is
 * denied — the rule runs `default: "disallow"`.
 *
 * Entries are the *current* truth, not an aspiration: every edge here is one
 * that source in this repo actually uses today, so the rule is a ratchet
 * against new coupling rather than a backlog of pre-existing failures.
 */
const ALLOWED_PACKAGE_IMPORTS = {
  // `e2e-helpers` is granted only to the two workspaces that actually run a
  // Playwright suite, rather than to everyone via SHARED_CONFIG_PACKAGES below.
  // It ships assertion code, not configuration, so a workspace importing it is
  // a fact worth stating per workspace. Note the grant is workspace-wide — the
  // rule has no per-directory granularity — so it does not by itself stop `src/`
  // from importing test helpers; nothing in the app builds does today.
  // `shared` was added when blog and project content moved behind the API:
  // route loaders and the admin UI work in terms of the content contracts'
  // request/response types, and those live in `@unimatrix/shared` by rule
  // ("shared request/response shapes belong in @unimatrix/shared"). The vite
  // alias and tsconfig path for it predate this entry.
  "apps/web": [
    "api-client",
    "app-config",
    "auth",
    "chrome",
    "content",
    "e2e-helpers",
    "shared",
    "ui",
  ],
  // `content` is here for `scripts/seed-content.ts` only — the one-way import
  // of the repository's authored markdown into the content database. No route
  // module reads markdown from disk. The rule has no per-directory
  // granularity, so this grant is workspace-wide even though only that script
  // uses it; `@unimatrix/content` stays a devDependency of `apps/api` so it is
  // absent from the deployable image.
  "apps/api": ["auth", "content", "db", "shared"],
  // Deliberately narrow. AGENTS.md: cube-trainer must not gain
  // `@unimatrix/api-client`, `@unimatrix/shared`, or `@unimatrix/content`
  // unless a real server-backed feature is added. `chrome` does not widen that:
  // it carries no auth, transport, or content dependency of its own, which is
  // the whole reason its shells take the account control as a slot.
  "apps/cube-trainer": ["chrome", "e2e-helpers", "ui"],
  "apps/auth": ["app-config", "auth", "chrome", "ui"],
  // The admin scaffold, and deliberately as narrow as `apps/auth`. It is not
  // the CMS yet: `api-client` and `shared` are the edges the content move will
  // need, and they get added when code actually uses them rather than now, so
  // this stays a statement of fact instead of a permission slip.
  "apps/admin": ["app-config", "auth", "chrome", "ui"],
  "packages/api-client": ["shared"],
  // Env validation for the Vite apps' config boundaries. A leaf on purpose:
  // `zod` is its only dependency and stays its implementation detail — apps
  // compose schemas through `envSchema` instead of importing zod themselves.
  "packages/app-config": [],
  // The shared chrome composes `ui` primitives and nothing else. It must never
  // gain `auth`: both of its shells take the account control as a `ReactNode`
  // slot precisely so a sign-in-free tool can import one without pulling Clerk
  // into its dependency tree.
  "packages/chrome": ["ui"],
  "packages/user-data": ["api-client", "auth", "shared"],
  // Leaves. `packages/shared` in particular must stay free of transport, UI,
  // and content-loading code, which starts with importing none of it.
  "packages/ui": [],
  "packages/shared": [],
  "packages/content": [],
  "packages/db": [],
  "packages/auth": [],
  // A leaf, and listed even though it imports no sibling package: `default` is
  // "disallow", so a workspace with no policy of its own cannot even resolve its
  // own relative imports.
  "packages/e2e-helpers": [],
};

/**
 * Build-tooling packages every workspace may import. They carry no runtime code
 * — they are consumed by `eslint.config.mjs`, `tsconfig.json`, and
 * `vitest.config.ts` — so an edge to one says nothing about the runtime
 * coupling this rule exists to constrain.
 */
const SHARED_CONFIG_PACKAGES = ["config-eslint", "config-typescript", "config-vitest"];

function toElement(workspace) {
  const [group, name] = workspace.split("/");
  return { type: group === "apps" ? "app" : "pkg", name };
}

function buildPolicies() {
  return Object.entries(ALLOWED_PACKAGE_IMPORTS).map(([workspace, allowed]) => {
    const from = toElement(workspace);

    return {
      from: { element: { type: from.type, captured: { name: from.name } } },
      allow: [
        // A workspace's own relative imports are same-element and must stay legal.
        { to: { element: { type: from.type, captured: { name: from.name } } } },
        ...[...allowed, ...SHARED_CONFIG_PACKAGES].map((name) => ({
          to: { element: { type: "pkg", captured: { name } } },
        })),
      ],
    };
  });
}

/**
 * `boundaries` matches element patterns against paths relative to
 * `boundaries/root-path`. Turbo runs `eslint .` with the cwd set to the
 * workspace directory, so without this the `apps/*` and `packages/*` patterns
 * match nothing, every file is classified as belonging to no element, and the
 * rule silently enforces nothing while CI stays green.
 *
 * Verified rather than assumed: with the setting removed, a deliberate
 * cross-package violation reports "File does not match any file pattern and
 * does not belong to any known element" instead of a policy error.
 */
export function createBoundariesConfig({ tsconfigRootDir }) {
  const repoRoot = path.resolve(tsconfigRootDir, "..", "..");

  return {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": repoRoot,
      // Without a resolver, flat config leaves every bare specifier unresolved,
      // and `boundaries` classifies unresolved imports as *external* — which the
      // `dependencies` rule skips. Since every cross-workspace import in this
      // repo is a package specifier (`@unimatrix/ui/public`) rather than a
      // relative path, omitting this makes the whole rule a no-op. The
      // TypeScript resolver is the right one here because each workspace's
      // tsconfig already maps `@unimatrix/*` onto package sources.
      "import/resolver": {
        typescript: { project: path.join(tsconfigRootDir, "tsconfig.json") },
      },
      "boundaries/elements": [
        { type: "app", pattern: "apps/*", capture: ["name"] },
        { type: "pkg", pattern: "packages/*", capture: ["name"] },
      ],
    },
    rules: {
      "boundaries/dependencies": ["error", { default: "disallow", policies: buildPolicies() }],
    },
  };
}
