import type { FastifyInstance } from "fastify";

import { createSecretsDatabase } from "../db/client.js";
import { migrateSecretsDatabase } from "../db/migrate.js";

/**
 * Structurally mirrors apps/api/src/plugins/database.ts, but opens this
 * service's own SQLite file (`app.runtimeConfig.databaseFilePath`) through
 * `../db/client.ts` rather than through packages/db — this service never
 * depends on that package; see apps/secrets/AGENTS.md.
 *
 * Migrations are applied out-of-band by default (`pnpm db:migrate`). Set
 * `DB_MIGRATE_ON_START=true` (`runDatabaseMigrations`) to apply any pending
 * migrations here at startup instead — idempotent, so a no-op once the schema
 * is current.
 */
export function setupDatabase(app: FastifyInstance): void {
  const instance = createSecretsDatabase({ filePath: app.runtimeConfig.databaseFilePath });

  if (app.runtimeConfig.runDatabaseMigrations) {
    migrateSecretsDatabase(instance);
    app.log.info("Applied database migrations at startup (DB_MIGRATE_ON_START).");
  }

  app.decorate("db", instance.db);

  app.addHook("onClose", () => {
    instance.client.close();
  });
}
