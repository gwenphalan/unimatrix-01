import assert from "node:assert/strict";
import test from "node:test";

import {
  generateServiceToken,
  hashServiceToken,
  isServiceTokenShape,
} from "../src/service-tokens/index.js";

void test("generated tokens carry the prefix and 256 bits of base64url entropy", () => {
  const token = generateServiceToken();

  assert.ok(isServiceTokenShape(token), `generated token failed its own shape check: ${token}`);
  assert.equal(token.length, 47);
  assert.notEqual(token, generateServiceToken());
});

void test("the digest is deterministic, 64 hex characters, and distinct per token", () => {
  const token = generateServiceToken();
  const digest = hashServiceToken(token);

  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.equal(digest, hashServiceToken(token));
  assert.notEqual(digest, hashServiceToken(generateServiceToken()));
  assert.ok(!digest.includes(token.slice(4)), "the digest must not embed the token");
});

void test("the shape check rejects the wrong prefix, length, and alphabet", () => {
  const body = generateServiceToken().slice(4);

  assert.equal(isServiceTokenShape(`usk-${body}`), false);
  assert.equal(isServiceTokenShape(body), false);
  assert.equal(isServiceTokenShape(`usk_${body.slice(1)}`), false);
  assert.equal(isServiceTokenShape(`usk_${body}a`), false);
  assert.equal(isServiceTokenShape(`usk_${body.slice(1)}+`), false);
  assert.equal(isServiceTokenShape(""), false);
});
