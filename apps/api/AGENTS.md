# AGENTS.md

## 1. Overview
`apps/api` is the Fastify API workspace for Unimatrix. It keeps runtime configuration, core HTTP plumbing, and route modules thin while reusing shared contracts and schemas from `@unimatrix/shared`.

## 2. Folder Structure
- `src/app.ts`: Fastify construction, runtime config decoration, and global error and not-found handlers.
- `src/server.ts`: process startup, signal handling, and server listen/shutdown flow.
- `src/config.ts` and `src/env.ts`: runtime config loading and local env-file support.
- `src/plugins`: cross-cutting Fastify setup for validation, observability, security, and CORS.
- `src/modules`: route modules grouped by feature (`health`, `user-data`); `index.ts` registers the active modules.
- `src/lib/http`: shared HTTP-layer helpers such as logging, validation, and error normalization.
- `test`: Node test runner coverage for app construction, config, env loading, and the user-data store.

## 2a. Coverage Floor
`pnpm test` here runs under `--experimental-test-coverage` with `--test-coverage-lines=85` and `--test-coverage-functions=85`, the numbers this workspace measures today rounded down. This is the same ratchet policy `@unimatrix/config-vitest` applies to the vitest workspaces — `apps/api` runs the Node test runner instead, so it expresses the policy through flags rather than that shared config. Branch coverage is reported but not gated, matching the shared config's reasoning.

Three details are load-bearing:
- `--test-coverage-include='src/**'` is required. Without it the report also counts `test/` and the `packages/*` sources the tests pull in, which inflated the aggregate from 81.61% to 89.44% and made the floor measure other workspaces' testing.
- Node reports **line %** where vitest reports **statements %**. The two numbers are not directly comparable.
- `test/module-graph.test.ts` imports every `src/` module and is what keeps the denominator honest — Node only reports files the run loaded, so without it an untested new module is absent from the report entirely and the percentage rises as coverage falls. Read the comment in that file before changing it.

Raising a threshold after genuinely improving coverage is the intended workflow. Lowering one should be a deliberate, explained edit, not a quiet fix for a red build.

One such edit already happened, and it is the reason the two numbers are equal. Adding `test/user-data-routes.test.ts` made the function threshold **fall** from 89 to 85 while coverage genuinely improved: before it, `userDataModule` was never registered (no test configured Clerk), so its eight route handlers were never created and never counted. Registering the module put them in the denominator, where they sit unexecuted — the auth guard rejects before any handler runs. Line coverage rose 81.61% → 85.53% over the same change. Closing the remaining gap needs an authenticated request, which is currently blocked (see the notes on that test file).

## 3. Core Behaviors & Patterns
- **App wiring**: `buildApp()` in `src/app.ts` creates the Fastify instance, decorates `runtimeConfig`, installs core plugins, and centralizes error and not-found handling before modules are registered.
- **Plugin-first cross-cutting setup**: `src/plugins/index.ts` is the single assembly point for validation, observability, security, and CORS. Add new cross-cutting HTTP behavior there instead of scattering setup across route modules.
- **Contract-driven routes**: Route modules import contracts and Zod schemas from `@unimatrix/shared`, then register handlers through `app.withTypeProvider<ZodTypeProvider>().route(...)`. Response schemas and query validation live with the shared contract definitions, not ad hoc in handlers.
- **Normalized error envelopes**: `src/lib/http/errors.ts` converts validation errors, custom API errors, Fastify client errors, and unexpected failures into a consistent envelope plus log level. Keep new handler code compatible with that normalization path instead of formatting responses inline.
- **Module boundary**: `src/modules/*/index.ts` exports `FastifyPluginAsync` modules, and `src/modules/index.ts` owns registration. Keep handlers inside feature modules and avoid growing `app.ts` into a route registry.
- **Conditional module registration**: `src/modules/index.ts` only registers `userDataModule` when `app.runtimeConfig.clerk !== null`, i.e. when Clerk env vars are configured. In dev/test without Clerk keys, the user-data routes are simply absent — check runtime config before assuming a route is missing due to a bug.
- **Auth boundary**: Route handlers must read the acting user only via `getAuthUserId` (from `@unimatrix/auth/server`, backed by a verified Clerk session) — never from client-supplied ids or body fields. Every route in `user-data` is gated by `requireAuth()` first and then reads the id through the module-local `getRequiredAuthUserId()` wrapper, which normalizes the defensive `null` case to a `401`; call that wrapper rather than `getAuthUserId()` directly in handler bodies.

## 4. Conventions
- **Naming**: Use `setup*`, `register*`, `load*`, and `build*` verbs for framework assembly helpers. Shared API types use `Api*` prefixes, and route modules export `*Module`.
- **Imports**: Use external packages first, then workspace packages like `@unimatrix/shared`, then relative imports. Relative ESM imports keep the explicit `.js` extension.
- **Structure**: Put reusable HTTP helpers under `src/lib/http`, cross-cutting Fastify bootstrapping under `src/plugins`, and feature routes under `src/modules/<feature>`.
- **Types**: Prefer explicit exported interfaces and type aliases such as `ApiRuntimeConfig`, `ApiErrorEnvelope`, and `HealthResponse` instead of inferred anonymous shapes at module boundaries.

## 5. Working Agreements
- Follow the shared repo working agreements in the root `AGENTS.md`; this file only adds `apps/api` structure, patterns, and conventions.
