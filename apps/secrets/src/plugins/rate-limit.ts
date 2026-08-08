import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

const RATE_LIMIT_WINDOW = "1 minute";

/**
 * The global ceiling, keyed by IP through Fastify's `request.ip`.
 *
 * An order of magnitude under `apps/api`'s 300/min because the traffic is
 * nothing alike: the callers here are containers doing a boot fetch and the
 * occasional invalidation, not a browser loading a page as a burst of requests.
 *
 * `trustProxy` is deliberately unset in `buildApp` — see the note there — so
 * `request.ip` is the peer's real address and cannot be spoofed through
 * `X-Forwarded-For`.
 */
const GLOBAL_RATE_LIMIT_OPTIONS = {
  max: 60,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * `/health` is the one route reachable without a token, attached per route
 * through `config.rateLimit`. 30/min sits well above the container
 * healthcheck's 2/min.
 *
 * A per-route limit is a separate bucket rather than a slice of the global one
 * (measured: a route with its own `config.rateLimit` consumed none of the
 * global budget), so a caller's real ceiling is the sum of the two, not the
 * larger.
 */
export const HEALTH_RATE_LIMIT_OPTIONS = {
  max: 30,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

/**
 * The ceiling for URLs matching no route.
 *
 * This plugin attaches its limiter through `onRoute`, and `setNotFoundHandler`
 * fires no `onRoute` event — the gap `@fastify/rate-limit`'s README documents
 * under "Preventing guessing of URLS through 404s". Stock Fastify 404s such a
 * request for free, but this service denies it instead, which costs a SHA-256
 * and an indexed `SELECT` per request, so the ceiling has to be put back by
 * hand. See where it is installed in `../app.ts`.
 */
export const NOT_FOUND_RATE_LIMIT_OPTIONS = {
  max: 30,
  timeWindow: RATE_LIMIT_WINDOW,
} as const;

export function setupRateLimit(app: FastifyInstance): void {
  app.register(fastifyRateLimit, {
    ...GLOBAL_RATE_LIMIT_OPTIONS,
    // No `errorResponseBuilder`. The plugin throws a 429 and the app's error
    // handler turns it into the envelope every other error uses. `apps/api`
    // recorded the trap: building the body here put the status inside the
    // envelope and nowhere the handler could find it, so every rate-limited
    // request came back a 500.
  });
}
