/**
 * Content types safe to serve `inline` from an app origin. Deliberately
 * raster images only — HTML and SVG can carry script, so they (and anything
 * else) are served as downloads instead.
 */
export const INLINE_SAFE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Whether a stored content type may be rendered `inline` by the browser.
 * Stored content types are attacker-controlled (they come from whatever was
 * uploaded), and these endpoints serve them back from an app origin, so
 * anything outside the raster-image allowlist is forced to download.
 */
export function isInlineSafeContentType(contentType: string): boolean {
  return INLINE_SAFE_CONTENT_TYPES.has(contentType.toLowerCase());
}

/**
 * `inline` for allowlisted raster images, `attachment` for everything else.
 * Pair with `X-Content-Type-Options: nosniff` so the browser cannot
 * second-guess the declared type.
 */
export function resolveContentDisposition(contentType: string): "attachment" | "inline" {
  return isInlineSafeContentType(contentType) ? "inline" : "attachment";
}
