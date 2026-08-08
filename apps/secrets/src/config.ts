import { fileURLToPath } from "node:url";

export const SECRETS_NODE_ENVS = ["development", "test", "production"] as const;
export const SECRETS_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type SecretsNodeEnv = (typeof SECRETS_NODE_ENVS)[number];
export type SecretsLogLevel = (typeof SECRETS_LOG_LEVELS)[number];

/**
 * Everything about this service's runtime configuration except the keyring. Deliberately excludes
 * it, and deliberately imports no workspace package: `infra/scripts/validate-deploy-config.mjs`
 * imports this module directly, before anything has been built, and `@unimatrix/secrets`'s exports
 * map points at `dist` — see `src/keyring.ts` for where the keyring (and the import) actually live.
 */
export interface SecretsRuntimeConfigBase {
  host: string;
  port: number;
  nodeEnv: SecretsNodeEnv;
  logLevel: SecretsLogLevel;
  databaseFilePath: string;
  runDatabaseMigrations: boolean;
}

export interface SecretsRuntimeEnv {
  HOST?: string | undefined;
  PORT?: string | undefined;
  NODE_ENV?: string | undefined;
  LOG_LEVEL?: string | undefined;
  SECRETS_DATABASE_URL?: string | undefined;
  DB_MIGRATE_ON_START?: string | undefined;
  SECRETS_KEKS?: string | undefined;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_NODE_ENV: SecretsNodeEnv = "development";
// 3001 is apps/api's; a distinct default keeps `pnpm dev` off its port.
const DEFAULT_PORT = 3002;
const PACKAGE_ROOT_URL = new URL("../", import.meta.url);
export const DEFAULT_SECRETS_DATABASE_FILE_PATH = fileURLToPath(
  new URL("./local/secrets.sqlite", PACKAGE_ROOT_URL),
);

function createSecretsConfigError(message: string): Error {
  return new Error(`Invalid secrets service runtime configuration: ${message}`);
}

function readOptionalString(
  variableName: keyof SecretsRuntimeEnv,
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createSecretsConfigError(`${variableName} must not be empty when it is set.`);
  }

  return trimmedValue;
}

function isSecretsNodeEnv(value: string): value is SecretsNodeEnv {
  return SECRETS_NODE_ENVS.includes(value as SecretsNodeEnv);
}

function isSecretsLogLevel(value: string): value is SecretsLogLevel {
  return SECRETS_LOG_LEVELS.includes(value as SecretsLogLevel);
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createSecretsConfigError("PORT must not be empty when it is set.");
  }

  if (!/^[0-9]+$/u.test(trimmedValue)) {
    throw createSecretsConfigError(
      `PORT must be an integer between 1 and 65535. Received ${JSON.stringify(trimmedValue)}.`,
    );
  }

  const port = Number(trimmedValue);

  if (port < 1 || port > 65535) {
    throw createSecretsConfigError(
      `PORT must be an integer between 1 and 65535. Received ${JSON.stringify(trimmedValue)}.`,
    );
  }

  return port;
}

function parseNodeEnv(value: string | undefined): SecretsNodeEnv {
  const nodeEnv = readOptionalString("NODE_ENV", value, DEFAULT_NODE_ENV);

  if (!isSecretsNodeEnv(nodeEnv)) {
    throw createSecretsConfigError(
      `NODE_ENV must be one of ${SECRETS_NODE_ENVS.join(", ")}. Received ${JSON.stringify(nodeEnv)}.`,
    );
  }

  return nodeEnv;
}

function defaultLogLevelForNodeEnv(nodeEnv: SecretsNodeEnv): SecretsLogLevel {
  return nodeEnv === "development" ? "debug" : "info";
}

function parseLogLevel(value: string | undefined, nodeEnv: SecretsNodeEnv): SecretsLogLevel {
  if (value === undefined) {
    return defaultLogLevelForNodeEnv(nodeEnv);
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createSecretsConfigError("LOG_LEVEL must not be empty when it is set.");
  }

  if (!isSecretsLogLevel(trimmedValue)) {
    throw createSecretsConfigError(
      `LOG_LEVEL must be one of ${SECRETS_LOG_LEVELS.join(", ")}. Received ${JSON.stringify(trimmedValue)}.`,
    );
  }

  return trimmedValue;
}

function parseRunDatabaseMigrations(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createSecretsConfigError("DB_MIGRATE_ON_START must not be empty when it is set.");
  }

  if (trimmedValue === "true" || trimmedValue === "1") {
    return true;
  }

  if (trimmedValue === "false" || trimmedValue === "0") {
    return false;
  }

  throw createSecretsConfigError(
    `DB_MIGRATE_ON_START must be one of true, 1, false, 0. Received ${JSON.stringify(trimmedValue)}.`,
  );
}

function parseDatabaseFilePath(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_SECRETS_DATABASE_FILE_PATH;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createSecretsConfigError("SECRETS_DATABASE_URL must not be empty when it is set.");
  }

  return trimmedValue;
}

/**
 * A presence-and-non-empty check only — the KEK format itself is validated by
 * `loadSecretsKeyringFromEnv` (`src/keyring.ts`), which this module cannot import (see
 * {@link SecretsRuntimeConfigBase}). Kept here anyway so a compose file that forgot to name the
 * variable still fails `validate-deploy-config.mjs`'s probe of this module, not just a live boot.
 */
function assertSecretsKeksIsSet(value: string | undefined): void {
  if (value === undefined || value.trim().length === 0) {
    throw createSecretsConfigError("SECRETS_KEKS must be set.");
  }
}

/**
 * The database file path alone, with no keyring requirement. `drizzle.config.ts`
 * calls this directly (never {@link loadSecretsRuntimeConfig}) so that
 * `db:generate`/`db:migrate` work without `SECRETS_KEKS` ever being set.
 */
export function resolveSecretsDatabaseFilePath(env: SecretsRuntimeEnv = process.env): string {
  return parseDatabaseFilePath(env.SECRETS_DATABASE_URL);
}

/**
 * Fails loud with no `SECRETS_KEKS` — the same fail-loud shape as `loadApiRuntimeConfig`
 * (`apps/api/src/config.ts`) failing loud with no Clerk keys in production. This function only
 * checks that the variable is set (see {@link assertSecretsKeksIsSet}); it does not parse or return
 * it. The caller — `src/server.ts` — composes this with `loadSecretsKeyringFromEnv`
 * (`src/keyring.ts`) into the full runtime config before building the app.
 */
export function loadSecretsRuntimeConfig(
  env: SecretsRuntimeEnv = process.env,
): SecretsRuntimeConfigBase {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  assertSecretsKeksIsSet(env.SECRETS_KEKS);

  return {
    host: readOptionalString("HOST", env.HOST, DEFAULT_HOST),
    port: parsePort(env.PORT),
    nodeEnv,
    logLevel: parseLogLevel(env.LOG_LEVEL, nodeEnv),
    databaseFilePath: resolveSecretsDatabaseFilePath(env),
    runDatabaseMigrations: parseRunDatabaseMigrations(env.DB_MIGRATE_ON_START),
  };
}
