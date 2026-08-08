import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { SecretsDatabaseInstance } from "./client.js";

/**
 * Location of the checked-in Drizzle migration files. This depth is
 * load-bearing: `tsconfig.build.json` sets `rootDir: "src"` / `outDir: "dist"`,
 * so this file and its built counterpart sit at equal depth below the package
 * root (`src/db/migrate.ts`, `dist/db/migrate.js`) and the same `"../../drizzle"`
 * resolves to `apps/secrets/drizzle` in dev and to `/app/drizzle` in the
 * production container. Moving this file up or down a directory breaks
 * migration-on-start in production only — `tsx` running the TypeScript source
 * directly would still happen to resolve.
 */
export const DEFAULT_SECRETS_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export interface MigrateSecretsDatabaseOptions {
  /** Override the migrations directory (defaults to {@link DEFAULT_SECRETS_MIGRATIONS_FOLDER}). */
  migrationsFolder?: string;
}

/**
 * Applies any pending Drizzle migrations to `instance`. Idempotent — Drizzle
 * records applied migrations in the database, so this is a no-op once the
 * schema is up to date, making it safe to call on every startup (for example
 * a container boot backed by a persistent volume).
 */
export function migrateSecretsDatabase(
  instance: Pick<SecretsDatabaseInstance, "db">,
  options: MigrateSecretsDatabaseOptions = {},
): void {
  migrate(instance.db, {
    migrationsFolder: options.migrationsFolder ?? DEFAULT_SECRETS_MIGRATIONS_FOLDER,
  });
}
