import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { SecretsDatabaseInstance } from "./db/client.js";
import type { SecretsRuntimeConfig } from "./keyring.js";
import { registerModules } from "./modules/index.js";
import { setupCorePlugins } from "./plugins/index.js";

declare module "fastify" {
  interface FastifyInstance {
    runtimeConfig: SecretsRuntimeConfig;
    db: SecretsDatabaseInstance["db"];
  }
}

// No `setErrorHandler`, no CORS/rate-limit/security plugins, and no
// `apps/api/src/lib/http` equivalent: this item ships `/health` only, with no
// browser caller and no public surface for any of that to protect. The auth
// item brings a rate-limit plugin and normalized error envelopes with the
// routes that actually need them.
export function buildApp(config: SecretsRuntimeConfig): FastifyInstance {
  const appOptions = {
    disableRequestLogging: true,
    forceCloseConnections: true,
    logger: { level: config.logLevel },
  } satisfies FastifyServerOptions;

  const app: FastifyInstance = Fastify(appOptions);

  app.decorate("runtimeConfig", config);
  setupCorePlugins(app);

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  app.register(registerModules);

  return app;
}
