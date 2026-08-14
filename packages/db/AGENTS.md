# AGENTS.md

## 1. Overview
`packages/db` is the persistence boundary: SQLite + Drizzle. §3a is the part that bites — the `better-sqlite3` version ceiling.

## 2. Folder Structure
- `src/config.ts`: database path resolution and runtime config helpers.
- `src/client.ts`: SQLite client creation, Drizzle database creation, and pragma setup.
- `src/schema`: schema tables and the schema barrel export.
- `src/migrate.ts`: `migrateDatabase` and `DEFAULT_MIGRATIONS_FOLDER` for idempotent startup migrations against the `drizzle` output directory.
- `src/index.ts`: package barrel for config, client, schema, and migration exports.
- `drizzle.config.ts`: Drizzle Kit configuration pointing at the schema barrel and migration output directory.
- `drizzle`: generated migration SQL and metadata.
- `local`: default local SQLite file location.

## 3. Core Behaviors & Patterns
- **Config-driven client creation**: `resolveDatabaseConfig(...)` shapes the database path, and `createSqliteClient(...)` plus `createDatabase(...)` build the raw SQLite and Drizzle clients from that config.
- **SQLite baseline setup**: Client creation ensures parent directories exist and enables `foreign_keys` plus `journal_mode = WAL` before the client is returned. New connection helpers should preserve that baseline behavior.
- **Schema barrel**: Tables live under `src/schema` and are re-exported through `src/schema/index.ts`. Drizzle config and client creation both point at that shared barrel, so new tables should be added there instead of importing individual files ad hoc.
- **Test posture**: Tests prefer `:memory:` databases or temporary filesystem paths, keeping persistence checks isolated from the default local database file.

## 3a. Do Not Upgrade better-sqlite3 To 13 Yet
`better-sqlite3` is pinned to the 12 line on purpose. **Upstream publishes no prebuilt binaries for 13** — checked 2026-07-27 against the GitHub releases: `v12.11.1` carries 138 prebuild assets, `v13.0.0` and `v13.0.1` carry zero. Without a prebuild, `prebuild-install` falls through to `node-gyp rebuild`, which needs Python and a C toolchain.

That is fine on a developer machine and fatal in `apps/api/Dockerfile`. The `node:*-alpine` base has neither, so the build dies at `pnpm install --frozen-lockfile` with `gyp ERR! find Python`. Verified by building the image, not inferred.

**CI catches this now.** The `Images (api)` matrix check builds `apps/api/Dockerfile` on every PR and is required on `main`, so a `better-sqlite3@13` bump goes red rather than green. Reject it until upstream ships prebuilds, or accept adding `python3` and `build-base` to the Dockerfile's build stage as a deliberate trade.

This also cuts the other way: 12.11.1 already publishes a `node-v137` prebuild, so it supports the pinned Node 24 fully. A local `NODE_MODULE_VERSION` mismatch means a stale `node_modules` built under a different Node, not missing support — reinstall rather than upgrade.

## 4. Conventions
- **Naming**: Use `create*` for client factories, `resolve*` for config helpers, and `*Table` suffixes for Drizzle table exports such as `systemSettingsTable`.
- **Schema style**: SQLite table names and column names stay snake_case at the database layer, while exported TypeScript types stay `PascalCase`.
- **Boundaries**: Keep route logic, UI concerns, and product-specific business workflows out of this package unless the persistence boundary is intentionally widened.
