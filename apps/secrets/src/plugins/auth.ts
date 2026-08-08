import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createUnauthorizedErrorEnvelope } from "../lib/http/errors.js";
import {
  findServiceTokenByPlaintext,
  touchServiceTokenLastUsed,
  type ServiceTokenCapability,
} from "../service-tokens/index.js";

/**
 * The complete list of URLs answerable without a service token. Everything
 * else is denied, including a URL matching no route at all — reachability on
 * `dokploy-network` is not authorization, so being able to open a socket to
 * this service buys nothing.
 */
export const PUBLIC_ROUTE_URLS = new Set(["/health"]);

/** What a verified token establishes. The scope and capability are for the routes to enforce. */
export interface AuthenticatedServiceToken {
  id: string;
  name: string;
  scopePrefix: string;
  capability: ServiceTokenCapability;
}

type ServiceTokenAuthFailure =
  "missing_header" | "malformed_header" | "unknown_token" | "revoked_token";

const BEARER_PREFIX = "Bearer ";

/**
 * One response for all four failures, byte for byte, so nothing distinguishes
 * an unknown token from a revoked one. The distinction goes to the log instead,
 * and never any part of what was presented — a mistyped-but-valid token would
 * otherwise be sitting in the log file.
 *
 * The identical-response property holds among these four only. A 413, 415 or
 * malformed-JSON 400 is decided by Fastify before this hook runs at all.
 */
function denyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: ServiceTokenAuthFailure,
): FastifyReply {
  request.log.warn(
    {
      requestId: String(request.id),
      route: request.routeOptions.url ?? null,
      ip: request.ip,
      reason,
    },
    "service token authentication failed",
  );

  return reply
    .header("WWW-Authenticate", "Bearer")
    .status(401)
    .send(createUnauthorizedErrorEnvelope());
}

/**
 * Runs at `preValidation`, not the conventional `onRequest`, and the ordering
 * is the load-bearing part.
 *
 * `@fastify/rate-limit` attaches its limiter as a route-level hook, and
 * route-level hooks always run after instance-level ones of the same type — so
 * no registration order can put a global limiter ahead of an instance-level
 * `onRequest` guard. At `preValidation` the limiter goes first and schema
 * validation second, so a rejected caller gets a 429 once the ceiling is
 * reached and a 401 rather than a 400 describing the body the route expected.
 * `test/rate-limit.test.ts` pins the first half of that ordering.
 *
 * The cost is that a body is parsed before the token is checked, which is why
 * `buildApp` sets a `bodyLimit`.
 *
 * `routeOptions.url` is `undefined` on both the unmatched-route path and
 * `OPTIONS`, so `OPTIONS /health` answers 401. There is no browser client, so
 * no preflight ever asks.
 */
export function setupServiceTokenAuth(app: FastifyInstance): void {
  app.decorateRequest("serviceToken", null);

  app.addHook("preValidation", async (request, reply) => {
    const routeUrl = request.routeOptions.url;

    if (routeUrl !== undefined && PUBLIC_ROUTE_URLS.has(routeUrl)) {
      return;
    }

    const header = request.headers.authorization;

    if (header === undefined) {
      return denyRequest(request, reply, "missing_header");
    }

    if (!header.startsWith(BEARER_PREFIX)) {
      return denyRequest(request, reply, "malformed_header");
    }

    // Anything thrown below is a database fault, not a bad credential, and
    // reaches the error handler as a 500. Folding it into the 401 branch would
    // report a broken schema as an authentication failure.
    const lookup = findServiceTokenByPlaintext(app.db, header.slice(BEARER_PREFIX.length));

    switch (lookup.outcome) {
      case "malformed":
        return denyRequest(request, reply, "malformed_header");
      case "unknown":
        return denyRequest(request, reply, "unknown_token");
      case "revoked":
        return denyRequest(request, reply, "revoked_token");
      default:
        break;
    }

    request.serviceToken = {
      id: lookup.token.id,
      name: lookup.token.name,
      scopePrefix: lookup.token.scopePrefix,
      capability: lookup.token.capability,
    };

    // Bounded by the limiter, which has already run. Leaving the column
    // permanently null would make it a lie.
    touchServiceTokenLastUsed(app.db, lookup.token.id);
  });
}
