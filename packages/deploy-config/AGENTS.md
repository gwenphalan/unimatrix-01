# AGENTS.md

## 1. Overview
`packages/deploy-config` holds the typed per-app config that drives the Dockerfile/compose
generator: each `apps/<app>/deploy.config.ts` builds a `DeployAppConfig` from `staticSpaApp()` or
`nodeApiApp()`. `infra/scripts/generate-deploy-config.mjs` reads it and writes
`apps/<app>/Dockerfile`, `infra/docker/<app>-compose.yaml`, and — once, from every app's config —
`apps/deploy/src/reconcile/desired-state.gen.ts`; `infra/scripts/validate-deploy-config.mjs`
checks it. Edit the config, not the generated files — see the root `AGENTS.md` for the
generated-files rule.

## 2. Shape
- **Single-file package.** Everything lives in `src/index.ts`, not split across `types.ts` /
  `archetypes.ts` / etc. Splitting it breaks typecheck in every app that adds `deploy.config.ts` to
  its `include`: a `.ts`-extension relative import needs `allowImportingTsExtensions`, which is this
  package's own tsconfig setting and does not travel with the file into a consuming app's program
  under that app's tsconfig.
- **No `zod`, no runtime dependencies at all.** `validateAppConfig(config)` returns
  `readonly string[]` of failure messages instead.
- **Base images stay out of this config.** The generator reads the Dockerfile's own `FROM` lines
  and re-emits them verbatim (`DeployDockerfileFromLines`), so a Dependabot nginx digest bump never
  touches a `deploy.config.ts` or reddens the generator's drift check.
- **No subdomain or Dokploy metadata.** Only fields that generate output. The
  subdomain/container-port duplication with `docs/deployment.md` is not collapsed here.
  `publicStatus` is not an exception: it is a policy declaration (may a stranger see this service's
  health?), not a mirror of whether Dokploy has a Domains entry for it — a service can be monitored
  without being disclosed — and it does generate output, into `desired-state.gen.ts`.

## 3. Loading mechanics
Plain Node (24.18.0) strips this package's TypeScript with no build step and no flag, the same
arrangement as `@unimatrix/app-config`: pnpm symlinks the workspace dependency, so the stripped file
sits outside `node_modules` and `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` never engages. Two
consequences:
- A script under `infra/scripts/` must import this package **by absolute path**, not the bare
  `@unimatrix/deploy-config` specifier — there is no `node_modules/@unimatrix` at the repo root for
  a bare specifier to resolve through.
- An app's `deploy.config.ts` needs the `workspace:*` dependency edge in that app's
  `devDependencies`, so it resolves only after `pnpm install`.
- A `deploy.config.ts` may not import `@unimatrix/shared`'s `.` entry — the same "loaded before
  anything is built" constraint applies, and that entry resolves only through `dist`. Reach the
  secrets registry through `@unimatrix/shared/secrets-registry`, a subpath that points at raw source.

## 4. Conventions
- **A compose file names `image:` and never `build:` — not even alongside it "for local
  development".** With both keys present, `docker compose up -d --build` builds the Dockerfile
  locally and tags the result with the registry name (`Successfully tagged
  ghcr.io/unimatrixcore/unimatrix-demo:v1`), contacting no registry at all — measured. Dokploy
  issues exactly that command for a Compose service whose own `command` field is empty, so the
  published image would go unused while the build log, the tag and the deploy status all read as a
  normal deploy. Build an app locally with `docker build -f apps/<app>/Dockerfile .` instead.
- `nodeApiApp()` is a parameterised template — one call site per `node-api` app's `deploy.config.ts`
  (`grep -l nodeApiApp apps/*/deploy.config.ts`) — each supplies its own env and volume data as
  arguments, and the generator's Dockerfile/compose body stays identical between them.
- If two apps' Dockerfiles cannot both be expressed by `staticSpaApp()`/`nodeApiApp()` without a
  generator branch keyed on app name, that is a signal the archetype split is wrong, not licence to
  add the branch.
- The generated `prune` stage installs turbo from the `TURBO_VERSION` constant in `src/index.ts`,
  not the root `turbo` devDependency — a Dependabot bump of one does not move the other.

## 5. The pre-commit hook's partial-stage refusal, and its known gaps
`infra/scripts/install-git-hooks.mjs`, run by the root `prepare` script, writes the pre-commit hook
that invokes `generate-deploy-config.mjs --stage`. It resolves the hooks directory with
`git rev-parse --git-path hooks` rather than joining the working directory with `.git/hooks`, so the
hook installs correctly from a linked git worktree as well as the main checkout — in a worktree,
`.git` is a file holding a `gitdir:` pointer rather than a directory, and the naive join throws
`ENOTDIR` against it.

Before writing, `generate-deploy-config.mjs --stage` refuses to run while any `deploy.config.ts` has
unstaged changes (`git diff --name-only`), so a generated Dockerfile/compose pair always matches what
is about to be committed. Two ways around it, both measured rather than theoretical:
- **`git commit -m x -- apps/web/deploy.config.ts`** (a pathspec commit): the refusal check reads an
  index that already holds the working-tree copy, so it finds nothing dirty and never fires. The
  generated file lands in the commit, but the main index is left stale — `git status` afterwards
  shows a spurious `MM apps/web/Dockerfile`. Self-heals on the next commit.
- **`git merge --no-ff` and `git rebase` run no pre-commit hook at all** (`git commit --amend` does).
  A conflict resolution that takes the config from one side and the Dockerfile from the other commits
  an inconsistent pair with nothing local to catch it — only the CI drift check (`check:deploy-config`)
  does.
