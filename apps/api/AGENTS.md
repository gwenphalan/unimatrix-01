# AGENTS.md

## 1. Overview
`apps/api` is the Fastify API workspace for Unimatrix.

## 2. Folder Structure
- `src/app.ts`: Fastify construction, runtime config decoration, and global error and not-found handlers.
- `src/server.ts`: process startup, signal handling, and server listen/shutdown flow.
- `src/config.ts` and `src/env.ts`: runtime config loading and local env-file support.
- `src/plugins`: cross-cutting Fastify setup; `index.ts` is the current list and the registration order.
- `src/modules`: route modules grouped by feature (`health`, `content`, `user-data`); `index.ts` registers the active modules.
- `src/lib/http`: shared HTTP-layer helpers such as logging, validation, error normalization, and the inline-safe content-type allowlist.

## 2a. Coverage Floor
`pnpm test` here runs under `--experimental-test-coverage` with `--test-coverage-lines=92` and `--test-coverage-functions=89`. They sit deliberately ~3 points under the measurement rather than at it: V8 re-attributes functions between Node majors (see the first bullet below), and a floor set to the exact measured number turns the next runtime bump into a red required check for a reason that is not a regression. Run `pnpm --filter @unimatrix/api test` for where the workspace actually stands, and raise the flags — keeping that margin — when you have genuinely closed a gap. This is the same ratchet policy `@unimatrix/config-vitest` applies to the vitest workspaces — `apps/api` runs the Node test runner instead, so it expresses the policy through flags rather than that shared config. Branch coverage is reported but not gated, matching the shared config's reasoning.

Four details are load-bearing:
- **The measured number depends on the Node version.** These flags read V8's own coverage accounting, and V8 changes how it attributes functions between majors, so the same tree measures differently on a runtime bump. Lines rising while functions fall is the signature of re-attribution, not of code going unexecuted — check that before treating a drop as a regression.
- `--test-coverage-include='src/**'` is required. Without it the report also counts `test/` and the `packages/*` sources the tests pull in, so the floor measures other workspaces' testing.
- Node reports **line %** where vitest reports **statements %**. The two numbers are not directly comparable.
- `test/module-graph.test.ts` imports every `src/` module and is what keeps the denominator honest — Node only reports files the run loaded, so without it an untested new module is absent from the report entirely and the percentage rises as coverage falls. Read the comment in that file before changing it.

Raising a threshold after genuinely improving coverage is the intended workflow. Lowering one should be a deliberate, explained edit, not a quiet fix for a red build.

One such edit already happened, and the mechanism is worth knowing because it looks like a regression. Adding `test/user-data-routes.test.ts` made the function threshold **fall** from 89 to 85 while coverage genuinely improved: before it, `userDataModule` was never registered (no test configured Clerk), so its eight route handlers were never created and never counted. Registering the module put them in the denominator while the auth guard still rejected before any handler ran. That gap is closed — `test/user-data-authenticated-routes.test.ts` mints a signed Clerk session, and `src/modules/user-data/index.ts` now reports 100% function coverage.

## 3. Core Behaviors & Patterns
- **App wiring**: `buildApp()` in `src/app.ts` creates the Fastify instance, decorates `runtimeConfig`, installs core plugins, and centralizes error and not-found handling before modules are registered.
- **Plugin-first cross-cutting setup**: `src/plugins/index.ts` is the single assembly point for validation, observability, security, and CORS. Add new cross-cutting HTTP behavior there instead of scattering setup across route modules.
- **Contract-driven routes**: Route modules import contracts and Zod schemas from `@unimatrix/shared`, then register handlers through `app.withTypeProvider<ZodTypeProvider>().route(...)`. Response schemas and query validation live with the shared contract definitions, not ad hoc in handlers.
- **Normalized error envelopes**: `src/lib/http/errors.ts` converts validation errors, custom API errors, Fastify client errors, and unexpected failures into a consistent envelope plus log level. Keep new handler code compatible with that normalization path instead of formatting responses inline.
- **Module boundary**: `src/modules/*/index.ts` exports `FastifyPluginAsync` modules, and `src/modules/index.ts` owns registration. Keep handlers inside feature modules and avoid growing `app.ts` into a route registry.
- **Conditional module registration**: `src/modules/index.ts` only registers `userDataModule` when `app.runtimeConfig.clerk !== null`, i.e. when Clerk env vars are configured. In dev/test without Clerk keys, the user-data routes are simply absent — check runtime config before assuming a route is missing due to a bug. `contentModule` is registered unconditionally because its public read routes back the public site, and it applies the same condition *internally* to its own `/content/admin` routes.
- **Public vs admin content routes**: everything under `/content/admin` carries `preHandler: requireAdmin` (`requirePermission("auth", "admin")`); the three public routes (`/content/posts`, `/content/post`, `/content/assets/:hash`) carry no preHandler by design. `test/content-routes.test.ts` pins that split structurally by reading the module source — an admin route added without the guard fails there, not at runtime. For a behavioural test instead, `test/user-data-authenticated-routes.test.ts` shows how to sign a session.
- **Auth boundary**: Route handlers must read the acting user only via `getAuthUserId` (from `@unimatrix/auth/server`, backed by a verified Clerk session) — never from client-supplied ids or body fields. Every route in `user-data` is gated by `requireAuth()` first and then reads the id through the module-local `getRequiredAuthUserId()` wrapper, which normalizes the defensive `null` case to a `401`; call that wrapper rather than `getAuthUserId()` directly in handler bodies.

## 4. Conventions
- **Naming**: Use `setup*`, `register*`, `load*`, and `build*` verbs for framework assembly helpers. Shared API types use `Api*` prefixes, and route modules export `*Module`.
- **Imports**: Use external packages first, then workspace packages like `@unimatrix/shared`, then relative imports. Relative ESM imports keep the explicit `.js` extension.
- **Structure**: Put reusable HTTP helpers under `src/lib/http`, cross-cutting Fastify bootstrapping under `src/plugins`, and feature routes under `src/modules/<feature>`.
- **Types**: Prefer explicit exported interfaces and type aliases such as `ApiRuntimeConfig`, `ApiErrorEnvelope`, and `HealthResponse` instead of inferred anonymous shapes at module boundaries.

