import assert from "node:assert/strict";
import test from "node:test";

import { loadSecretsRuntimeConfig } from "../src/config.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

void test("loadSecretsRuntimeConfig uses documented defaults", () => {
  const config = loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK });

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3002);
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.logLevel, "debug");
  assert.equal(config.runDatabaseMigrations, false);
  assert.ok(config.databaseFilePath.endsWith("apps/secrets/local/secrets.sqlite"));
});

void test("loadSecretsRuntimeConfig trims and validates explicit values", () => {
  const config = loadSecretsRuntimeConfig({
    HOST: " 0.0.0.0 ",
    LOG_LEVEL: " warn ",
    NODE_ENV: "production",
    PORT: "4000",
    SECRETS_DATABASE_URL: " /data/secrets.sqlite ",
    DB_MIGRATE_ON_START: " true ",
    SECRETS_KEKS: TEST_KEK,
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.logLevel, "warn");
  assert.equal(config.port, 4000);
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.databaseFilePath, "/data/secrets.sqlite");
  assert.equal(config.runDatabaseMigrations, true);
});

void test("loadSecretsRuntimeConfig defaults LOG_LEVEL to info outside development", () => {
  assert.equal(
    loadSecretsRuntimeConfig({ NODE_ENV: "test", SECRETS_KEKS: TEST_KEK }).logLevel,
    "info",
  );
});

void test("loadSecretsRuntimeConfig throws with no SECRETS_KEKS", () => {
  assert.throws(() => loadSecretsRuntimeConfig({}), /SECRETS_KEKS must be set/);
});

void test("loadSecretsRuntimeConfig throws with a blank SECRETS_KEKS", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: "   " }),
    /SECRETS_KEKS must be set/,
  );
});

// A malformed-but-present SECRETS_KEKS (e.g. "not-a-kek") is not this loader's concern — it only
// checks presence, so the compose file's env var is caught even before a build exists. The format
// itself is validated by `loadSecretsKeyringFromEnv`; see test/keyring.test.ts.

void test("loadSecretsRuntimeConfig rejects invalid PORT values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, PORT: "0" }),
    /PORT must be an integer between 1 and 65535/,
  );
});

void test("loadSecretsRuntimeConfig rejects blank PORT values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, PORT: "   " }),
    /PORT must not be empty when it is set/,
  );
});

void test("loadSecretsRuntimeConfig rejects unsupported NODE_ENV values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, NODE_ENV: "staging" }),
    /NODE_ENV must be one of development, test, production/,
  );
});

void test("loadSecretsRuntimeConfig rejects unsupported LOG_LEVEL values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, LOG_LEVEL: "trace" }),
    /LOG_LEVEL must be one of debug, info, warn, error/,
  );
});

void test("loadSecretsRuntimeConfig rejects blank LOG_LEVEL values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, LOG_LEVEL: "   " }),
    /LOG_LEVEL must not be empty when it is set/,
  );
});

void test("loadSecretsRuntimeConfig rejects blank HOST values", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, HOST: "   " }),
    /HOST must not be empty when it is set/,
  );
});

void test("loadSecretsRuntimeConfig rejects a blank SECRETS_DATABASE_URL", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, SECRETS_DATABASE_URL: "   " }),
    /SECRETS_DATABASE_URL must not be empty when it is set/,
  );
});

void test("loadSecretsRuntimeConfig parses DB_MIGRATE_ON_START truthy/falsy values", () => {
  assert.equal(
    loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: "true" })
      .runDatabaseMigrations,
    true,
  );
  assert.equal(
    loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: " 1 " })
      .runDatabaseMigrations,
    true,
  );
  assert.equal(
    loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: "false" })
      .runDatabaseMigrations,
    false,
  );
  assert.equal(
    loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: "0" })
      .runDatabaseMigrations,
    false,
  );
});

void test("loadSecretsRuntimeConfig rejects an invalid DB_MIGRATE_ON_START", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: "yes" }),
    /DB_MIGRATE_ON_START must be one of true, 1, false, 0/,
  );
});

void test("loadSecretsRuntimeConfig rejects a blank DB_MIGRATE_ON_START", () => {
  assert.throws(
    () => loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, DB_MIGRATE_ON_START: "   " }),
    /DB_MIGRATE_ON_START must not be empty when it is set/,
  );
});

const TEST_CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const TEST_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n";
const TEST_CERT_BASE64 = Buffer.from(TEST_CERT_PEM).toString("base64");
const TEST_KEY_BASE64 = Buffer.from(TEST_KEY_PEM).toString("base64");

void test("loadSecretsRuntimeConfig leaves tls null when neither TLS variable is set", () => {
  assert.equal(loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK }).tls, null);
});

void test("loadSecretsRuntimeConfig decodes both TLS variables into PEM text", () => {
  assert.deepEqual(
    loadSecretsRuntimeConfig({
      SECRETS_KEKS: TEST_KEK,
      SECRETS_TLS_CERT_BASE64: TEST_CERT_BASE64,
      SECRETS_TLS_KEY_BASE64: TEST_KEY_BASE64,
    }).tls,
    { certificatePem: TEST_CERT_PEM, privateKeyPem: TEST_KEY_PEM },
  );
});

void test("loadSecretsRuntimeConfig rejects exactly one TLS variable, either way round", () => {
  assert.throws(
    () =>
      loadSecretsRuntimeConfig({
        SECRETS_KEKS: TEST_KEK,
        SECRETS_TLS_CERT_BASE64: TEST_CERT_BASE64,
      }),
    /must be set together, or both left unset/,
  );
  assert.throws(
    () =>
      loadSecretsRuntimeConfig({ SECRETS_KEKS: TEST_KEK, SECRETS_TLS_KEY_BASE64: TEST_KEY_BASE64 }),
    /must be set together, or both left unset/,
  );
});

void test("loadSecretsRuntimeConfig rejects a TLS value that does not decode to PEM", () => {
  assert.throws(
    () =>
      loadSecretsRuntimeConfig({
        SECRETS_KEKS: TEST_KEK,
        SECRETS_TLS_CERT_BASE64: Buffer.from("not a certificate").toString("base64"),
        SECRETS_TLS_KEY_BASE64: TEST_KEY_BASE64,
      }),
    /SECRETS_TLS_CERT_BASE64 must be a base64-encoded PEM document/,
  );
});

// The composed-config redaction assertion (base config + keyring, as src/server.ts builds it) lives
// in test/keyring.test.ts, since composing them is what src/keyring.ts's exports are for.
