# Agent Instructions

## Who You Are Working For
- The repo owner is a software developer and architects this project — choosing the services, shared packages, and tools. What is scarce is time, not ability: explain trade-offs at full engineering depth and never simplify them
- **Present options for dependency, tooling, and architectural choices** — those are the owner's call. Give a recommendation alongside the options, not instead of them
- Once an approach is chosen, implement it without further checkpoints, and report the implementation decisions you made along the way. The one stop is before opening a PR — see the `ship-pr` skill
- Do not assume a diff will be read line by line. Verification has to come from checks you actually ran, so treat a red check as the signal it is and never route around one
- **Keep a task list, and update it live.** Because the diff is not the progress surface, the task list is — use `TaskCreate`/`TaskUpdate` for anything beyond a couple of trivial steps. Live means the moment the owner raises an issue or a request, including mid-turn, it becomes a task; not batched at the end of a turn, and not reconstructed afterwards. Mark a task in progress before starting it and completed only when it is actually finished — a task list that lags the work is worse than none, because it reads as status
- Be conservative wherever a mistake would fail silently rather than loudly
- The repo owner likes ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery just because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising

## Package Manager
- Use **pnpm** with Node `24.18.0` and pnpm `10.30.3`
- Canonical root commands: `pnpm install`, `pnpm dev`, `pnpm setup:local`, `pnpm setup:worktree`, `pnpm check`, `pnpm verify`
- If host Node/pnpm mismatch: `./infra/scripts/pnpm-with-pinned-node.sh <pnpm-args>`

## Workspace
- Monorepo: `apps/*`, `packages/*`, and `lab` from `pnpm-workspace.yaml`; root scripts fan out through Turbo. The roster is the filesystem — read it there rather than from a list here that drifts
- Apps are Vite + React + TanStack Router except `apps/api` (Fastify). **`apps/auth` is the package `@unimatrix/auth-app`** — the one workspace whose package name does not follow its directory
- `lab` (package `@unimatrix/lab`) is a **local-dev-only** UX prototyping harness: `pnpm --filter @unimatrix/lab dev` and nothing else — no build script, no Dockerfile, no domain, no CI `Images` entry. See `lab/AGENTS.md`
- `packages/config-vitest` owns the coverage provider, reporters and exclusions, while each workspace supplies its own thresholds. Per-package rules for everything else are in Boundaries below
- Reserved, not live: `apps/workers`, `content/docs`, `content/notes`, future packages like `packages/bmd-parser`. Never describe a reserved path as an active runtime surface
- Nested `AGENTS.md` files carry the per-directory detail and override this file where they overlap. They load on demand, when a file in their directory is read — **Claude Code reads `CLAUDE.md`, not `AGENTS.md`**, so each one needs a sibling `CLAUDE.md` symlink or it reaches no agent at all. `pnpm check:agents-md` fails closed on a missing, wrong-target, or non-symlink one. Nested files are not re-injected after `/compact`; they reload on the next read in that directory, so anything that must survive compaction belongs in this file
- **Do not iterate on `.claude/` from a worktree — use the main checkout.** A worktree's own `.claude/` is never scanned: the project root resolves to the main checkout, so the skills, settings and hooks in force are that checkout's, whatever the worktree's branch contains. Committing a `.claude/` change from a worktree is fine; *testing* one there is not, and a skill edited on a feature branch stays inert until it merges. Never infer from a diff that the worktree copy is the one running

## File-Scoped Commands

| Task | Command |
| --- | --- |
| Lint one file | `pnpm exec eslint path/to/file.ts` |
| Test one file (all workspaces except api) | `pnpm --filter <package> exec vitest run path/to/test.ts` |
| API test one file | `pnpm --filter @unimatrix/api exec node --import tsx --test path/to/test.ts` |
| Typecheck a workspace | `pnpm --filter <package> typecheck` |
| Whole-package test (auth, user-data) | `pnpm --filter <package> test` |

## Runtime And Bootstrap
- `pnpm dev` starts only `@unimatrix/api` and `@unimatrix/web`; run `pnpm --filter @unimatrix/cflop dev` (port 5173), `pnpm --filter @unimatrix/auth-app dev` (port 5175) and `pnpm --filter @unimatrix/admin dev` (port 5176) separately
- `pnpm dev` creates missing `apps/api/.env` and `apps/web/.env` from example files
- `pnpm setup:local` only copies missing env files; it never overwrites existing local env
- `pnpm setup:worktree` runs frozen install, env bootstrap, and default DB migrations; use it for fresh worktrees
- API loads `apps/api/.env.local` first, then `apps/api/.env`; existing shell env wins
- API auth is opt-in: `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`/`CLERK_JWT_KEY` are required in production but optional in dev/test (the API boots with auth + the user-data routes disabled when they are absent); `MAX_UPLOAD_BYTES` defaults to 5 MiB and `MAX_USER_STORAGE_BYTES` (the cumulative per-user cap across documents and files) to 50 MiB
- Web uses normal Vite `apps/web/.env*` behavior; Clerk is optional there (`VITE_CLERK_PUBLISHABLE_KEY` enables it, `VITE_AUTH_APP_URL` points at the auth hub)
- auth app needs `VITE_CLERK_PUBLISHABLE_KEY` (required) and `VITE_API_BASE_URL` (default `/api`); admin app needs the same plus `VITE_AUTH_APP_URL` (default `https://auth.unimatrix-01.dev`, must be absolute http(s)); cflop has no `.env` files and no backend dependency
- `pnpm setup:local` does **not** bootstrap `apps/admin/.env` — it only copies `apps/api` and `apps/web`. Copy `apps/admin/.env.example` by hand for local dev
- CI uses the same root commands and installs Playwright Chromium for web and cflop smoke coverage (the auth app ships unit tests only — no smoke suite, since it needs live Clerk keys)

## Boundaries
- `apps/web`: keep route data in non-lazy route files and UI in paired `*.lazy.tsx`; `src/routes/routeTree.gen.ts` is generated
- `apps/web`: prefer `@unimatrix/ui/public`; keep public-site compositions in `src/features/public-site`; keep site-only styling in `src/styles.css`. The site chrome itself is **not** app-owned: header, nav tabs, breadcrumbs, and the site footer come from `@unimatrix/chrome/public`. What stays in the app is the knowledge the package refuses to hold — the route-to-tab mapping, the breadcrumb trail, and `AuthHeaderAction`, which is passed in as the `accountControl` slot so the package never gains `@unimatrix/auth`
- `apps/api`: keep `buildApp()` wiring in `src/app.ts`, cross-cutting setup in `src/plugins`, feature routes in `src/modules`, reusable HTTP helpers in `src/lib/http`; verify Clerk tokens networklessly via the `@unimatrix/auth/server` plugin/guards and read the acting user only from the verified session (`getAuthUserId`), never from client input
- `apps/cflop`: keep the same non-lazy/`*.lazy.tsx` route split as `apps/web`; do not add `@unimatrix/api-client`, `@unimatrix/shared`, `@unimatrix/content`, or `@tanstack/react-query` dependencies unless a real server-backed feature is added
- `apps/auth`: same non-lazy/`*.lazy.tsx` route split as `apps/web`; consume Clerk only through `@unimatrix/auth/react` (never `@clerk/clerk-react` directly); validate any inbound `redirect_url` against the same-family allowlist before use
- `apps/admin`: same non-lazy/`*.lazy.tsx` route split; Clerk only through `@unimatrix/auth/react`; the shell is `@unimatrix/chrome/tool`, never the public shell — this is a tool surface, so no site nav tabs and no site footer. Every admin section gates on `canAccessAdminSection` from `@unimatrix/auth` rather than open-coding a permission check; the scaffold's one placeholder route is deliberately ungated because it has nothing to guard. No `@tanstack/react-query` until something actually fetches. Runtime config travels through the router context — `src/main.tsx` is the only file that reads `import.meta.env`, because `loadAdminAppRuntimeConfig` throws on a missing Clerk key and a module-level router singleton would move that throw to import time
- `packages/chrome`: composes `@unimatrix/ui` and nothing else — never `@unimatrix/auth`. Both shells take the account control as a `ReactNode` slot, which is what lets a sign-in-free tool like `apps/cflop` import one without pulling Clerk into its dependency tree. Route knowledge (nav items, breadcrumb trails, sign-in hrefs) is passed in by the app, not computed here. Source-only like `@unimatrix/e2e-helpers`: consumers resolve `src/*.ts` through a vite alias plus a tsconfig `paths` entry, so its tsconfig extends `base.json` rather than `library.json` — `composite` forbids the cross-package `paths` mapping onto `packages/ui/src` and the emit would be dead weight nothing reads. Keep `@tanstack/react-router` a peer dependency and listed in each consuming app's vite `dedupe`: two resolved copies means the shell's `useRouterState` reads a router context the app's `RouterProvider` never wrote to. Every consuming app also needs `@source "../../../packages/chrome/src/**/*.{ts,tsx}"` in its stylesheet — Tailwind v4 source detection does not reach a sibling package, and without it the shell's utilities are simply not emitted. `infra/scripts/check-app-wiring.sh` fails closed on both the `@source` line and the `dedupe` entry, and runs in `pnpm check`/`pnpm verify` and CI's `Verify`
- `packages/app-config`: Zod env validation for the Vite apps' runtime and dev-proxy config boundaries. Field builders, not app loaders — each app composes its own schema in `src/lib/config.ts`; `zod` stays this package's implementation detail (apps use `envSchema` and never import it). Source-only like chrome, with one extra wrinkle: `vite.config.ts` imports it in Node context, which works only because vite's esbuild bundling follows the workspace symlink — plain `node` cannot resolve it (type stripping refuses `node_modules`), so never import it from scripts or the API. Error messages are a compatibility surface asserted by app tests. See `packages/app-config/AGENTS.md`
- `packages/shared`: no transport code, UI code, or content-loading logic; `ApiContract` paths stay static (no path params) — use query/body schemas instead
- `packages/api-client`: do not redefine endpoints or response shapes locally; consume `@unimatrix/shared`; stays auth-library-agnostic (the consumer supplies `getAuthToken`) and DOM/Node-lib-free
- `packages/content`: keep loaders synchronous and filesystem-based unless the package boundary intentionally changes
- `packages/db`: schema under `src/schema`, migrations under `drizzle`, default DB at `packages/db/local/unimatrix.sqlite`
- `packages/auth`: keep the three entry points separate — `.` stays framework-agnostic and dependency-free, `./server` is Node-only, `./react` is browser-only; never cross-import server and react; the package takes config as arguments and never reads `process.env`
- `packages/user-data`: keep the account and guest adapters behind the same store interface so services stay storage-agnostic; do binary file I/O here (not in `@unimatrix/api-client`); key all account data by the caller's session, never by client-provided ids
- `packages/e2e-helpers`: test-only and app-agnostic — helpers take the selectors, route labels, and accessibility baseline they act on as arguments, so anything naming a specific app belongs in that app's `e2e/*.spec.ts` instead. Import it only from `e2e/`, never from `src/`. Consumers resolve it through a tsconfig `paths` entry pointing at `src/index.ts`, not through the `exports` map: Playwright will not transpile a path containing `node_modules`, so the symlinked resolution fails on raw TypeScript. Keep `@playwright/test` a peer dependency — two resolved copies means `expect` cannot see the running test
- `lab`: local-dev only, and that is what makes its security question disappear — prototype code has no production surface to leak onto. **Never add a deploy artifact of any kind** (Dockerfile, compose file, domain, `Images` matrix entry, `build` script, or a route in a deployed app). Prototypes reach data through `lab/src/mocks/` and nowhere else: `@unimatrix/api-client`, `@unimatrix/user-data`, `@unimatrix/auth/react`, `@unimatrix/auth/server` and `@clerk/*` are lint errors there, because the real client with a base URL pointed at production can mutate live content from a laptop. The API base URL is a hardcoded `http://localhost:3000` asserted local at module load — there is deliberately no `VITE_API_BASE_URL`. Unlike the apps, `@unimatrix/ui` and `@unimatrix/shared` resolve to package **source** through lab's own vite alias and tsconfig `paths`; both are `tsc`-built and publish `./dist`, so without that, editing a shared component shows nothing in the lab until a rebuild. The shared `boundaries`/`no-restricted-imports` configs are silent no-ops for a one-level-deep workspace (verified: they derive the repo root and the workspace id from a two-level path), which is why lab's bans live in `lab/eslint.config.mjs`. `lab/prototypes/` is excluded from lint, typecheck and prettier but **included** in the stylesheet's `@source` globs

## Dependency Ceilings
The packages below sit deliberately below `latest`. Each has a reason that is not "we have not got round to it", so do not merge a Dependabot PR proposing them without re-checking the reason still holds.

- **`typescript` is capped at the 6 line.** 7.0.2 is `latest`, but the current `typescript-eslint` (8.65.0) declares `typescript: ">=4.8.4 <6.1.0"`. Installing 7 breaks lint in every workspace at once. The enforcement is the `^6.0.3` caret in each workspace, **not** the `>=5.0.0 <6.1.0` peer in `@unimatrix/config-eslint` — `.npmrc` does not set `strict-peer-dependencies` and pnpm 10 defaults it to false, so a peer mismatch installs silently. Verified, not assumed. Lift the cap when typescript-eslint widens its range.
- **`@types/node` tracks the runtime, not `latest`.** It stays on the major in `.node-version` (24). 26.x describes APIs that do not exist in the Node actually running.
- **`better-sqlite3` stays on the 12 line.** Upstream ships no prebuilds for 13, so it compiles from source and the alpine image has no toolchain. `Images (api)` is what catches it; full reasoning is in `packages/db/AGENTS.md`.
- **`recharts` and `react-day-picker` are pinned and unexercised.** They are imported only by `packages/ui/src/components/ui/chart.tsx` and `calendar.tsx`, which no app consumes and no route renders — so the real-browser check this repo requires for `packages/ui` changes cannot be performed on them. `recharts@2.15.4` is additionally deprecated upstream ("1.x and 2.x branches are no longer active"). Upgrading, removing, or wiring them up are all defensible; upgrading them *quietly* is not.

## Key Conventions
- TypeScript only; keep strict typing, named exports, and small composable modules
- Validate every external input boundary with Zod
- Shared request/response shapes belong in `@unimatrix/shared`; do not redefine them in apps or transport code
- API routes should be contract-driven via `@unimatrix/shared`; keep handlers thin and error formatting centralized
- Use explicit exported types at boundaries instead of anonymous inline shapes
- Public-site UI preserves ShadCN UI, preset `aJMzyTw`, Geist Mono, zero-radius styling, Remix Icons, ADHD-accessible UX, and a desktop-first bias
- **The site header/navbar + footer combo is for content surfaces only.** The split is tool vs content, *not* signed-in vs public: `apps/cflop` is a public, sign-in-free tool and belongs on the tool side. Tools, dashboards, and admin surfaces get a desktop-app shell — their own chrome, their own navigation, no site nav tabs, no site footer. A way back to the public site (and the account control, where there is one) belongs in that chrome, not a copy of the public header. Reach for application layout patterns (title bar, sidebar/toolbar, dense content region), not page layout patterns
- **Prefer shared-package composition.** Anything reusable — a component, a hook, a helper, a type, a whole capability — belongs in the package that owns that concern (`packages/ui`, `packages/shared`, `packages/e2e-helpers`, or a new package), not copied into an app. Build it there first rather than app-locally "for now": a second consumer is the normal case in this monorepo, and the app-local copy is what makes the two drift. App-local stays right for genuinely app-specific composition — a route's own layout, a page-specific arrangement of shared parts — and for anything that would drag an app-only dependency into a shared package. When a shared home would break a package's stated boundary (see Boundaries), add the entry point or the package rather than reaching around it — and prefer keeping an existing boundary stable over moving it
- Blog and project entries live in the content database behind the API and are fetched at runtime (`apps/web/src/features/content/queries`); publishing is an authenticated HTTP call, not a commit. `content/blog/*.md` and `content/projects/*.md` remain only as the seed input for `pnpm --filter @unimatrix/api seed:content`
- `content/home/index.md` is the one file still compiled into the bundle — it feeds `/` and `/about` through `apps/web/src/features/content/site-content.ts`. It is site copy rather than an archive, has no listing or admin surface, and baking it in keeps the homepage's first paint free of a round-trip
- Rendering is safe-markdown only wherever content comes from; never execute raw HTML, executable MDX, or generated code — this binds harder now that post bodies are user-editable through the CMS rather than reviewed in a PR
- `docs/` is contributor/agent guidance, not public site content
- **Writing or editing any documentation — a `.md` file, an `AGENTS.md`, a README, a code comment, a PR body — goes through the `writing-docs` skill.** Skills do not auto-activate, so invoke it; the `PostToolUse` hook in `.claude/settings.json` raises it once per session on the first `.md` edit, but it cannot see a code comment or a PR body and those are the ones that need you to remember. The skill carries what this repo is opinionated about: current state and live constraints only (git holds the history), no restating what cannot drift, no docs about docs, and label what you did not verify. Docs state what is true now, not the story of how it got that way

## Validation
- Run the narrowest relevant checks for the files you changed
- Use `pnpm check` as the normal pre-review gate
- Use `pnpm verify` when changes span multiple workspaces or affect runtime/build behavior
- Deeper checks (web, cflop): `pnpm --filter <package> test:unit`, `pnpm --filter <package> test:smoke`
- Auth app deeper checks: `pnpm --filter @unimatrix/auth-app test` (unit only), `pnpm --filter @unimatrix/auth-app build`
- Admin app deeper checks: `pnpm --filter @unimatrix/admin test` (unit only — no smoke suite, same reason as the auth app), `pnpm --filter @unimatrix/admin build`
- Auth / user-data package checks: `pnpm --filter @unimatrix/auth test`, `pnpm --filter @unimatrix/user-data test`
- Any change to a web component or live site (`apps/web`, `apps/cflop`, `apps/auth`, `apps/admin`, `packages/ui`, `packages/chrome`) must be live-tested in a real browser before being reported as done — automated tests verify correctness, not that the feature actually works on screen. If no Chromium instance is running, launch one to run this check.
- **Never report work as done, working, or verified on the strength of the code looking correct** — run the check and report what it actually printed. This binds hardest on explanations of *why* something behaves as it does: a plausible mechanism reached quickly is still a guess. Test it, or label it a hypothesis
- One corroborating signal is not verification. A hook's output, a doc's phrasing, or another tool's claim can each be wrong — prefer what the system actually does (a command you ran, a reproduction) over what it says about itself. When observed behavior contradicts a source you trusted, the behavior wins: find what the source got wrong rather than explaining the contradiction away
- State plainly what you could not verify rather than omitting it; an unmentioned gap reads as a confirmed result

## CI And Automation
- `main` accepts changes by pull request only. `Verify`, the five `Images (*)` matrix checks, `Review dependency changes`, `Analyze`, and `CodeQL` are required status checks; merges are squash-only with required linear history; work on a branch and open a PR
- **Never add self-hosted Actions runners** — this repo is public, so fork PRs would execute untrusted code on the owner's hardware
- Pin third-party actions to a commit SHA with the version in a trailing comment
- Adding a Dockerfile means adding it to CI's `Images` matrix **and** to the required checks, or it is unverified
- CodeRabbit is advisory and non-blocking: treat its comments as leads to verify against primary sources, never as conclusions to act on directly. **It is not a required check and must never gate a merge** — if it is late or rate-limited, merge on the required checks and take its findings as a follow-up PR. What a passing CodeRabbit check does *not* tell you is whether it ran: rate-limited runs report `pass` with the literal text `Review rate limited`, so confirm a real review before claiming one
- **Ask for the CodeRabbit review; it does not run automatically** (`.coderabbit.yaml` sets `reviews.auto_review.enabled: false`). Comment `@coderabbitai review` **once per PR, when the diff is finished** — every run spends a per-developer rate-limit slot, and Pro Plus limits are adaptive, so sustained pinging makes them tighter. Batch fixes into one push before the ping. Spend a second review only when the first surfaced something severe (silent data loss, an auth hole, a correctness bug) *and* the fix for it is substantial enough to be unreviewed code in its own right; nitpicks never earn one. The limit comment's "Next review available in: N minutes" is not a live clock — it is rewritten only when CodeRabbit runs, so compute the reset as its `updated_at` plus that countdown rather than waiting for the text to change
- Dependabot and CI mechanics — cooldowns, the `engines.node` trap that silently disabled npm updates, `minimumReleaseAge`, the `Images` matrix rationale — are in `.github/AGENTS.md`. Read it before editing anything Dependabot or CI reads

## Git And PR Rules
- Keep PRs small and issue-aligned; avoid unrelated scaffolding or setup churn
- Use one issue branch per scoped piece of work
- Use conventional commits

## Commit Attribution
AI commits MUST include attribution matching the acting AI agent or model identity in the `Co-Authored-By` header.
