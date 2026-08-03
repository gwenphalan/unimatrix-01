/**
 * Open-redirect protection for the `redirect_url` a service passes when it
 * sends a user to the auth app (e.g. `auth.unimatrix-01.dev/sign-in?redirect_url=...`).
 *
 * Only same-family origins are honored: the `unimatrix-01.dev` apex and its
 * subdomains over https, plus localhost during development. Anything else
 * falls back to the auth app's own landing, so this app can never be abused
 * as an open redirector to an attacker-controlled site.
 */
const ROOT_DOMAIN = "unimatrix-01.dev";

/**
 * The same allowlist as {@link isAllowedRedirectUrl}, in the shape Clerk's
 * `allowedRedirectOrigins` takes — handed to `AuthProvider` in `main.tsx`.
 *
 * Clerk validates `forceRedirectUrl` against this list independently of our
 * own check and **silently discards a non-matching target**, falling back to
 * its default redirect with a `warnOnce` in the console. Left unset, its
 * defaults are the current origin plus the eTLD+1 of the Clerk frontend API
 * and its subdomains — which in production is `unimatrix-01.dev` and covers
 * every service, but in development is `accounts.dev`, so a sibling dev
 * server on another loopback port matches nothing and the return address is
 * dropped after a completed sign-in.
 *
 * Clerk tests these against `url.origin`, so they are anchored on an origin
 * and never match a path.
 *
 * Two allowlists is one more than ideal, but the shapes are not
 * interchangeable: ours answers a `string | undefined` and returns a
 * fallback, Clerk's is a pattern array it applies inside its own widgets.
 * `test/safe-redirect.test.ts` asserts the two agree.
 */
export const ALLOWED_REDIRECT_ORIGINS: readonly RegExp[] = [
  new RegExp(`^https://(?:[a-z0-9-]+\\.)*${ROOT_DOMAIN.replaceAll(".", "\\.")}$`),
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
];

function isAllowedRedirectUrl(raw: string): boolean {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    // Not an absolute URL (relative paths, garbage) — never honored.
    return false;
  }

  const { hostname, protocol } = url;

  // Production: the root domain or any of its subdomains, https only. The
  // leading dot in the suffix check prevents lookalikes like
  // `evilunimatrix-01.dev` or `unimatrix-01.dev.attacker.com` from matching.
  if (hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    return protocol === "https:";
  }

  // Local development across the sibling dev servers — any port on loopback,
  // http or https. Each app pins its own port in its `vite.config.ts`; this
  // deliberately does not enumerate them, because a stale copy here would reject
  // a redirect that is in fact local.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return protocol === "http:" || protocol === "https:";
  }

  return false;
}

/**
 * Returns `raw` when it is a safe same-family redirect target, otherwise
 * `fallback` (the auth app's landing by default). Pass the result to Clerk's
 * `forceRedirectUrl` so post-auth navigation only ever lands on trusted
 * origins.
 */
export function safeRedirectUrl(raw: string | undefined, fallback = "/"): string {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  return isAllowedRedirectUrl(raw) ? raw : fallback;
}

/**
 * True when `raw` is what actually produced `target` — i.e. `target` is a
 * genuine validated redirect destination, not `safeRedirectUrl`'s fallback.
 * `target !== "/"` is the tie-breaker for the one case equality alone can't
 * resolve: a caller passing the literal string `"/"` as `raw` also fails
 * `isAllowedRedirectUrl` (a bare path is never absolute) and falls back to
 * `"/"`, which would otherwise equal `raw` by coincidence. Only meaningful
 * against the default fallback — callers that pass a custom `fallback` to
 * `safeRedirectUrl` need their own comparison.
 */
export function hasValidatedRedirectUrl(raw: string | undefined, target: string): boolean {
  return raw !== undefined && target === raw && target !== "/";
}

/**
 * Appends a `redirect_url` query param to an in-app path so switching between
 * `/sign-in` and `/sign-up` preserves the originating destination. The value
 * is passed through unvalidated (it is re-validated by {@link safeRedirectUrl}
 * on the destination route before it is ever used as a redirect target).
 */
export function withRedirectParam(path: string, redirectUrl: string | undefined): string {
  if (redirectUrl === undefined || redirectUrl.length === 0) {
    return path;
  }

  return `${path}?redirect_url=${encodeURIComponent(redirectUrl)}`;
}
