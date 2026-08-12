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
/**
 * The server certificate and its private key, PEM text decoded from the
 * base64 the two environment variables carry. Base64 rather than raw PEM
 * because a deployment platform's environment editor is a single-line field
 * and a truncated key is a boot failure with a confusing message.
 *
 * The certificate is public — `apps/api` is configured with a copy of it.
 * The key is not, and is one of the credentials that can never live in the
 * store this service runs (`packages/secrets/AGENTS.md` §4).
 */
export interface SecretsTlsConfig {
  certificatePem: string;
  privateKeyPem: string;
}

export interface SecretsRuntimeConfigBase {
  host: string;
  port: number;
  nodeEnv: SecretsNodeEnv;
  logLevel: SecretsLogLevel;
  databaseFilePath: string;
  runDatabaseMigrations: boolean;
  /** `null` serves plain HTTP — which is what local dev and every test do. */
  tls: SecretsTlsConfig | null;
}

export interface SecretsRuntimeEnv {
  HOST?: string | undefined;
  PORT?: string | undefined;
  NODE_ENV?: string | undefined;
  LOG_LEVEL?: string | undefined;
  SECRETS_DATABASE_URL?: string | undefined;
  DB_MIGRATE_ON_START?: string | undefined;
  SECRETS_KEKS?: string | undefined;
  SECRETS_TLS_CERT_BASE64?: string | undefined;
  SECRETS_TLS_KEY_BASE64?: string | undefined;
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

/** As {@link readOptionalString}, but with no fallback: absent stays absent. */
function readOptionalTrimmedValue(
  variableName: keyof SecretsRuntimeEnv,
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
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
 * Decodes one base64-encoded PEM. The `-----BEGIN` check is what separates a
 * value that decoded into nonsense from one that did not decode at all:
 * `Buffer.from` ignores every character outside the base64 alphabet and
 * returns a short buffer rather than throwing, so without it a mangled paste
 * would reach Node's TLS layer as an opaque error at listen time.
 */
function parseBase64Pem(variableName: keyof SecretsRuntimeEnv, value: string): string {
  const pem = Buffer.from(value.trim(), "base64").toString("utf8");

  if (!pem.includes("-----BEGIN")) {
    throw createSecretsConfigError(
      `${variableName} must be a base64-encoded PEM document. The decoded value contains no "-----BEGIN" line.`,
    );
  }

  return pem;
}

/**
 * All-or-none, and neither is the supported case: local dev and every test
 * run this service over plain HTTP, so a missing pair must not be an error.
 * Exactly one set is always a mistake — a certificate with no key cannot
 * serve, and a key with no certificate would silently fall back to HTTP while
 * the operator believes TLS is on.
 */
function parseTlsConfig(env: SecretsRuntimeEnv): SecretsTlsConfig | null {
  const certificate = readOptionalTrimmedValue(
    "SECRETS_TLS_CERT_BASE64",
    env.SECRETS_TLS_CERT_BASE64,
  );
  const privateKey = readOptionalTrimmedValue("SECRETS_TLS_KEY_BASE64", env.SECRETS_TLS_KEY_BASE64);

  if (certificate === undefined && privateKey === undefined) {
    return null;
  }

  if (certificate === undefined || privateKey === undefined) {
    throw createSecretsConfigError(
      "SECRETS_TLS_CERT_BASE64 and SECRETS_TLS_KEY_BASE64 must be set together, or both left unset.",
    );
  }

  return {
    certificatePem: parseBase64Pem("SECRETS_TLS_CERT_BASE64", certificate),
    privateKeyPem: parseBase64Pem("SECRETS_TLS_KEY_BASE64", privateKey),
  };
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
    tls: parseTlsConfig(env),
  };
}
