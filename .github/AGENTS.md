# AGENTS.md — CI and Dependabot mechanics

Loaded when working in `.github/`. The root `AGENTS.md` keeps only the rules that bind everywhere;
this file holds the mechanics, each of which was learned the hard way.

## Dependabot

- Dependabot runs daily with a 14-day `cooldown`; `pnpm-workspace.yaml` sets `minimumReleaseAge` to
  3 days. The pnpm value must stay **below** Dependabot's, or updates fail with a misleading "no
  matching version" error.
- All three ecosystems set a `cooldown`: 14 days for `npm` and `docker`, **7 days for
  `github-actions`** — an action bump is a SHA change against a public, reviewable repo rather than
  an opaque registry tarball, and frequent releasers like `github/codeql-action` make a long window
  costly. `github-actions` supports only `default-days`; the `semver-*-days` keys are not valid
  there, and an unsupported key makes Dependabot reject the whole file, silently disabling npm
  updates too.
- **Dependabot's npm updater runs inside its own image — Node 24, pnpm 10.16.0, npm 11.17.0**
  (`npm_and_yarn/Dockerfile` in dependabot-core). Root `engines.node` must stay satisfiable by
  *their* Node, not ours: it was `>=22 <23` with `engine-strict=true` in `.npmrc`, and every npm job
  errored with "Dependabot does not support your Node version" — no npm PR was ever opened, for the
  repo's entire life, while the github-actions ecosystem worked fine because it needs no Node. It is
  now `>=22`, an open-ended floor, so a future Dependabot Node bump cannot re-break it. The real pin
  for humans and CI is `.node-version` plus CI's `node-version-file`, not `engines`.
- `minimumReleaseAge` needs pnpm >= 10.16 and Dependabot ships exactly **10.16.0** — no margin. If
  they ever ship older, that setting silently becomes a no-op.
- **Check `/network/updates` (Insights → Dependency graph → Dependabot) after touching anything
  Dependabot reads.** The `.github/dependabot.yml` status check on a PR proves only that the *file
  parses*; it says nothing about whether the updater can run. A rejected config looks exactly like a
  quiet week.
- Auto-merge is armed for grouped minor/patch Dependabot PRs only, and gates on CI rather than on
  any review.

## CI

- CI's `Images` job builds every `apps/*/Dockerfile`, and all five matrix checks — `Images (admin)`,
  `Images (api)`, `Images (auth)`, `Images (cflop)`, `Images (web)` — are required on `main`
  alongside `Verify`, `Review dependency changes`, `Analyze`, and `CodeQL`. This exists because `Verify` is Vite and tsc only and never touches a Dockerfile, so a
  dependency could pass every check while making the deployable image unbuildable. `better-sqlite3@13`
  is the live example: no published prebuilds, so it falls back to `node-gyp` and dies on alpine.
  **If you add a Dockerfile, add it to the matrix and to the required checks, or it is unverified.**
- `infra/scripts/check-app-wiring.sh` (run by `pnpm check`/`pnpm verify` and by the `App wiring`
  step in `Verify`, placed before `pnpm install` because it needs no `node_modules`) is the
  mechanical guard on three things nothing else sees: the `packages/chrome` `@source` line in each
  Vite app's stylesheet, `@tanstack/react-router` in its vite `dedupe`, and every
  `apps/*/Dockerfile` appearing in the `Images` matrix. It is also the app template — a new app
  satisfies it or the check goes red. Adding it to `pnpm check` alone is not a pre-merge gate: the
  only other thing that runs it is the scheduled `maintenance.yml` pass against already-merged
  `main`.
- `infra/scripts/check-agents-md-symlinks.sh` (same placement and rationale, as the `AGENTS.md
  symlinks` step) asserts every `AGENTS.md` has a sibling `CLAUDE.md` symlink pointing at it.
  Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and discovers nested ones on demand when a file in
  their directory is read — so an `AGENTS.md` without the symlink reaches no agent, and nothing else
  notices. It fails closed on a missing symlink, a regular file in its place, a wrong target, and a
  `CLAUDE.md` whose `AGENTS.md` was renamed away.
- Three more guards, all added after a documentation audit found the drift each one now prevents.
  `check-watch-paths.mjs` (`Watch paths`) is the only one with a production consequence: it derives
  each app's real inputs from the `@unimatrix/*` specifiers under its `src/` and fails if one is
  missing from the fenced watch-path list in its README, because Dokploy rebuilds only on those
  paths — `packages/chrome/**` was absent from three apps, so the shared site chrome could change
  without them redeploying. `check-stale-comments.mjs` (`Stale comments`) fails when a backticked
  `PascalCase` name in a comment exists in no code; an "occluder" mechanism was deleted and five
  comments across four workspaces outlived it. `check-coverage-drift.mjs` (`Coverage drift`) runs
  **after** `pnpm test` because it reads the `coverage/coverage-summary.json` that run writes, and
  fails when a floor sits more than 5 points under the measurement — `packages/auth` gated at 26
  while measuring 73.84. The 5 points are deliberate: V8 re-attributes functions between Node
  majors, so a floor pinned to the exact figure reddens on the next runtime bump for no real reason.
- All three were validated by breaking them on purpose, not by watching them pass. A check that
  cannot be shown to fail is not known to work.
- Two workflows serve `lab`. `Prototypes guard` (job `No prototypes on main`) runs on **every**
  pull request to `main` with no `paths:` filter and fails when the diff adds a file under
  `lab/prototypes/` — the `.gitkeep` and `README.md` scaffolding are allow-listed. The filter is
  omitted deliberately: a path-filtered workflow that does not run reports nothing, and a required
  check that never reports blocks a PR forever instead of passing it. This is repo hygiene, not a
  security control. `Lab` runs lint + typecheck of `lab/src` on `lab/**` branches; full `Verify`
  there would fail on coverage thresholds and burn minutes for nothing. Neither is armed as a
  required check.
- Several workflow settings that look redundant are load-bearing and carry a comment saying why.
  Read the comment before removing one.
