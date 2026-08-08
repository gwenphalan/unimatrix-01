import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { buildApp } from "../src/app.js";
import { loadSecretsRuntimeConfig, type SecretsRuntimeEnv } from "../src/config.js";
import { loadSecretsKeyringFromEnv } from "../src/keyring.js";
import { buildLoggerOptions } from "../src/lib/http/logging.js";

const TEST_KEK = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const PRESENTED_TOKEN = `usk_${"A".repeat(43)}`;

function createCapture(): { lines: string[]; stream: { write: (chunk: string) => void } } {
  const lines: string[] = [];

  return {
    lines,
    stream: {
      write: (chunk: string) => {
        lines.push(chunk);
      },
    },
  };
}

// `LOG_LEVEL: "warn"`, not the `"error"` the other suites use: the guard logs
// its rejections at warn, and a capture that is empty because the level
// filtered everything out cannot fail this test for any reason.
void test("a rejection is logged without any part of the token that caused it", async () => {
  const capture = createCapture();
  const env: SecretsRuntimeEnv = {
    LOG_LEVEL: "warn",
    NODE_ENV: "test",
    SECRETS_KEKS: TEST_KEK,
    SECRETS_DATABASE_URL: ":memory:",
    DB_MIGRATE_ON_START: "true",
  };

  const app = buildApp(
    { ...loadSecretsRuntimeConfig(env), keyring: loadSecretsKeyringFromEnv(env) },
    { loggerStream: capture.stream },
  );

  try {
    await app.ready();

    await app.inject({
      method: "GET",
      url: "/missing-route",
      headers: { authorization: `Bearer ${PRESENTED_TOKEN}` },
    });

    const output = capture.lines.join("");

    assert.ok(capture.lines.length > 0, "nothing was logged, so nothing was proven");
    assert.match(output, /"reason":"unknown_token"/u);
    assert.ok(!output.includes(PRESENTED_TOKEN), "the log echoed the presented token");
    assert.ok(!output.includes("Bearer"), "the log echoed the Authorization header");
  } finally {
    await app.close();
  }
});

/**
 * The redact block is a guard against a future `req` serializer, not something
 * doing work on the current path — measured on Fastify 5.10.0, the default one
 * emits `method`/`url`/`host`/`remoteAddress` and no headers at all, so a
 * bearer token never reaches the redactor. This exercises it through a
 * pass-through serializer, which is what makes the assertion able to fail.
 */
void test("the redact block censors an authorization header a serializer passes through", async () => {
  const capture = createCapture();
  const app = Fastify({
    logger: {
      ...buildLoggerOptions({ logLevel: "warn" }, { stream: capture.stream }),
      serializers: { req: (value: unknown) => value as Record<string, unknown> },
    },
  });

  try {
    await app.ready();

    app.log.warn({ req: { headers: { authorization: `Bearer ${PRESENTED_TOKEN}` } } }, "probe");

    const output = capture.lines.join("");

    assert.ok(capture.lines.length > 0, "nothing was logged, so nothing was proven");
    assert.match(output, /"authorization":"\[REDACTED\]"/u);
    assert.ok(!output.includes(PRESENTED_TOKEN), "the token survived redaction");
  } finally {
    await app.close();
  }
});
