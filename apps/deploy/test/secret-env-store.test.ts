import assert from "node:assert/strict";
import test from "node:test";

import {
  createSecretsClientFromEnv,
  loadSecretsPlatformReadToken,
} from "../src/secret-env/store.js";

const VALID_CERT_BASE64 = Buffer.from(
  "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
).toString("base64");

const HTTPS_ENV = {
  SECRETS_BASE_URL: "https://secrets:3001",
  SECRETS_PLATFORM_READ_TOKEN: "read_test_token",
  SECRETS_TLS_CERT_BASE64: VALID_CERT_BASE64,
};

void test("loadSecretsPlatformReadToken throws when the token is absent", () => {
  assert.throws(() => loadSecretsPlatformReadToken({}), /SECRETS_PLATFORM_READ_TOKEN must be set/);
});

void test("loadSecretsPlatformReadToken throws when the token is blank", () => {
  assert.throws(
    () => loadSecretsPlatformReadToken({ SECRETS_PLATFORM_READ_TOKEN: "   " }),
    /SECRETS_PLATFORM_READ_TOKEN must be set/,
  );
});

void test("loadSecretsPlatformReadToken trims and returns a set token", () => {
  assert.equal(loadSecretsPlatformReadToken({ SECRETS_PLATFORM_READ_TOKEN: " tok " }), "tok");
});

void test("createSecretsClientFromEnv throws with no SECRETS_BASE_URL", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        SECRETS_PLATFORM_READ_TOKEN: "tok",
        SECRETS_TLS_CERT_BASE64: VALID_CERT_BASE64,
      }),
    /SECRETS_BASE_URL must be set/,
  );
});

void test("createSecretsClientFromEnv throws on an invalid SECRETS_BASE_URL", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        ...HTTPS_ENV,
        SECRETS_BASE_URL: "not-a-url",
      }),
    /SECRETS_BASE_URL must be a valid URL/,
  );
});

void test("createSecretsClientFromEnv throws on a non-http(s) SECRETS_BASE_URL", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        ...HTTPS_ENV,
        SECRETS_BASE_URL: "ftp://secrets:3001",
      }),
    /must use http:\/\/ or https:\/\//,
  );
});

void test("createSecretsClientFromEnv throws with no SECRETS_PLATFORM_READ_TOKEN", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        SECRETS_BASE_URL: "https://secrets:3001",
        SECRETS_TLS_CERT_BASE64: VALID_CERT_BASE64,
      }),
    /SECRETS_PLATFORM_READ_TOKEN must be set/,
  );
});

void test("createSecretsClientFromEnv refuses https:// with no certificate", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        SECRETS_BASE_URL: "https://secrets:3001",
        SECRETS_PLATFORM_READ_TOKEN: "tok",
      }),
    /SECRETS_TLS_CERT_BASE64 must be set when SECRETS_BASE_URL is https/,
  );
});

void test("createSecretsClientFromEnv refuses http:// with a certificate present", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        SECRETS_BASE_URL: "http://secrets:3001",
        SECRETS_PLATFORM_READ_TOKEN: "tok",
        SECRETS_TLS_CERT_BASE64: VALID_CERT_BASE64,
      }),
    /SECRETS_TLS_CERT_BASE64 must not be set when SECRETS_BASE_URL is http/,
  );
});

void test("createSecretsClientFromEnv accepts http:// with no certificate", () => {
  const client = createSecretsClientFromEnv({
    SECRETS_BASE_URL: "http://secrets:3001",
    SECRETS_PLATFORM_READ_TOKEN: "tok",
  });

  assert.equal(typeof client.getSecretValue, "function");
});

void test("createSecretsClientFromEnv throws on a malformed base64 certificate", () => {
  assert.throws(
    () =>
      createSecretsClientFromEnv({
        ...HTTPS_ENV,
        SECRETS_TLS_CERT_BASE64: Buffer.from("not a pem at all").toString("base64"),
      }),
    /must be a base64-encoded PEM certificate/,
  );
});

void test("createSecretsClientFromEnv builds a client for a well-formed https:// config", () => {
  const client = createSecretsClientFromEnv(HTTPS_ENV);

  assert.equal(typeof client.getSecretValue, "function");
});
