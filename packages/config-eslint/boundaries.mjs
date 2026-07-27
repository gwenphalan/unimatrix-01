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
  "apps/web": ["api-client", "auth", "content", "ui"],
  "apps/api": ["auth", "db", "shared"],
  // Deliberately narrow. AGENTS.md: cube-trainer must not gain
  // `@unimatrix/api-client`, `@unimatrix/shared`, or `@unimatrix/content`
  // unless a real server-backed feature is added.
  "apps/cube-trainer": ["ui"],
  "apps/auth": ["auth", "ui"],
  "packages/api-client": ["shared"],
  "packages/user-data": ["api-client", "auth", "shared"],
  // Leaves. `packages/shared` in particular must stay free of transport, UI,
  // and content-loading code, which starts with importing none of it.
  "packages/ui": [],
  "packages/shared": [],
  "packages/content": [],
  "packages/db": [],
  "packages/auth": [],
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
