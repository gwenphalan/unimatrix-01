# AGENTS.md

## 1. Overview
`apps/secrets` is the Fastify service backing the Unimatrix secrets store — sealed value storage
under a versioned KEK ring (`@unimatrix/secrets`). `/health` is the only URL answerable without a
bearer service token: an unauthenticated request to anything else is a 401, including a URL
matching no route, and only an authenticated one gets a 404 for an unmatched URL.

Five routes sit behind that guard, split by the caller's token capability — `read`, `write`, or
`manage` (`src/service-tokens/capability.ts`). `GET /secrets/value` needs `read` and is the
**only** route anywhere in this service permitted to return a decrypted value. `POST /secrets`,
`POST /secrets/rotate` and `GET /secrets` accept `write` or `manage`; `DELETE /secrets` accepts
`manage` alone — `write` may create and rotate but never delete. All four return metadata — a
masked prefix, never a value. There is no read-back route reachable by a `write` or `manage` token
and no debug flag that adds one. The host-local `secret read` CLI (`src/cli/secret.ts`) can still
print a value — that is not a bypass of this rule: it needs host access in addition to a service
token's worth of KEK material, and it writes the same `secret.read` audit row the route does.

Transport is a bearer token over plain HTTP. TLS with a pinned self-signed server
certificate is the decided follow-up, landing with the PR that gives the two stacks a shared network
and a live service token — not an omission. `apps/api` already carries the client and the boot-time
cache as of this PR, but the two stacks share no network yet, so that PR has not happened.

## 2. Folder Structure
- `src/app.ts`: Fastify construction, `runtimeConfig`/`db` decoration, the error handler, and the
  rate-limited not-found handler.
- `src/server.ts`: process startup, signal handling, listen/shutdown. No `.env` file loading, unlike
  `apps/api/src/env.ts` — porting it would put a plaintext KEK on a developer's disk, the exact
  artifact this service exists to avoid multiplying. Local dev supplies `SECRETS_KEKS` on the command
  line; see `README.md`.
- `src/config.ts`: runtime config loading, hand-written parsers mirroring `apps/api/src/config.ts`.
  Deliberately imports no workspace package — `infra/scripts/validate-deploy-config.mjs` imports this
  module directly, before anything has been built, and a `@unimatrix/secrets` import here would
  resolve through its `dist` export map and fail closed in exactly that probe. It checks that
  `SECRETS_KEKS` is set but does not parse it or return it; see `src/keyring.ts`.
- `src/keyring.ts`: the one file under `src/` allowed to import `@unimatrix/secrets`. Loads the `SecretsKeyring`
  from `SECRETS_KEKS` and defines the composed runtime config type (config.ts's shape plus the
  keyring) — never the raw string. `src/server.ts` composes the two loaders into one object before
  building the app; nothing here returns them pre-composed.
- `src/plugins`: `index.ts` wires the Zod type-provider compilers, the database, the rate limiter and
  the service-token guard — no CORS, no security headers, no request-id/observability plugin. This
  service has no browser caller for any of those to serve.
- `src/service-tokens`: token generation and hashing (`format.ts`), the `read`/`write`/`manage`
  capability (`capability.ts`), segment-boundary prefix matching (`scope.ts`), and the
  Drizzle-backed store.
- `src/audit`: the append-only writer for `secret_audit_log`. One export, and that is the property —
  SQLite cannot make a table append-only, so nothing here may gain an update or delete.
- `src/cli/service-token.ts`: host-local token issuance, revocation and listing. Under `src/` rather
  than `scripts/` because `tsconfig.build.json` excludes `scripts/` and the image ships built output
  with no `tsx`, so a CLI there could not run in the container.
- `src/cli/kek.ts`: host-local `verify`, `rotate` and `generate` for the KEK ring. `verify` censuses
  `secret_versions` and proves every row opens under a key the ring carries; `rotate` re-seals every
  row under the active version; `generate` prints one new `<version>:<key>` entry and never the
  existing ring. No `export` subcommand — see §3.
- `src/cli/secret.ts`: host-local `read --name <name>`, the one CLI permitted to print a decrypted
  value — see §1.
- `src/cli/support.ts`: `parseFlags`/`requireFlag`/`writeAtomically`, shared by all three CLIs above.
- `src/lib/http`: the error envelope and its normalizer, and the logger options. Mirrors
  `apps/api/src/lib/http` at a fraction of the size — no `requestId` in the body and no
  validation-issue detail, because there is no browser client to consume either.
- `src/modules`: `health` and `secrets` (the five routes described in §1), registered by `index.ts`.
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
- **The scoped read route is the one exception to "no route here may serve a secret value"** — see
  §1. Every denial the five routes throw (wrong capability, out-of-scope name, absent name) goes
  through one `denySecretAccess` construction site in `src/modules/secrets/index.ts` and comes back
  byte-identical, headers included, so nothing distinguishes "you can't" from "it isn't there".
- **Rotation supersedes the live `secret_versions` row before inserting the new one.** Inserting
  first would put two live rows on the same name at once, and the partial unique index
  (`secret_versions_live_unique`) would roll the whole transaction back instead of the rotation
  landing.
- **`PUBLIC_ROUTE_URLS` is the entire allowlist, and a URL matching no route is not on it.** Denying
  unmatched URLs is the point, not an oversight to patch: being able to open a socket to this
  service proves nothing about who is calling. Never exempt them.
- **Three hook placements are load-bearing and none of them is visible from a diff.** The guard runs
  at `preValidation`, because `@fastify/rate-limit` attaches route-level hooks and those always run
  after instance-level ones of the same type — an `onRequest` guard would be unreachable by the
  limiter. The not-found handler carries its own limiter at `onRequest` inside `app.after()`, because
  `setNotFoundHandler` fires no `onRoute` event and so the global ceiling never reaches unmatched
  URLs at all; at `preValidation` or `preHandler` the guard runs first and the ceiling never fires.
  And a test route must be registered through `app.register`, never on the root instance after
  `buildApp()` — `onRoute` runs synchronously at `route()` time while the plugin boots through avvio,
  so a root-scope route silently gets no limit. `test/rate-limit.test.ts` pins all three.
- **A test that needs a valid token needs `DB_MIGRATE_ON_START: "true"` in its env.** The default is
  false, so `service_tokens` does not exist and every lookup is a 500 rather than an auth result.
- **A route-level hook must return a `Promise` or call the `done` argument it declares.** Fastify's
  hook runner only advances past a hook that does one of those two things; a plain synchronous
  function returning `undefined` satisfies neither, and the request hangs with no error at all
  (measured — every route behind `requireCapability` in `src/modules/secrets/index.ts` stalled
  silently until it returned a `Promise`).
- **A database fault inside the guard is a 500, never a 401.** A broken schema reported as a bad
  credential sends the caller hunting for a token that is fine.
- **The audit table (`secret_audit_log`) has no foreign keys, deliberately.** The client runs
  `foreign_keys = ON` (`src/db/client.ts`); an FK to `secrets(name)` with `onDelete: "cascade"` would
  erase the audit trail of exactly the deletion it exists to record.
- **Create, rotate and delete accept an optional `actorUserId` and land it on the audit row they
  write.** It is an assertion by the authenticated service-token caller, not a fact this service
  verifies, and it feeds no authorization decision anywhere in `src/modules/secrets/index.ts` —
  every guard still reads only the verified token
  (`test/secrets-routes.test.ts`'s structural guard pins this). Omitting it lands `null`, which is
  why every existing caller, including the host-local CLIs, keeps working unchanged.
- **A duplicate name on create is a 409 `CONFLICT`, not a 400.** A zod body-validation failure is
  also a 400 with code `VALIDATION_ERROR`, and `SecretsClientError` (`packages/secrets/src/client.ts`)
  carries only `status` — a 400 here would be indistinguishable from a malformed request by status
  alone.
- **`secret_versions.id` must never contain `.`.** It is `SecretContext.versionId`
  (`packages/secrets/src/envelope.ts`), and `assertValidContext` rejects a dot because it is the
  envelope's field separator — generate a UUID or ULID, never a composite `name.n`.
- **The KEK lives only in `SECRETS_KEKS`, and only as a `SecretsKeyring`.** It is below every value
  this service stores in the trust order; nothing this service depends on may ever be stored in this
  store.
- **`kek rotate` re-seals a row in place, keeping `secret_versions.id`.** The envelope's AAD binds
  `versionId` (`packages/secrets/src/envelope.ts`), so a fresh id on re-seal would produce an
  envelope that cannot open against its own row — silently, until someone reads it.
- **No CLI under `src/cli/` may take a `--kek` flag, on any subcommand.** Argv is world-readable on
  the host running the container, and `docker exec` already inherits `SECRETS_KEKS`; a flag would
  only add a second, worse way to hand over the same key.
- **A retired KEK version stays in `SECRETS_KEKS` until `kek verify` reports zero rows outside the
  active version.** Removing it earlier stops future writes and reads working, then makes the rows
  still sealed under it unrecoverable — see `docs/deployment.md`'s rotation runbook.

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
