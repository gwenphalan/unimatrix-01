import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  healthQuerySchema,
  secretsHealthContract,
  type SecretsHealthResponse,
} from "@unimatrix/shared";

import { HEALTH_RATE_LIMIT_OPTIONS } from "../../plugins/rate-limit.js";

const healthResponse: SecretsHealthResponse = {
  service: "secrets",
  status: "ok",
};

export const healthModule: FastifyPluginAsync = (app) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: secretsHealthContract.method,
    url: secretsHealthContract.path,
    // The only route an unauthenticated caller can drive to a handler, so the
    // only one whose ceiling is not a second line of defence.
    config: { rateLimit: HEALTH_RATE_LIMIT_OPTIONS },
    schema: {
      querystring: healthQuerySchema,
      response: {
        200: secretsHealthContract.responseSchema,
      },
    },
    handler: (_request, reply) => {
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");

      return healthResponse;
    },
  });

  return Promise.resolve();
};
