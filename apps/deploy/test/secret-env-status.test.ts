import assert from "node:assert/strict";
import test from "node:test";

import { SecretValue, SecretsClientError, type SecretsClient } from "@unimatrix/secrets/client";

import { resolveSecretEnvStatus } from "../src/secret-env/status.js";

function stubClient(byName: Readonly<Record<string, SecretValue | Error>>): SecretsClient {
  return {
    getSecretValue: (name) => {
      const outcome = byName[name];

      if (outcome === undefined) {
        return Promise.reject(new Error(`unexpected getSecretValue(${name})`));
      }

      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
}

void test("refuses this service's own compose entry before any network call", async () => {
  let called = false;
  const client = stubClient({});
  client.getSecretValue = () => {
    called = true;
    return Promise.reject(new Error("should not be called"));
  };

  const status = await resolveSecretEnvStatus(client, "deploy");

  assert.deepEqual(status, { outcome: "refused-self", appDir: "deploy" });
  assert.equal(called, false);
});

void test("refuses an app absent from the manifest before any network call", async () => {
  let called = false;
  const client = stubClient({});
  client.getSecretValue = () => {
    called = true;
    return Promise.reject(new Error("should not be called"));
  };

  const status = await resolveSecretEnvStatus(client, "does-not-exist");

  assert.deepEqual(status, { outcome: "unknown-app", appDir: "does-not-exist" });
  assert.equal(called, false);
});

void test("reports no-declarations for a declared app with no secrets-store values", async () => {
  const client = stubClient({});

  const status = await resolveSecretEnvStatus(client, "web");

  assert.deepEqual(status, { outcome: "no-declarations", appDir: "web" });
});

void test("resolves the outcome matrix: resolved, unresolved, and error", async () => {
  const client = stubClient({
    "platform/clerk-jwt-key": new SecretValue(
      "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
    ),
    "platform/clerk-publishable-key": new SecretsClientError("not found", { status: 404 }),
    "platform/clerk-secret-key": new Error("network down"),
  });

  const status = await resolveSecretEnvStatus(client, "api");

  assert.equal(status.outcome, "results");
  if (status.outcome !== "results") return;

  const byName = new Map(status.results.map((result) => [result.name, result]));

  const jwt = byName.get("CLERK_JWT_KEY");
  assert.equal(jwt?.outcome, "resolved");
  assert.equal(jwt && jwt.outcome === "resolved" ? jwt.singleLine : undefined, false);

  const publishable = byName.get("CLERK_PUBLISHABLE_KEY");
  assert.equal(publishable?.outcome, "unresolved");

  const secret = byName.get("CLERK_SECRET_KEY");
  assert.equal(secret?.outcome, "error");
});

void test("reports singleLine=true for a resolved value with no newline", async () => {
  const client = stubClient({
    "platform/clerk-jwt-key": new SecretValue("one-line-value"),
    "platform/clerk-publishable-key": new SecretValue("also-one-line"),
    "platform/clerk-secret-key": new SecretValue("also-one-line-too"),
  });

  const status = await resolveSecretEnvStatus(client, "api");

  assert.equal(status.outcome, "results");
  if (status.outcome !== "results") return;

  assert.ok(status.results.every((result) => result.outcome === "resolved" && result.singleLine));
});

// Load-bearing: proves no outcome variant this module can produce ever carries a fragment of a
// resolved value. The resolved branch never calls `.reveal()` on anything but the value it derives
// `singleLine` from and discards; the unresolved branch's message is a fixed string, never
// `SecretsClientError#message`, even though that message is itself store-content-free by that
// class's own rule — so a fixture planted there proves this module does not read it at all. The
// fixture string is deliberately distinctive so a false negative is not plausible.
const FIXTURE_SECRET = "fixture-plaintext-zzyzx-9f3c2a";

void test("no outcome variant carries a fragment of a resolved value", async () => {
  const client = stubClient({
    "platform/clerk-jwt-key": new SecretValue(FIXTURE_SECRET),
    "platform/clerk-publishable-key": new SecretsClientError(`not found: ${FIXTURE_SECRET}`, {
      status: 404,
    }),
    "platform/clerk-secret-key": new Error("network down"),
  });

  const status = await resolveSecretEnvStatus(client, "api");
  const serialized = JSON.stringify(status);

  assert.equal(serialized.includes(FIXTURE_SECRET), false);
});

void test("a SecretsClientError with a null status is an error, not unresolved", async () => {
  const client = stubClient({
    "platform/clerk-jwt-key": new SecretsClientError("aborted", { status: null }),
    "platform/clerk-publishable-key": new SecretValue("value"),
    "platform/clerk-secret-key": new SecretValue("value"),
  });

  const status = await resolveSecretEnvStatus(client, "api");

  assert.equal(status.outcome, "results");
  if (status.outcome !== "results") return;

  const jwt = status.results.find((result) => result.name === "CLERK_JWT_KEY");
  assert.equal(jwt?.outcome, "error");
});

// Only a 404 carries the absent/out-of-scope/wrong-capability ambiguity that `unresolved` describes.
// A 401 is the shape this most has to get right: a wrong token fails every name at once, and
// reporting three unresolved names sends an operator to look at the store's contents when the fault
// is the credential. Exit 4, not exit 3.
void test("a non-404 store status is an error, not unresolved", async () => {
  for (const status of [401, 403, 429, 500]) {
    const client = stubClient({
      "platform/clerk-jwt-key": new SecretsClientError("refused", { status }),
      "platform/clerk-publishable-key": new SecretValue("value"),
      "platform/clerk-secret-key": new SecretValue("value"),
    });

    const result = await resolveSecretEnvStatus(client, "api");

    assert.equal(result.outcome, "results");
    if (result.outcome !== "results") continue;

    const jwt = result.results.find((entry) => entry.name === "CLERK_JWT_KEY");
    assert.equal(jwt?.outcome, "error", `status ${String(status)} should be an error`);
  }
});
