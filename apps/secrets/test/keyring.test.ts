import assert from "node:assert/strict";
import test from "node:test";

import { loadSecretsRuntimeConfig } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;

void test("loadSecretsKeyringFromEnv loads a keyring from a well-formed SECRETS_KEKS", () => {
  const keyring = loadSecretsKeyringFromEnv({ SECRETS_KEKS: TEST_KEK });

  assert.equal(keyring.activeVersion, 1);
});

void test("loadSecretsKeyringFromEnv throws with no SECRETS_KEKS", () => {
  assert.throws(() => loadSecretsKeyringFromEnv({}));
});

void test("loadSecretsKeyringFromEnv throws on a malformed SECRETS_KEKS", () => {
  assert.throws(() => loadSecretsKeyringFromEnv({ SECRETS_KEKS: "not-a-kek" }));
});

void test("String(keyring) and inspecting it are redacted", () => {
  const keyring = loadSecretsKeyringFromEnv({ SECRETS_KEKS: TEST_KEK });

  assert.equal(String(keyring), "[REDACTED keyring]");
});

void test("JSON.stringify of the composed config (base + keyring) contains no key material", () => {
  const env = { SECRETS_KEKS: TEST_KEK };
  const config = { ...loadSecretsRuntimeConfig(env), keyring: loadSecretsKeyringFromEnv(env) };
  const serialized = JSON.stringify(config);

  assert.ok(!serialized.includes(TEST_KEK));
  assert.ok(!serialized.includes(TEST_KEK.split(":")[1] ?? ""));
  assert.ok(serialized.includes("REDACTED"));
});
