# Agent Instructions

## Who You Are Working For
- The repo owner is a software developer and architects this project — choosing the services, shared packages, and tools. What is scarce is time, not ability: explain trade-offs at full engineering depth and never simplify them
- **Present options for dependency, tooling, and architectural choices** — those are the owner's call. Give a recommendation alongside the options, not instead of them
- Once an approach is chosen, implement it without further checkpoints, and report the implementation decisions you made along the way
- Do not assume a diff will be read line by line. Verification has to come from checks you actually ran, so treat a red check as the signal it is and never route around one
- Be conservative wherever a mistake would fail silently rather than loudly

## Package Manager
- Use **pnpm** with Node `24.18.0` and pnpm `10.30.3`
- Canonical root commands: `pnpm install`, `pnpm dev`, `pnpm setup:local`, `pnpm setup:worktree`, `pnpm check`, `pnpm verify`
- Full root surface: `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm db:migrate`, `pnpm db:generate`
- Repro install: `pnpm install --frozen-lockfile`
- If host Node/pnpm mismatch: `./infra/scripts/pnpm-with-pinned-node.sh <pnpm-args>`

## Workspace
- Monorepo: `apps/*` and `packages/*` from `pnpm-workspace.yaml`; root scripts fan out through Turbo
- Live apps: `apps/web`, `apps/api`, `apps/cube-trainer`, `apps/auth` (package `@unimatrix/auth-app`) — all Vite + React + TanStack Router except `apps/api` (Fastify); see Workspace Responsibilities for what each owns
- Live packages: `packages/ui`, `packages/shared`, `packages/api-client`, `packages/content`, `packages/db`, `packages/auth`, `packages/user-data`, `packages/config-typescript`, `packages/config-eslint`, `packages/config-vitest`
- Live content: `content/home`, `content/projects`, `content/blog`
- Repo-internal docs: `docs/`; infra/runtime helpers: `infra/scripts`, `infra/deployment`, `infra/docker`
- Reserved, not live: `apps/workers`, `content/docs`, `content/notes`, future packages like `packages/bmd-parser`
- Keep repo facts current-first; do not treat reserved paths as active runtime surface
- Nearest nested `AGENTS.md` overrides this file

## Workspace Responsibilities
- `apps/web`: route-driven public site, public content rendering, app-owned public-site compositions
- `apps/api`: runtime config validation, Fastify plugins, feature route modules, HTTP error normalization
- `apps/cube-trainer`: OLL/PLL Learn (guided teaching order) and Drill (keyboard-driven flashcard drill) UI, bundled algorithm data, `localStorage`-backed progress and training pool
- `apps/auth`: central Clerk auth hub — sign-in/up and account settings (`UserProfile`); redirect target for other services' sign-in
- `packages/ui`: shared shadcn primitives, shared styles, safe markdown rendering, `@unimatrix/ui/public`
- `packages/shared`: framework-agnostic API contracts, Zod schemas, exported shared types only
- `packages/api-client`: typed fetch transport consuming `@unimatrix/shared` contracts; pluggable `getAuthToken` provider
- `packages/content`: pure parsing, frontmatter validation, repo-backed loaders for live public content only
- `packages/db`: Drizzle + SQLite persistence, schema barrel, migrations, local DB path resolution
- `packages/auth`: single source of truth for the permission scheme (`.`), Clerk Fastify guards (`./server`), and Clerk React provider/hooks (`./react`); never reads `process.env`
- `packages/user-data`: unified per-user store (settings as JSON documents, files as blobs) with an account adapter (via `@unimatrix/api-client`) and a browser-only IndexedDB guest adapter
- `packages/config-vitest`: shared Vitest coverage configuration; owns the provider, reporters, and exclusions, while each workspace supplies its own thresholds

## File-Scoped Commands
Package names: `apps/web`→`@unimatrix/web`, `apps/api`→`@unimatrix/api`, `apps/cube-trainer`→`@unimatrix/cube-trainer`, `apps/auth`→`@unimatrix/auth-app`; packages use `@unimatrix/<dir-name>` (e.g. `packages/auth`→`@unimatrix/auth`).

| Task | Command |
| --- | --- |
| Lint one file | `pnpm exec eslint path/to/file.ts` |
| Test one file (all workspaces except api) | `pnpm --filter <package> exec vitest run path/to/test.ts` |
| API test one file | `pnpm --filter @unimatrix/api exec node --import tsx --test path/to/test.ts` |
| Typecheck a workspace | `pnpm --filter <package> typecheck` |
| Whole-package test (auth, user-data) | `pnpm --filter <package> test` |

## Runtime And Bootstrap
- `pnpm dev` starts only `@unimatrix/api` and `@unimatrix/web`; run `pnpm --filter @unimatrix/cube-trainer dev` (port 5173) and `pnpm --filter @unimatrix/auth-app dev` (port 5175) separately
- `pnpm dev` creates missing `apps/api/.env` and `apps/web/.env` from example files
- `pnpm setup:local` only copies missing env files; it never overwrites existing local env
- `pnpm setup:worktree` runs frozen install, env bootstrap, and default DB migrations; use it for fresh worktrees
- API loads `apps/api/.env.local` first, then `apps/api/.env`; existing shell env wins
- API auth is opt-in: `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`/`CLERK_JWT_KEY` are required in production but optional in dev/test (the API boots with auth + the user-data routes disabled when they are absent); `MAX_UPLOAD_BYTES` defaults to 5 MiB
- Web uses normal Vite `apps/web/.env*` behavior; Clerk is optional there (`VITE_CLERK_PUBLISHABLE_KEY` enables it, `VITE_AUTH_APP_URL` points at the auth hub)
- auth app needs `VITE_CLERK_PUBLISHABLE_KEY` (required) and `VITE_API_BASE_URL` (default `/api`); cube-trainer has no `.env` files and no backend dependency
- CI uses the same root commands and installs Playwright Chromium for web and cube-trainer smoke coverage (the auth app ships unit tests only — no smoke suite, since it needs live Clerk keys)

## Boundaries
- `apps/web`: keep route data in non-lazy route files and UI in paired `*.lazy.tsx`; `src/routes/routeTree.gen.ts` is generated
- `apps/web`: prefer `@unimatrix/ui/public`; keep public-site compositions in `src/features/public-site`; keep site-only styling in `src/styles.css`
- `apps/web`: safe markdown only; keep raw HTML and runtime MDX disabled
- `apps/api`: keep `buildApp()` wiring in `src/app.ts`, cross-cutting setup in `src/plugins`, feature routes in `src/modules`, reusable HTTP helpers in `src/lib/http`; verify Clerk tokens networklessly via the `@unimatrix/auth/server` plugin/guards and read the acting user only from the verified session (`getAuthUserId`), never from client input
- `apps/cube-trainer`: keep the same non-lazy/`*.lazy.tsx` route split as `apps/web`; do not add `@unimatrix/api-client`, `@unimatrix/shared`, `@unimatrix/content`, or `@tanstack/react-query` dependencies unless a real server-backed feature is added
- `apps/auth`: same non-lazy/`*.lazy.tsx` route split as `apps/web`; consume Clerk only through `@unimatrix/auth/react` (never `@clerk/clerk-react` directly); validate any inbound `redirect_url` against the same-family allowlist before use
- `packages/shared`: no transport code, UI code, or content-loading logic; `ApiContract` paths stay static (no path params) — use query/body schemas instead
- `packages/api-client`: do not redefine endpoints or response shapes locally; consume `@unimatrix/shared`; stays auth-library-agnostic (the consumer supplies `getAuthToken`) and DOM/Node-lib-free
- `packages/content`: keep loaders synchronous and filesystem-based unless the package boundary intentionally changes
- `packages/db`: schema under `src/schema`, migrations under `drizzle`, default DB at `packages/db/local/unimatrix.sqlite`
- `packages/auth`: keep the three entry points separate — `.` stays framework-agnostic and dependency-free, `./server` is Node-only, `./react` is browser-only; never cross-import server and react; the package takes config as arguments and never reads `process.env`
- `packages/user-data`: keep the account and guest adapters behind the same store interface so services stay storage-agnostic; do binary file I/O here (not in `@unimatrix/api-client`); key all account data by the caller's session, never by client-provided ids

## Dependency Ceilings
Four packages sit deliberately below `latest`. Each has a reason that is not "we have not got round to it", so do not merge a Dependabot PR proposing them without re-checking the reason still holds.

- **`typescript` is capped at the 6 line.** 7.0.2 is `latest`, but the current `typescript-eslint` (8.65.0) declares `typescript: ">=4.8.4 <6.1.0"`. Installing 7 breaks lint in every workspace at once. The enforcement is the `^6.0.3` caret in each workspace, **not** the `>=5.0.0 <6.1.0` peer in `@unimatrix/config-eslint` — `.npmrc` does not set `strict-peer-dependencies` and pnpm 10 defaults it to false, so a peer mismatch installs silently. Verified, not assumed. Lift the cap when typescript-eslint widens its range.
- **`@types/node` tracks the runtime, not `latest`.** It stays on the major in `.node-version` (24). 26.x describes APIs that do not exist in the Node actually running.
- **`better-sqlite3` stays on the 12 line.** Upstream ships no prebuilds for 13, so it compiles from source and the alpine image has no toolchain. Full reasoning and the CI blind spot are in `packages/db/AGENTS.md`.
- **`recharts` and `react-day-picker` are pinned and unexercised.** They are imported only by `packages/ui/src/components/ui/chart.tsx` and `calendar.tsx`, which no app consumes and no route renders — so the real-browser check this repo requires for `packages/ui` changes cannot be performed on them. `recharts@2.15.4` is additionally deprecated upstream ("1.x and 2.x branches are no longer active"). Upgrading, removing, or wiring them up are all defensible; upgrading them *quietly* is not.

## Key Conventions
- TypeScript only; keep strict typing, named exports, and small composable modules
- Keep package boundaries stable instead of duplicating logic app-locally
- Validate every external input boundary with Zod
- Shared request/response shapes belong in `@unimatrix/shared`; do not redefine them in apps or transport code
- API routes should be contract-driven via `@unimatrix/shared`; keep handlers thin and error formatting centralized
- Use explicit exported types at boundaries instead of anonymous inline shapes
- Public-site UI preserves ShadCN UI, preset `aJMzyTw`, Geist Mono, zero-radius styling, Remix Icons, ADHD-accessible UX, and a desktop-first bias
- Prefer app-local composition over widening shared packages unless multiple workspaces truly need the abstraction
- Content stays Git-backed markdown with safe rendering only; never execute raw HTML, executable MDX, or generated code from `content/`
- Adding `content/projects/*.md` or `content/blog/*.md` requires updating `apps/web/src/features/content/site-content.ts`
- `docs/` is contributor/agent guidance, not public site content

## Validation
- Run the narrowest relevant checks for the files you changed
- Use `pnpm check` as the normal pre-review gate
- Use `pnpm verify` when changes span multiple workspaces or affect runtime/build behavior
- Deeper checks (web, cube-trainer): `pnpm --filter <package> test:unit`, `pnpm --filter <package> test:smoke`
- Auth app deeper checks: `pnpm --filter @unimatrix/auth-app test` (unit only), `pnpm --filter @unimatrix/auth-app build`
- Auth / user-data package checks: `pnpm --filter @unimatrix/auth test`, `pnpm --filter @unimatrix/user-data test`
- Any change to a web component or live site (`apps/web`, `apps/cube-trainer`, `apps/auth`, `packages/ui`) must be live-tested in a real browser before being reported as done — automated tests verify correctness, not that the feature actually works on screen. If no Chromium instance is running, launch one to run this check.
- Never report work as done, working, or verified on the strength of the code looking correct — run the check and report what it actually printed
- State plainly what you could not verify rather than omitting it; an unmentioned gap reads as a confirmed result
- **Do not assert what you have not verified.** This binds hardest on explanations of *why* something behaves as it does: a plausible mechanism reached quickly is still a guess, and stating it as fact is how wrong conclusions get acted on. Test it, or label it a hypothesis
- One corroborating signal is not verification. A hook's output, a doc's phrasing, or another tool's claim can all be wrong — prefer what the system actually does (observed behavior, a command you ran, a reproduction) over what it says about itself
- When observed behavior contradicts a source you trusted, the behavior wins; go back and find what the source actually got wrong rather than explaining the contradiction away

## CI And Automation
- `main` accepts changes by pull request only, and the `Verify` CI job is a required status check; work on a branch and open a PR
- Dependabot runs daily with a 14-day `cooldown`; `pnpm-workspace.yaml` sets `minimumReleaseAge` to 3 days. The pnpm value must stay **below** Dependabot's or updates fail with a misleading "no matching version" error
- All three Dependabot ecosystems set a `cooldown`: 14 days for `npm` and `docker`, **7 days for `github-actions`** — an action bump is a SHA change against a public, reviewable repo rather than an opaque registry tarball, and frequent releasers like `github/codeql-action` make a long window costly. `github-actions` supports only `default-days`; the `semver-*-days` keys are not valid there, and an unsupported key makes Dependabot reject the whole file, silently disabling npm updates too. After editing `.github/dependabot.yml`, check `/network/updates` for a config error: a rejected file looks exactly like a quiet week
- **Dependabot's npm updater runs inside its own image — Node 24, pnpm 10.16.0, npm 11.17.0** (`npm_and_yarn/Dockerfile` in dependabot-core). Root `engines.node` must stay satisfiable by *their* Node, not ours: it was `>=22 <23` with `engine-strict=true` in `.npmrc`, and every npm job errored with "Dependabot does not support your Node version" — no npm PR was ever opened, for the repo's entire life, while the github-actions ecosystem worked fine because it needs no Node. It is now `>=22`, an open-ended floor, so a future Dependabot Node bump cannot re-break it. The real pin for humans and CI is `.node-version` plus CI's `node-version-file`, not `engines`
- `minimumReleaseAge` needs pnpm >= 10.16 and Dependabot ships exactly **10.16.0** — no margin. If they ever ship older, that setting silently becomes a no-op
- Check `/network/updates` (Insights → Dependency graph → Dependabot) after touching anything Dependabot reads. The `.github/dependabot.yml` status check on a PR proves only that the *file parses*; it says nothing about whether the updater can run
- Auto-merge is armed for grouped minor/patch Dependabot PRs only, and gates on CI rather than on any review
- CI's `Images` job builds all four `apps/*/Dockerfile`, and its four matrix checks — `Images (api)`, `Images (auth)`, `Images (cube-trainer)`, `Images (web)` — are required on `main` alongside `Verify`. This exists because `Verify` is Vite and tsc only and never touches a Dockerfile, so a dependency could pass every check while making the deployable image unbuildable. `better-sqlite3@13` is the live example: no published prebuilds, so it falls back to `node-gyp` and dies on alpine. If you add a Dockerfile, add it to the matrix **and** to the required checks, or it is unverified
- CodeRabbit is advisory and non-blocking: treat its comments as leads to verify against primary sources, never as conclusions to act on directly
- Never add self-hosted Actions runners — this repo is public, so fork PRs would execute untrusted code on the owner's hardware
- Pin third-party actions to a commit SHA with the version in a trailing comment
- Several workflow settings that look redundant are load-bearing and carry a comment saying why; read the comment before removing one

## Git And PR Rules
- Keep PRs small and issue-aligned; avoid unrelated scaffolding or setup churn
- Use one issue branch per scoped piece of work
- Use conventional commits

## Commit Attribution
AI commits MUST include attribution matching the acting AI agent or model identity in the `Co-Authored-By` header (e.g. `Co-Authored-By: Antigravity <noreply@google.com>` or `Co-Authored-By: Gemini <noreply@google.com>`).
