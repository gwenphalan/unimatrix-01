import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema/index.js";

// Structurally mirrors packages/db/src/client.ts (directory creation, the same
// two PRAGMAs, then drizzle()) rather than depending on it — this service's
// SQLite file lives on its own volume, never packages/db's, which is
// single-writer and already owned by the API container.
export interface SecretsDatabaseInstance {
  filePath: string;
  client: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function createSecretsDatabase(options: { filePath: string }): SecretsDatabaseInstance {
  const { filePath } = options;

  mkdirSync(dirname(filePath), { recursive: true });

  const client = new BetterSqlite3(filePath);

  client.pragma("foreign_keys = ON");
  client.pragma("journal_mode = WAL");

  const db = drizzle({ client, schema });

  return { filePath, client, db };
}
