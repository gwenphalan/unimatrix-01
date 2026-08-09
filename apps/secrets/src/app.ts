import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { SecretsDatabaseInstance } from "./db/client.js";
import type { SecretsRuntimeConfig } from "./keyring.js";
import { createNotFoundErrorEnvelope, normalizeSecretsError } from "./lib/http/errors.js";
import { buildLoggerOptions, type SecretsLoggerStream } from "./lib/http/logging.js";
import { registerModules } from "./modules/index.js";
import type { AuthenticatedServiceToken } from "./plugins/auth.js";
import { setupCorePlugins } from "./plugins/index.js";
import { NOT_FOUND_RATE_LIMIT_OPTIONS } from "./plugins/rate-limit.js";

declare module "fastify" {
  interface FastifyInstance {
    runtimeConfig: SecretsRuntimeConfig;
    db: SecretsDatabaseInstance["db"];
  }

  interface FastifyRequest {
    /** Set by the auth guard on every request it lets through; null on `/health`. */
    serviceToken: AuthenticatedServiceToken | null;
  }
}

export interface BuildSecretsAppOptions {
  /** Where log records go instead of stdout, so tests can assert on redaction. */
  loggerStream?: SecretsLoggerStream;
}

/**
 * 64 KiB. The auth guard runs at `preValidation`, so a body is parsed before
 * the caller is known — but that was already true of the not-found path on a
 * bare Fastify instance, at the 1 MiB default. This clears the largest
 * legitimate body a later route could take (`SECRET_VALUE_MAX_LENGTH` is 8,192
 * characters, and a bulk delete carries at most 100 names) with room to spare.
 */
const REQUEST_BODY_LIMIT_BYTES = 65_536;

export function buildApp(
  config: SecretsRuntimeConfig,
  options: BuildSecretsAppOptions = {},
): FastifyInstance {
  const loggerOptions =
    options.loggerStream === undefined
      ? buildLoggerOptions(config)
      : buildLoggerOptions(config, { stream: options.loggerStream });

  const appOptions = {
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    forceCloseConnections: true,
    logController: new LogController({ disableRequestLogging: true }),
    logger: loggerOptions,
    // No `trustProxy`, unlike `apps/api`, where Traefik is in front. Nothing
    // fronts this service, so `X-Forwarded-For` would be attacker-controlled
    // and IP-keyed rate limiting trivially evadable.
  } satisfies FastifyServerOptions;

  const app: FastifyInstance = Fastify(appOptions);

  app.decorate("runtimeConfig", config);
  setupCorePlugins(app);

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeSecretsError(error);

    if (normalized.logLevel === "error") {
      request.log.error({ err: error }, "request failed");
    } else {
      request.log[normalized.logLevel](
        { error: normalized.envelope.error },
        "request completed with client error",
      );
    }

    reply.status(normalized.statusCode).send(normalized.envelope);
  });

  // Deferred to `after` because `app.rateLimit` does not exist until the plugin
  // registered above has booted. The limiter is the only thing that can bound
  // this path — `setNotFoundHandler` fires no `onRoute` event, so the global
  // ceiling never reaches it — and it has to sit at `onRequest`, ahead of the
  // auth guard, or every unmatched URL spends the work the limit exists to cap.
  // Fastify 5.10.0 accepts `onRequest` here while typing only `preValidation`
  // and `preHandler`; the cast is that gap, and `test/rate-limit.test.ts` is
  // what holds it honest.
  app.after(() => {
    const notFoundHooks = {
      onRequest: app.rateLimit(NOT_FOUND_RATE_LIMIT_OPTIONS),
    } as Parameters<typeof app.setNotFoundHandler>[0];

    app.setNotFoundHandler(notFoundHooks, (request, reply) => {
      const envelope = createNotFoundErrorEnvelope();

      request.log.info({ error: envelope.error }, "route not found");
      reply.status(404).send(envelope);
    });
  });

  app.register(registerModules);

  return app;
}
