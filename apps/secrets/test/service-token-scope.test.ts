import assert from "node:assert/strict";
import test from "node:test";

import { scopeCoversName } from "../src/service-tokens/index.js";

void test("a scope covers itself and everything under a segment boundary", () => {
  assert.equal(scopeCoversName("github", "github"), true);
  assert.equal(scopeCoversName("github", "github/api-token"), true);
  assert.equal(scopeCoversName("a/b", "a/b/c"), true);
});

// The bug this rules out reads as a typo: a raw `startsWith` would hand a token
// scoped to `github` every secret under `githubx`.
void test("a scope does not cover a name that merely starts with it", () => {
  assert.equal(scopeCoversName("github", "githubx"), false);
  assert.equal(scopeCoversName("github", "githubx/token"), false);
  assert.equal(scopeCoversName("a/b", "a/bc"), false);
  assert.equal(scopeCoversName("github/api-token", "github"), false);
});
