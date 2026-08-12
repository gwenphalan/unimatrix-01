import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Requests one IP may make in {@link RATE_LIMIT_WINDOW} before being answered
 * with 429. Generous on purpose: this is a ceiling that stops a script, not a
 * quota anyone browsing the site or working in the CMS should ever notice —
 * one page load is already several requests, and an admin saving a post with
 * images makes a burst of them.
 */
const RATE_LIMIT_MAX = 300;

/** The window {@link RATE_LIMIT_MAX} is counted over. */
const RATE_LIMIT_WINDOW = "1 minute";

/**
 * The ceiling itself, exported so the feature modules can install the same one
 * inside their own encapsulated scope — see the note at each `register` call.
 */
export const RATE_LIMIT_OPTIONS = {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * A tighter ceiling for the binary upload routes, attached per route through
 * `config.rateLimit`. Uploads are the most expensive thing this API does — a
 * request can carry `MAX_UPLOAD_BYTES`, is hashed, and is written to SQLite —
 * so the rate that is generous for reading a page is not the rate that should
 * be allowed for filling a disk.
 */
export const UPLOAD_RATE_LIMIT_OPTIONS = {
  max: 30,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * A tighter ceiling for `PUT /me/data`, the JSON document write.
 *
 * Reasoned in bytes per minute, the way the upload limiter is. A document
 * value caps at `DOCUMENT_VALUE_MAX_BYTES` (256 KiB), so 60/min is at most
 * ~15 MiB/min — an order of magnitude under the upload route's 30 × 5 MiB =
 * 150 MiB/min, which is right, because before this the document route was
 * the *faster* disk-filling vector at the global 300/min (~75 MiB/min) and
 * the only one with no per-route ceiling at all.
 *
 * 60/min stays comfortably above real use: this backs a settings store, and
 * a UI that writes on every preference change still makes one request per
 * change, not a stream of them.
 *
 * Defense in depth rather than the primary bound — the cumulative per-user
 * quota is what actually stops the disk filling, since it survives the
 * write/delete/write churn a rate limit alone does not.
 */
export const DOCUMENT_WRITE_RATE_LIMIT_OPTIONS = {
  max: 60,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * A tighter ceiling for `POST /integrations/admin/credentials/refresh`.
 *
 * One authorized call here fans out to N outbound requests against the
 * secrets service (N = the registry's integration-tier name count), so
 * the global 300/min would let one admin session drive up to 300 × N
 * requests at the store. 10/min is well above a real rotation workflow —
 * an operator clicking "refresh" after rotating a credential — while
 * keeping the fan-out bounded to at most 10 × N per minute.
 */
export const INTEGRATION_CREDENTIALS_REFRESH_RATE_LIMIT_OPTIONS = {
  max: 10,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * A tighter ceiling for the four `/secrets/admin*` routes, shared across all
 * of them in one encapsulated scope (a single bucket, not one per route —
 * see the note where it is registered).
 *
 * `apps/secrets` enforces its own global ceiling of 60/min keyed by IP with
 * `trustProxy` unset, which makes the whole API container one key — every
 * outbound call this API makes to the store, from every plugin and module,
 * draws from that same 60. `INTEGRATION_CREDENTIALS_REFRESH_RATE_LIMIT_OPTIONS`
 * is 10/min fanning out to N declared integration names, and the list route
 * spends two of the store's calls per request (one per scoped token), so the
 * worst-case draw against the store is `40 + 10N` — this ceiling doubled,
 * plus that one. That stays under 60 only through N = 1, and the registry
 * declares no integration name today. **Declaring the second one is the point
 * at which these two ceilings need re-deriving rather than re-reading**, and
 * neither number can be validated before then.
 *
 * The failure this avoids is not an admin session drawing a 429
 * here (a 4xx, correctly not retried) — it is the API's own boot-time
 * integration-credential refresh being rejected by the store's ceiling and
 * `setupIntegrationCredentials` booting with an empty cache.
 */
export const SECRETS_ADMIN_RATE_LIMIT_OPTIONS = {
  max: 20,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * Registers a global request ceiling.
 *
 * Global rather than per-route. Every authenticated route is a candidate — an
 * unlimited endpoint that checks a password is a place to guess passwords, and
 * an unlimited upload endpoint is a place to fill a disk — so the default is
 * the limit and an exception has to be argued for, not the other way round.
 * Registered in the root scope, before any route, so it covers the modules
 * whether or not they are conditionally registered.
 *
 * Keyed by IP through Fastify's own `request.ip`, which honours
 * `trustProxy` — set from `TRUST_PROXY` in {@link ApiRuntimeConfig}. Behind a
 * proxy with that unset, every request appears to come from the proxy and the
 * whole deployment shares one bucket.
 *
 * The store is in-memory and per-process. With more than one instance the
 * effective ceiling is `RATE_LIMIT_MAX` × instances; a shared Redis store is
 * the fix if that ever matters, and this plugin takes one.
 */
export function setupRateLimit(app: FastifyInstance): void {
  app.register(fastifyRateLimit, {
    ...RATE_LIMIT_OPTIONS,
    // No `errorResponseBuilder`. The plugin throws a 429 and the app's own
    // error handler turns it into the envelope every other error uses — see
    // the 429 branch in `normalizeError`. Building the body here instead put
    // the status inside the envelope and nowhere the handler could find it, so
    // every rate-limited request came back as a 500.
  });
}
