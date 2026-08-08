# AGENTS.md

## 1. Overview
`apps/secrets` is the Fastify service backing the Unimatrix secrets store — sealed value storage
under a versioned KEK ring (`@unimatrix/secrets`). This item ships only `/health`; no route here may
ever serve a secret value, and even once the scoped read route lands it is the only one permitted to
return a decrypted value. See `.notes/01-todo/secrets.todo.md` for the constraint list and the later
items (auth, read/write routes, KEK rotation) this workspace does not yet implement.

## 2. Folder Structure
- `src/app.ts`: Fastify construction, `runtimeConfig`/`db` decoration, not-found handler.
- `src/server.ts`: process startup, signal handling, listen/shutdown. No `.env` file loading, unlike
  `apps/api/src/env.ts` — porting it would put a plaintext KEK on a developer's disk, the exact
  artifact this service exists to avoid multiplying. Local dev supplies `SECRETS_KEKS` on the command
  line; see `README.md`.
- `src/config.ts`: runtime config loading, hand-written parsers mirroring `apps/api/src/config.ts`.
  Deliberately imports no workspace package — `infra/scripts/validate-deploy-config.mjs` imports this
  module directly, before anything has been built, and a `@unimatrix/secrets` import here would
  resolve through its `dist` export map and fail closed in exactly that probe. It checks that
  `SECRETS_KEKS` is set but does not parse it or return it; see `src/keyring.ts`.
- `src/keyring.ts`: the one file allowed to import `@unimatrix/secrets`. Loads the `SecretsKeyring`
  from `SECRETS_KEKS` and defines the composed runtime config type (config.ts's shape plus the
  keyring) — never the raw string. `src/server.ts` composes the two loaders into one object before
  building the app; nothing here returns them pre-composed.
- `src/plugins`: `index.ts` wires only the Zod type-provider compilers and the database — no CORS, no
  rate limiting, no security headers, no request-id/observability plugin. This service has no browser
  caller and no public surface yet for any of that to protect; the auth item brings a rate-limit
  plugin with the routes that need one.
- `src/modules`: `health` only, registered by `index.ts`.
- `src/db`: this service's own Drizzle setup (`client.ts`, `migrate.ts`, `schema/`) — **never**
  `@unimatrix/db`. That package's SQLite volume is single-writer and already owned by the API
  container; see `packages/db/AGENTS.md` before proposing a shared database.

## 3. Core Behaviors & Patterns
- **The migrations-folder path depth is load-bearing.** `src/db/migrate.ts` resolves migrations at
  `../../drizzle` from its own `import.meta.url`. `rootDir: "src"` / `outDir: "dist"` in
  `tsconfig.build.json` put `src/db/migrate.ts` and `dist/db/migrate.js` at equal depth below the
  package root, so the same relative path reaches `apps/secrets/drizzle` in dev and `/app/drizzle` in
  the container. Moving `migrate.ts` up or down a directory breaks migration-on-start in production
  only — `tsx` running the TypeScript source directly would still happen to resolve.
- **Never write `@unimatrix/db` as a specifier in a comment under `src/`.**
  `infra/scripts/check-watch-paths.mjs` greps the raw text of every file under `src/` for
  `@unimatrix/*` with no import parsing, so a comment naming the package this service deliberately
  does not depend on would demand `packages/db/**` in the README watch-path block. Reference it as a
  path (`packages/db/src/client.ts`) instead.
- **No route may ever serve a secret value.** `/health` is the only route in this item.
- **The audit table (`secret_audit_log`) has no foreign keys, deliberately.** The client runs
  `foreign_keys = ON` (`src/db/client.ts`); an FK to `secrets(name)` with `onDelete: "cascade"` would
  erase the audit trail of exactly the deletion it exists to record.
- **`secret_versions.id` must never contain `.`.** It is `SecretContext.versionId`
  (`packages/secrets/src/envelope.ts`), and `assertValidContext` rejects a dot because it is the
  envelope's field separator — generate a UUID or ULID, never a composite `name.n`.
- **The KEK lives only in `SECRETS_KEKS`, and only as a `SecretsKeyring`.** It is below every value
  this service stores in the trust order; nothing this service depends on may ever be stored in this
  store.

## 4. Coverage Floor
Same ratchet policy as `apps/api/AGENTS.md` §2a — `node --test --experimental-test-coverage`, with
floors set a few points under the measured figure rather than at it, because V8 re-attributes
functions between Node majors. `test/module-graph.test.ts` imports every `src/` module and is what
keeps the denominator honest; read the comment in `apps/api/test/module-graph.test.ts` before changing
the mirrored version here.

## 5. Conventions
- Same naming (`setup*`/`register*`/`load*`/`build*`) and import ordering (external, then
  `@unimatrix/*`, then relative with an explicit `.js` extension) as `apps/api/AGENTS.md` §4.
- Never add `@unimatrix/db` as a dependency — see "Folder Structure" above.
