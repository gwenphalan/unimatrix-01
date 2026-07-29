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
/**
 * The ceiling itself, exported so the feature modules can install the same one
 * inside their own encapsulated scope — see the note at each `register` call.
 */
export const RATE_LIMIT_OPTIONS = {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

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
