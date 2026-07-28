import assert from "node:assert/strict";
import test from "node:test";

import {
  INLINE_SAFE_CONTENT_TYPES,
  isInlineSafeContentType,
  resolveContentDisposition,
} from "../src/lib/http/content-types.js";

/**
 * These two helpers decide whether attacker-supplied bytes are rendered by
 * the browser or downloaded, on both the user-file and content-asset routes.
 * The allowlist is asserted by value rather than by "contains an image type",
 * so widening it to something scriptable is a deliberate, visible edit.
 */
void test("only raster image types are inline-safe", () => {
  assert.deepEqual([...INLINE_SAFE_CONTENT_TYPES].sort(), [
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  for (const contentType of INLINE_SAFE_CONTENT_TYPES) {
    assert.equal(isInlineSafeContentType(contentType), true, contentType);
    assert.equal(resolveContentDisposition(contentType), "inline", contentType);
  }
});

void test("scriptable and unknown types are forced to download", () => {
  for (const contentType of [
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "application/pdf",
    "",
  ]) {
    assert.equal(isInlineSafeContentType(contentType), false, contentType);
    assert.equal(resolveContentDisposition(contentType), "attachment", contentType);
  }
});

void test("the allowlist check is case-insensitive", () => {
  // Browsers treat the Content-Type token case-insensitively, so an uppercase
  // upload header must not be able to route around the allowlist in either
  // direction — neither by escaping `inline` nor by matching a lowercase-only
  // comparison against a scriptable type.
  assert.equal(isInlineSafeContentType("IMAGE/PNG"), true);
  assert.equal(resolveContentDisposition("Image/Png"), "inline");
  assert.equal(resolveContentDisposition("TEXT/HTML"), "attachment");
});
